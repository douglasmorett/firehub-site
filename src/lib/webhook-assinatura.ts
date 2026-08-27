import crypto from "crypto";

/**
 * /src/lib/webhook-assinatura.ts
 *
 * Verificação de assinatura para os webhooks de PEDIDO (JotaJá, 99Food).
 *
 * ── Por que estes são diferentes dos webhooks de pagamento ──────────────────
 *
 * Os webhooks de pagamento (Asaas, Celcoin, Mercado Pago, MP Point) falham
 * fechados: sem segredo configurado, recusam. Podem, porque uma confirmação de
 * pagamento perdida é reenviada pelo gateway e ninguém fica sem receber.
 *
 * Os de pedido não têm essa rede. Recusar um evento do JotaJá é pedido que
 * some da cozinha — e, no caso do JotaJá, some para sempre, porque a API não
 * tem listagem para recuperar depois. Fechar essa porta antes de o segredo
 * existir dos dois lados derrubaria a operação de lojas pagantes.
 *
 * ── O interruptor ───────────────────────────────────────────────────────────
 *
 * A porta fecha sozinha no instante em que o segredo passa a existir no
 * ambiente. Enquanto não existir, o evento entra e cada requisição não assinada
 * deixa um alerta no log — para a ausência ser visível, em vez de silenciosa
 * como era o `if (!secret) return true` que estava aqui antes.
 *
 * Configure a variável no servidor E o mesmo valor no portal do parceiro. A
 * partir daí, requisição sem assinatura válida é recusada.
 */

export type ResultadoAssinatura =
  | { estado: "valida" }
  | { estado: "invalida"; motivo: string }
  /** Segredo não configurado: passa, mas registra. */
  | { estado: "sem-segredo" };

/**
 * Confere HMAC-SHA256 do corpo cru contra os cabeçalhos de assinatura.
 *
 * O corpo tem que ser o texto exato recebido — reserializar o JSON muda bytes
 * (ordem de chaves, espaços) e o hash deixa de bater.
 */
export function verificarAssinaturaHmac(
  nomeDaVariavel: string,
  corpoCru: string,
  assinaturaRecebida: string | null | undefined
): ResultadoAssinatura {
  const segredo = process.env[nomeDaVariavel];
  if (!segredo) return { estado: "sem-segredo" };

  const recebida = String(assinaturaRecebida || "").replace(/^sha256=/i, "").trim();
  if (!recebida) {
    // Assinatura ausente com segredo configurado é recusa. Aceitar aqui seria
    // repetir o furo do webhook do Mercado Pago, onde bastava omitir o
    // cabeçalho para a verificação inteira ser pulada.
    return { estado: "invalida", motivo: "sem cabeçalho de assinatura" };
  }

  const esperada = crypto.createHmac("sha256", segredo).update(corpoCru, "utf8").digest("hex");

  const a = Buffer.from(esperada);
  const b = Buffer.from(recebida);
  // timingSafeEqual lança quando os tamanhos diferem: conferir antes evita que
  // uma assinatura curta forjada derrube a rota em vez de ser recusada.
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { estado: "invalida", motivo: "assinatura não confere" };
  }

  return { estado: "valida" };
}

/** Registra no log a requisição que entrou sem verificação, com o que fazer a respeito. */
export function avisarWebhookSemSegredo(parceiro: string, nomeDaVariavel: string): void {
  console.warn(
    `[${parceiro} Webhook] ⚠️ ${nomeDaVariavel} não configurada — requisição aceita SEM verificação de origem. ` +
    `Qualquer pessoa que conheça esta URL consegue injetar um pedido falso. ` +
    `Defina ${nomeDaVariavel} no servidor e o mesmo valor no portal do parceiro para fechar.`
  );
}

// ─── MODO OBSERVAÇÃO: descobrir a fórmula sem arriscar a operação ────────────
//
// O impasse real: para EXIGIR assinatura é preciso saber a fórmula exata do
// parceiro, e errar a fórmula recusa TODO pedido verdadeiro — a loja para de
// vender. Foi o que travou o 99Food: o cabeçalho `didi-header-sign` tem 32 hex
// (cara de MD5), não os 64 de HMAC-SHA256 que este arquivo calcula. Ligar o
// segredo ali derrubaria a integração inteira.
//
// A saída é medir antes de exigir. A cada requisição REAL do parceiro, testamos
// uma matriz de fórmulas conhecidas contra a assinatura que veio e registramos
// QUAL bateu. Nada é recusado por causa disso. Depois de ver o mesmo nome de
// fórmula repetido no log em pedidos de verdade, dá para ligar a exigência com
// certeza — em vez de com esperança.
//
// O que vai para o log é só o NOME da fórmula e o tamanho da assinatura. Nunca
// o segredo, nunca a assinatura inteira.

type CandidatoDeSegredo = { rotulo: string; valor: string | undefined };

/** Fórmulas que os parceiros de delivery usam na prática. */
function calcularVariantes(corpoCru: string, segredo: string, extras: Record<string, string>): Record<string, string> {
  const hmac = (algo: string, chave: string, dado: string) =>
    crypto.createHmac(algo, chave).update(dado, "utf8").digest("hex");
  const hash = (algo: string, dado: string) =>
    crypto.createHash(algo).update(dado, "utf8").digest("hex");

  const variantes: Record<string, string> = {
    "hmac-sha256(corpo)": hmac("sha256", segredo, corpoCru),
    "hmac-sha256(corpo):base64": crypto.createHmac("sha256", segredo).update(corpoCru, "utf8").digest("base64"),
    "hmac-md5(corpo)": hmac("md5", segredo, corpoCru),
    "md5(corpo+segredo)": hash("md5", corpoCru + segredo),
    "md5(segredo+corpo)": hash("md5", segredo + corpoCru),
    "sha256(corpo+segredo)": hash("sha256", corpoCru + segredo),
    "sha256(segredo+corpo)": hash("sha256", segredo + corpoCru),
  };

  // Esquema estilo DiDi/99: MD5 de campos do próprio evento concatenados com o
  // segredo (app_id, timestamp e afins), em vez do corpo inteiro.
  const partes = Object.keys(extras).sort().map(k => `${k}=${extras[k]}`).join("&");
  if (partes) {
    variantes["md5(campos_ordenados+segredo)"] = hash("md5", partes + segredo);
    variantes["md5(segredo+campos_ordenados)"] = hash("md5", segredo + partes);
    variantes["hmac-md5(campos_ordenados)"] = hmac("md5", segredo, partes);
  }

  return variantes;
}

/**
 * Testa a assinatura recebida contra a matriz de fórmulas e REGISTRA o
 * resultado. Nunca recusa nada: serve para aprender com o tráfego real.
 *
 * Devolve o nome da fórmula que bateu (ou null), para quem quiser encadear.
 */
export function diagnosticarAssinatura(params: {
  parceiro: string;
  corpoCru: string;
  assinaturaRecebida: string | null | undefined;
  /** Segredos candidatos, com rótulo. Valores ausentes são ignorados. */
  candidatos: CandidatoDeSegredo[];
  /** Campos do evento para os esquemas que assinam parâmetros, não o corpo. */
  extras?: Record<string, string>;
}): string | null {
  const { parceiro, corpoCru, assinaturaRecebida, candidatos, extras = {} } = params;

  const recebida = String(assinaturaRecebida || "").replace(/^sha256=/i, "").trim();
  if (!recebida) {
    console.warn(`[${parceiro} Webhook] 🔎 diagnóstico: requisição SEM cabeçalho de assinatura.`);
    return null;
  }

  for (const { rotulo, valor } of candidatos) {
    if (!valor) continue;
    const variantes = calcularVariantes(corpoCru, valor, extras);
    for (const [nomeDaFormula, esperado] of Object.entries(variantes)) {
      if (esperado.toLowerCase() === recebida.toLowerCase()) {
        console.warn(
          `[${parceiro} Webhook] 🔓 diagnóstico: FÓRMULA ENCONTRADA — segredo "${rotulo}" com ${nomeDaFormula}. ` +
          `Já dá para EXIGIR assinatura deste parceiro com segurança.`
        );
        return `${rotulo}:${nomeDaFormula}`;
      }
    }
  }

  console.warn(
    `[${parceiro} Webhook] 🔎 diagnóstico: nenhuma fórmula conhecida bateu ` +
    `(assinatura recebida tem ${recebida.length} caracteres; testados ${candidatos.filter(c => c.valor).length} segredo(s)). ` +
    `A porta segue aberta de propósito — recusar aqui pararia os pedidos.`
  );
  return null;
}
