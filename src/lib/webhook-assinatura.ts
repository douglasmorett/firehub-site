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
