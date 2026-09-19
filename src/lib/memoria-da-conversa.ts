/**
 * O histórico da conversa do robô, no formato em que pode ir ao banco e voltar.
 *
 * ── Por que isto existe ─────────────────────────────────────────────────────
 *
 * O histórico morava só num `Map` do processo (15 mensagens, 30 min). Deploy no
 * FireHub é a cada push, em horário de jantar inclusive — e a cada deploy TODA
 * conversa em andamento perdia a memória: o cliente respondia "pode ser" e o
 * robô não sabia a quê; mandava "e uma coca" e o robô recomeçava o atendimento.
 *
 * Este arquivo só LIMPA e VALIDA. Quem fala com o banco é
 * `memoria-da-conversa-no-banco.ts`. As regras de validade são as MESMAS do
 * cache em memória (webhook, `cleanCache`): 15 mensagens, 30 minutos cada. O
 * que volta do banco é tratado como entrada não confiável — é JSON que passou
 * por fora do processo.
 *
 * Arquivo puro, sem imports: tem teste que o carrega sozinho
 * (scripts/teste-memoria-da-conversa.mjs).
 */

export type MensagemDaConversa = { sender: "user" | "bot"; text: string; timestamp: number };

export const MAXIMO_DE_MENSAGENS = 15;
export const VALIDADE_DA_MENSAGEM_MS = 30 * 60 * 1000;
/** Mensagem maior que isto é cortada: o histórico é contexto, não arquivo. */
export const LIMITE_DO_TEXTO = 1200;

/**
 * Corta no limite SEM partir emoji ao meio.
 *
 * `slice` conta unidades UTF-16: cortar no meio de um emoji deixa metade de um
 * par substituto, que o Postgres recusa em jsonb ("unsupported Unicode escape
 * sequence"). A conversa inteira deixaria de ser guardada, em silêncio.
 */
function cortar(texto: string): string {
  if (texto.length <= LIMITE_DO_TEXTO) return texto;
  const pedacos = Array.from(texto); // por ponto de código, não por unidade
  if (pedacos.length <= LIMITE_DO_TEXTO) return texto;
  return pedacos.slice(0, LIMITE_DO_TEXTO).join("") + "…";
}

function limpar(lista: unknown, agora: number): MensagemDaConversa[] {
  if (!Array.isArray(lista)) return [];
  const boas: MensagemDaConversa[] = [];
  for (const m of lista) {
    if (!m || typeof m !== "object") continue;
    const sender = (m as any).sender;
    const text = (m as any).text;
    const timestamp = Number((m as any).timestamp);
    if (sender !== "user" && sender !== "bot") continue;
    if (typeof text !== "string" || !text.trim()) continue;
    if (!Number.isFinite(timestamp) || timestamp <= 0) continue;
    // Do futuro (relógio torto, dado adulterado) ou vencida: fora.
    if (timestamp > agora + 60_000) continue;
    if (agora - timestamp >= VALIDADE_DA_MENSAGEM_MS) continue;
    boas.push({ sender, text: cortar(text), timestamp });
  }
  boas.sort((a, b) => a.timestamp - b.timestamp);
  return boas.slice(-MAXIMO_DE_MENSAGENS);
}

/** O que vai para o banco. */
export function historicoParaGuardar(mensagens: unknown, agora: number): MensagemDaConversa[] {
  return limpar(mensagens, agora);
}

/** O que volta do banco — array, ou o mesmo array serializado em texto. */
export function historicoAoLer(bruto: unknown, agora: number): MensagemDaConversa[] {
  let lista: unknown = bruto;
  if (typeof bruto === "string") {
    try { lista = JSON.parse(bruto); } catch { return []; }
  }
  return limpar(lista, agora);
}
