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
 * ── Duas janelas, de propósito ──────────────────────────────────────────────
 *
 * O que o MODELO lê e o que a LOJA vê não são a mesma coisa:
 *
 *  - O modelo recebe uma janela curta (15 mensagens, 30 min). Contexto velho
 *    demais faz o robô responder a um assunto que já morreu, e prompt longo é
 *    caro. É a mesma regra do cache em memória do webhook (`cleanCache`).
 *  - O painel da loja mostra a conversa INTEIRA do turno (40 mensagens, 6 h):
 *    quem está acompanhando o robô atender precisa ver o que veio antes, não
 *    só os últimos três minutos.
 *
 * Por isso o banco guarda a janela LARGA, e quem monta o prompt aperta para a
 * curta na leitura.
 *
 * Este arquivo só LIMPA e VALIDA. Quem fala com o banco é
 * `memoria-da-conversa-no-banco.ts`. O que volta do banco é tratado como
 * entrada não confiável — é JSON que passou por fora do processo.
 *
 * Arquivo puro, sem imports: tem teste que o carrega sozinho
 * (scripts/teste-memoria-da-conversa.mjs).
 */

export type MensagemDaConversa = {
  sender: "user" | "bot";
  text: string;
  timestamp: number;
  /** Quem falou pelo lado da loja, quando não foi o robô: "atendente". */
  autor?: "robo" | "atendente";
};

/** Janela do MODELO. */
export const MAXIMO_DE_MENSAGENS = 15;
export const VALIDADE_DA_MENSAGEM_MS = 30 * 60 * 1000;
/** Janela do PAINEL (o que fica guardado no banco). */
export const MAXIMO_GUARDADO = 40;
export const VALIDADE_GUARDADA_MS = 6 * 60 * 60 * 1000;
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

function limpar(lista: unknown, agora: number, maximo: number, validadeMs: number): MensagemDaConversa[] {
  if (!Array.isArray(lista)) return [];
  const boas: MensagemDaConversa[] = [];
  for (const m of lista) {
    if (!m || typeof m !== "object") continue;
    const sender = (m as any).sender;
    const text = (m as any).text;
    const timestamp = Number((m as any).timestamp);
    const autor = (m as any).autor;
    if (sender !== "user" && sender !== "bot") continue;
    if (typeof text !== "string" || !text.trim()) continue;
    if (!Number.isFinite(timestamp) || timestamp <= 0) continue;
    // Do futuro (relógio torto, dado adulterado) ou vencida: fora.
    if (timestamp > agora + 60_000) continue;
    if (agora - timestamp >= validadeMs) continue;
    boas.push({
      sender,
      text: cortar(text),
      timestamp,
      ...(autor === "robo" || autor === "atendente" ? { autor } : {}),
    });
  }
  boas.sort((a, b) => a.timestamp - b.timestamp);

  // A MESMA mensagem duas vezes seguidas é uma gravação repetida, não o cliente
  // insistindo: a resposta que chega atrasada pode passar pelo mesmo caminho
  // que o vigia já percorreu, e o acréscimo no banco é atômico de propósito
  // (não tem como conferir o que já está lá antes de escrever). Cinco segundos
  // separam a repetição técnica do "oi... oi?" de quem está esperando.
  const semRepetidas: MensagemDaConversa[] = [];
  for (const m of boas) {
    const anterior = semRepetidas[semRepetidas.length - 1];
    if (anterior && anterior.sender === m.sender && anterior.text === m.text && m.timestamp - anterior.timestamp < 5000) {
      continue;
    }
    semRepetidas.push(m);
  }
  return semRepetidas.slice(-maximo);
}

/** O que vai para o banco: a janela larga, que o painel mostra. */
export function historicoParaGuardar(mensagens: unknown, agora: number): MensagemDaConversa[] {
  return limpar(mensagens, agora, MAXIMO_GUARDADO, VALIDADE_GUARDADA_MS);
}

/** O que volta do banco para o PAINEL — array, ou o mesmo array serializado em texto. */
export function historicoAoLer(bruto: unknown, agora: number): MensagemDaConversa[] {
  let lista: unknown = bruto;
  if (typeof bruto === "string") {
    try { lista = JSON.parse(bruto); } catch { return []; }
  }
  return limpar(lista, agora, MAXIMO_GUARDADO, VALIDADE_GUARDADA_MS);
}

/** O que vai para o MODELO: a janela curta, do que ainda é assunto. */
export function historicoParaAIa(bruto: unknown, agora: number): MensagemDaConversa[] {
  let lista: unknown = bruto;
  if (typeof bruto === "string") {
    try { lista = JSON.parse(bruto); } catch { return []; }
  }
  return limpar(lista, agora, MAXIMO_DE_MENSAGENS, VALIDADE_DA_MENSAGEM_MS);
}
