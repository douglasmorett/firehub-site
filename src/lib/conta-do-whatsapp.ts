/**
 * Qual é a conta do WhatsApp de um celular digitado — o nono dígito.
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 *
 * Pizzaria Lapastine (Belém, DDD 91), 08/10/2026: "o pessoal pede pelo link e
 * ela não notifica que o pedido foi aceito, que está em preparo, que saiu para
 * entrega, nem manda o resumo". Os clientes do ROBÔ recebiam tudo; os do
 * CARDÁPIO DIGITAL, nada.
 *
 * A diferença é de onde vem o número. O do robô sai da própria conversa
 * (559182181852 — doze dígitos, a conta como o WhatsApp a registrou). O do
 * site é o que o cliente digitou: 91 99804-7356, com o nono dígito. Em boa
 * parte do país (DDD de fora de SP/RJ/ES) a conta do WhatsApp continua SEM o
 * 9 — e mandar para 5591998047356@s.whatsapp.net não dá erro nenhum: a
 * mensagem simplesmente não chega a ninguém.
 *
 * Em vez de adivinhar pela regra do DDD (que tem exceções), pergunta-se ao
 * próprio WhatsApp: o gateway do FireHub tem `GET /instance/quem-e/:instancia`
 * (onWhatsApp do Baileys), que devolve a conta de verdade. Gateway sem essa
 * rota (Evolution oficial, que já trata o nono dígito) responde erro e o
 * número segue como veio — exatamente como era.
 */

/** 55 + DDD + 9 + 8 dígitos: o único formato em que existe a dúvida. */
const CELULAR_COM_NONO = /^55(\d{2})9(\d{8})$/;

/**
 * Os números a perguntar: o digitado e o mesmo sem o 9 (escolherConta decide).
 * Número sem a dúvida (fixo, já com 12 dígitos, estrangeiro) → lista vazia: não
 * se pergunta nada.
 */
export function numerosAPerguntar(numero: string): string[] {
  // Endereço pronto (a conversa do robô, @s.whatsapp.net ou @lid) já é a conta.
  if (String(numero || "").includes("@")) return [];
  const d = String(numero || "").replace(/\D/g, "");
  const m = d.match(CELULAR_COM_NONO);
  if (!m) return [];
  return [d, `55${m[1]}${m[2]}`];
}

/** A conta que a resposta do `quem-e` aponta, ou null (não existe / resposta estranha). */
export function contaDaResposta(resposta: unknown): { conta: string; temLid: boolean } | null {
  const info: any = (resposta as any)?.info;
  if (!info || info.exists === false) return null;
  const jid = String(info.jid || "");
  const m = jid.match(/^(\d{10,15})(?::\d+)?@s\.whatsapp\.net$/);
  return m ? { conta: `${m[1]}@s.whatsapp.net`, temLid: Boolean(info.lid) } : null;
}

/**
 * Entre as respostas das duas formas, a conta: a que veio com LID (conta ativa
 * de verdade — é por ele que o gateway entrega), senão a primeira que existe.
 * Hoje o envio já pergunta o número com o 9 e, se viesse LID, a mensagem
 * chegava; "existe, sem LID" é justamente o caso que falha calado.
 */
export function escolherConta(respostas: unknown[]): string | null {
  const contas = respostas.map(contaDaResposta).filter((c): c is { conta: string; temLid: boolean } => c !== null);
  return (contas.find((c) => c.temLid) || contas[0])?.conta ?? null;
}

type Perguntar = (numero: string) => Promise<unknown>;

const lembradas = new Map<string, { conta: string; ate: number }>();
const SEIS_HORAS = 6 * 60 * 60 * 1000;

/**
 * O endereço para mandar a mensagem: a conta confirmada pelo WhatsApp, ou o
 * próprio número quando não há dúvida, quando ninguém responde, ou quando o
 * WhatsApp não conhece nenhuma das duas formas.
 */
export async function contaParaEnviar(chave: string, numero: string, perguntar: Perguntar): Promise<string> {
  const candidatos = numerosAPerguntar(numero);
  if (candidatos.length === 0) return numero;

  const k = `${chave}|${candidatos[0]}`;
  const guardada = lembradas.get(k);
  if (guardada && guardada.ate > Date.now()) return guardada.conta;

  const respostas: unknown[] = [];
  for (const n of candidatos) {
    try {
      respostas.push(await perguntar(n));
    } catch {
      // Gateway sem a rota, fora do ar ou lento: segue como sempre foi.
      return numero;
    }
  }
  const conta = escolherConta(respostas);
  if (!conta) return numero;
  lembradas.set(k, { conta, ate: Date.now() + SEIS_HORAS });
  if (lembradas.size > 5000) lembradas.delete(lembradas.keys().next().value as string);
  return conta;
}
