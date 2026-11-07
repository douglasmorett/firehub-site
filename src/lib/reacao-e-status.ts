/**
 * Reação e resposta a STATUS da loja não são pedido de atendimento.
 *
 * O cliente põe um coraçãozinho num status da loja e o robô respondia "vamos
 * fechar o lanche hoje?" — "papo de maluco", nas palavras do lojista (via
 * Victor, 06/11/2026). A resposta a um status chega na conversa direta, como
 * texto citando o status (`contextInfo.remoteJid = "status@broadcast"`), e o
 * robô a lia como mensagem de cliente.
 *
 * - Só emoji (ou nada) respondendo a status, ou a reação em si: silêncio.
 * - Resposta a status com texto ("quanto tá esse?"): segue para o robô, com o
 *   aviso de que é resposta a status, para ele responder só ao que foi dito.
 * - Desde 06/11/2026 (Douglas: "a gente só manda mensagem se o cliente manda
 *   mensagem para a gente"): resposta a status SEM pergunta nem pedido ("que
 *   delícia", "top", "amei") também fica sem resposta — era por ela que o robô
 *   "entrava mandando mensagem" (saudação com link + "bora pedir?").
 * - Emoji solto na conversa ("😍", "👍", "😮") só é respondido quando o robô
 *   tinha acabado de perguntar algo (o 👍 que confirma o pedido). Sem isso o
 *   robô puxava assunto: "😮" → "Kkkk, ficou surpreso com alguma coisa?"
 *   (Pizzaria 17, 06/11), "😍" → "Quer ver algum sabor?".
 *
 * Arquivo puro, sem imports: o teste o carrega sozinho
 * (scripts/teste-reacao-e-status.mjs).
 */

const ENVELOPES = ["extendedTextMessage", "imageMessage", "videoMessage", "conversation", "audioMessage", "stickerMessage"];

/** A mensagem cita um status (é resposta a um status da loja)? */
export function respondeAStatus(conteudo: unknown): boolean {
  if (!conteudo || typeof conteudo !== "object") return false;
  const m = conteudo as Record<string, any>;
  for (const tipo of ENVELOPES) {
    const ctx = m[tipo]?.contextInfo;
    if (ctx && String(ctx.remoteJid || "") === "status@broadcast") return true;
  }
  return false;
}

/** Texto sem nenhuma letra nem número: "❤️", "😍😍", "👏🏻!", "". */
export function soEmoji(texto: unknown): boolean {
  return !/[\p{L}\p{N}]/u.test(String(texto ?? ""));
}

/** Reação ou emoji solto num status: o robô não diz nada. */
export function ehSoReacao(conteudo: unknown, texto: unknown): boolean {
  if (conteudo && typeof conteudo === "object" && (conteudo as Record<string, unknown>).reactionMessage) return true;
  return respondeAStatus(conteudo) && soEmoji(texto);
}

/**
 * Palavras de quem quer saber ou pedir alguma coisa. Sem nenhuma delas (e sem
 * "?"), resposta a status é comentário: "que delícia", "top", "amei".
 */
const PERGUNTA_OU_PEDIDO =
  /\?|(?<!\p{L})(quanto|quantos|quanta|qual|quais|quero|queria|quer|querer|tem|t[eê]m|valor|pre[cç]o|pedir|pe[cç]o|pedido|manda|mande|entrega|entregam|entregar|abert[ao]s?|abre|abrem|funciona|hoje|amanh[aã]|card[aá]pio|ainda|dispon[ií]vel|encomenda|reserva|onde|como|faz|fazem|aceita|sabor|sabores|tamanho|promo[cç][aã]o|cupom|me v[eê])(?!\p{L})/iu;

/** Resposta a status que é só comentário ou elogio, sem pergunta nem pedido. */
export function respostaAStatusSemPergunta(conteudo: unknown, texto: unknown): boolean {
  if (!respondeAStatus(conteudo)) return false;
  return !PERGUNTA_OU_PEDIDO.test(String(texto ?? ""));
}

/**
 * Emoji solto ("😍", "👍", "😮") numa conversa em que o robô NÃO acabou de
 * perguntar nada: não é resposta, não pede resposta. Com a pergunta do robô
 * no ar ("Confirma?"), o 👍 é a resposta e segue para o robô.
 */
export function emojiSemPerguntaDoRobo(texto: unknown, ultimaDoRobo: unknown): boolean {
  if (!String(texto ?? "").trim() || !soEmoji(texto)) return false;
  return !/\?[^\p{L}\p{N}?]*$/u.test(String(ultimaDoRobo ?? "").trim());
}

/**
 * A mensagem automática do WhatsApp Business (saudação, "estamos fora do
 * horário") sai do número da loja um ou dois segundos depois da mensagem do
 * cliente — gente digitando não responde tão rápido. Ela não é o lojista
 * assumindo a conversa: tratada como tal, calava o robô por 5 minutos no
 * primeiro "oi" de toda loja que deixou a saudação do Business ligada
 * (Construção do Lanche, Duga, Ragnar, Bella Ragazza, Pizzaria do Costa,
 * Baiano — 06/11/2026).
 *
 * Só vale quando a mensagem do cliente ABRIU a conversa (a primeira, ou depois
 * de 30 min parada): é quando o Business manda a saudação. No meio da conversa
 * o lojista pode, sim, mandar algo 3 s depois do cliente (estava digitando), e
 * aí é ele assumindo.
 */
export const JANELA_DA_MENSAGEM_AUTOMATICA_MS = 5000;
export function pareceMensagemAutomaticaDoBusiness(
  saiuEm: number,
  ultimaDoClienteEm: number | null | undefined,
  /** Quanto a conversa ficou parada antes da última mensagem do cliente (null = foi a primeira). */
  paradaAntesDelaMs: number | null | undefined,
): boolean {
  if (!ultimaDoClienteEm || !Number.isFinite(ultimaDoClienteEm)) return false;
  const abriuAConversa = paradaAntesDelaMs == null || paradaAntesDelaMs >= 30 * 60 * 1000;
  const depois = saiuEm - ultimaDoClienteEm;
  return abriuAConversa && depois >= -2000 && depois <= JANELA_DA_MENSAGEM_AUTOMATICA_MS;
}

/** O que o modelo lê antes do texto de quem respondeu a um status. */
export const AVISO_DE_RESPOSTA_A_STATUS =
  "[O cliente respondeu a um STATUS da loja. Responda só ao que ele escreveu, curto. Elogio ou comentário: agradeça numa frase, sem oferecer pedido nem perguntar se quer pedir.]";
