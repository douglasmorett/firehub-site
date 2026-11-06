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

/** O que o modelo lê antes do texto de quem respondeu a um status. */
export const AVISO_DE_RESPOSTA_A_STATUS =
  "[O cliente respondeu a um STATUS da loja. Responda só ao que ele escreveu, curto. Elogio ou comentário: agradeça numa frase, sem oferecer pedido nem perguntar se quer pedir.]";
