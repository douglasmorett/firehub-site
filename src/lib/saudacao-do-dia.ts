/**
 * A primeira mensagem do dia de um cliente, quando é só um "oi".
 *
 * Quem abre a conversa com "oi", "boa noite", "e aí, tudo bem?" não perguntou
 * nada — e a resposta mais útil que existe para essa mensagem é o link do
 * cardápio, que é onde o pedido nasce. Deixar o modelo decidir aqui custava
 * uma chamada de IA para devolver "Oi! Como posso ajudar?", e a regra do link
 * do cardápio (lib/regras-do-robo.ts, "nunca em cortesia") fazia com que o link só saísse
 * na terceira mensagem. Pedido do dono em 24/09/2026: "oi, tudo bem? Para
 * conhecer nosso cardápio e pedir acesse: ..." na primeira mensagem do dia, e
 * depois a conversa segue normal.
 *
 * Duas condições, as duas decididas AQUI e não pelo modelo:
 *   1. a mensagem é SÓ uma saudação (`ehSoUmaSaudacao`) — "oi, quanto tá a
 *      esfiha?" não é: tem pergunta, e pergunta se responde;
 *   2. é a primeira mensagem do dia (`ehPrimeiraMensagemDoDia`) — o cliente
 *      que já falou hoje não precisa do link de novo.
 *
 * Sem import de propósito: é módulo puro, provado em
 * scripts/teste-saudacao-do-dia.mjs. O começo do dia e a hora local vêm de
 * quem chama (lib/fuso.ts), para o teste não depender de relógio nem de fuso.
 */

/** Palavras que, sozinhas ou combinadas, ainda são só um cumprimento. */
const VOCABULARIO_DE_SAUDACAO = new Set([
  "oi", "oie", "ola", "alo", "opa", "eai", "salve", "fala", "hey", "hello", "hi", "olá",
  "bom", "boa", "dia", "tarde", "noite", "boas",
  "tudo", "td", "bem", "bom", "joia", "beleza", "blz", "tranquilo", "certo", "ok",
  "e", "ai", "aí", "ae", "tá", "ta", "como", "vai", "vc", "voce", "você", "cê", "ce",
  "gente", "pessoal", "amigo", "amiga", "moço", "moça", "querido", "querida",
]);
// "Tá aberto?", "tem alguém aí?", "estão atendendo?" ficam de fora de
// propósito: são perguntas, e a resposta certa depende de a loja estar aberta
// AGORA — coisa que só o modelo, com o horário na mão, sabe dizer.

/** Ao menos uma destas tem que aparecer: "tudo bem" sem "oi" ainda é saudação, "ok" sozinho não. */
const NUCLEO_DA_SAUDACAO = new Set([
  "oi", "oie", "ola", "olá", "alo", "opa", "eai", "salve", "fala", "hey", "hello", "hi",
  "dia", "tarde", "noite", "boas", "bem", "joia", "beleza", "blz", "tranquilo",
]);

/** Emoji e pontuação não mudam o sentido de um "oi". */
function palavrasDaMensagem(texto: string): string[] {
  return String(texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    // Sobra só letra e espaço: fora emoji, "?", "!", vírgula, número.
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    // "oiii", "olaaa", "eaee": letra repetida três vezes ou mais vira uma.
    .map((p) => p.replace(/(.)\1{2,}/g, "$1"))
    // "oii" e "oiee" ainda escapam do corte acima.
    .map((p) => (/^oi+e*$/.test(p) ? "oi" : p))
    .map((p) => (/^ola+$/.test(p) ? "ola" : p));
}

/**
 * "Oi", "boa noite!", "e aí, tudo bem? 😊", "oii td bem", "olá, bom dia" → true.
 * "oi, quanto tá a esfiha?", "boa noite, quero pedir", "oi vocês entregam no
 * centro?" → false: tem assunto, e assunto é do modelo.
 */
export function ehSoUmaSaudacao(texto: string): boolean {
  const bruto = String(texto || "").trim();
  if (!bruto) return false;
  // Número na mensagem é pedido, endereço ou código: nunca só um "oi".
  if (/\d/.test(bruto)) return false;
  const palavras = palavrasDaMensagem(bruto);
  if (palavras.length === 0 || palavras.length > 8) return false;
  if (!palavras.every((p) => VOCABULARIO_DE_SAUDACAO.has(p))) return false;
  return palavras.some((p) => NUCLEO_DA_SAUDACAO.has(p));
}

export type SinaisDoDia = {
  /** Quando o cliente mandou a mensagem ANTERIOR a esta (ms), ou null se não há registro. */
  ultimaMensagemEm?: number | null;
  /** O histórico que vai ao modelo: se tem qualquer coisa, a conversa está em curso. */
  historico?: unknown[] | null;
  /** Começo do dia operacional da loja (lib/fuso.ts, `inicioDoExpedienteDaLoja`). */
  inicioDoDia: Date;
};

/**
 * Primeira mensagem do dia = nenhum sinal de conversa hoje.
 *
 * O histórico do modelo é uma janela de 30 min; a última mensagem registrada
 * pelo anti-loop (`lastMessageAt`) vale o dia inteiro. Basta um dos dois dizer
 * "já falou hoje" para não repetir o link.
 */
export function ehPrimeiraMensagemDoDia(sinais: SinaisDoDia): boolean {
  if (Array.isArray(sinais.historico) && sinais.historico.length > 0) return false;
  const ultima = Number(sinais.ultimaMensagemEm);
  if (Number.isFinite(ultima) && ultima > 0 && ultima >= sinais.inicioDoDia.getTime()) return false;
  return true;
}

/** O link do cardápio da loja: o externo, se cadastrado, senão o do site. Vazio = a loja não tem. */
export function linkDoCardapioDaLoja(loja: { slug?: string | null; chatbotConfig?: unknown }): string {
  const cfg = (loja.chatbotConfig as { externalMenuUrl?: unknown } | null) || {};
  const externo = String(cfg.externalMenuUrl || "").trim();
  if (externo) return externo;
  return loja.slug ? `https://firehubfood.com.br/loja/${loja.slug}` : "";
}

export type DadosDaBoasVindas = {
  primeiroNome?: string | null;
  nomeDoAtendente?: string | null;
  nomeDaLoja?: string | null;
  /** Hora local da loja (0–23), para "bom dia" / "boa tarde" / "boa noite". */
  horaLocal: number;
  link: string;
  /** "SIMPATICO" (padrão), "AGIL", "FORMAL", "DIVERTIDO" — só decide emoji e tom. */
  personalidade?: string | null;
  /**
   * O cupom de primeiro pedido, quando a loja tem um cadastrado e este número
   * nunca pediu (quem decide é o chatbot-ai, com jaPediuPeloSite). Pedido do
   * Rafa (R&D, 28/09/2026): o cliente novo ouve do cupom logo no "oi".
   */
  cupomDePrimeiroPedido?: { code: string; beneficio: string } | null;
};

function saudacaoPelaHora(horaLocal: number): string {
  const h = Number.isFinite(horaLocal) ? ((horaLocal % 24) + 24) % 24 : 12;
  if (h >= 5 && h < 12) return "Bom dia";
  if (h >= 12 && h < 18) return "Boa tarde";
  return "Boa noite";
}

/**
 * A mensagem inteira, pronta para enviar. Curta: cumprimento, quem fala (se a
 * loja deu nome ao atendente), o link e a porta aberta para a conversa seguir.
 */
export function mensagemDeBoasVindasDoDia(d: DadosDaBoasVindas): string {
  const formal = String(d.personalidade || "").toUpperCase() === "FORMAL";
  const carinha = formal ? "" : " 😊";
  const nome = String(d.primeiroNome || "").trim();
  const atendente = String(d.nomeDoAtendente || "").trim();
  const loja = String(d.nomeDaLoja || "").trim();

  const cumprimento = `${saudacaoPelaHora(d.horaLocal)}${nome ? `, ${nome}` : ""}! Tudo bem?${carinha}`;
  // "do atendimento da X" lê bem com qualquer nome de loja; adivinhar o
  // artigo do nome ("do Hakim", "da Pizzaria") erraria em metade delas.
  const apresentacao = atendente ? ` Aqui é ${atendente}, do atendimento${loja ? ` da ${loja}` : ""}.` : "";
  const cupom = d.cupomDePrimeiroPedido;
  const presente = cupom
    ? `\n\nComo é seu primeiro pedido aqui, você ganha ${cupom.beneficio} com o cupom ${cupom.code}${formal ? "." : " 🎉"}`
    : "";
  const convite = `Para conhecer nosso cardápio e fazer seu pedido é só acessar: ${d.link}${presente}`;
  const porta = formal
    ? "Se tiver qualquer dúvida sobre sabores, preços ou entrega, estou à disposição por aqui."
    : "Qualquer dúvida sobre sabor, preço ou entrega, é só me chamar por aqui!";

  return `${cumprimento}${apresentacao}\n\n${convite}\n\n${porta}`;
}
