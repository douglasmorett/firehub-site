/**
 * AS MÍDIAS RECENTES DO NÚMERO DO FIREHUB, EM MEMÓRIA — para o robô VER a
 * imagem que o contato acabou de mandar, e não só a descrição dela.
 *
 * Douglas, 03/10/2026: "o robô deve ver imagens e ser tão capaz quanto nosso
 * atendente". A descrição feita na chegada (gemini.ts, descreverMidia) vai
 * gravada na mensagem; os bytes ficam aqui, guardados pelo id da mensagem, e o
 * robô os anexa na resposta seguinte (robo.ts). Nada vai para disco nem banco:
 * print de painel e comprovante não precisam morar no servidor.
 *
 * Reiniciou o servidor no meio? O robô responde pela descrição, que está
 * gravada. É o pior caso, e é bom o bastante.
 */
type Midia = { base64: string; mimeType: string; guardadaEm: number };

const VALIDADE_MS = 30 * 60_000;
/** Teto por mídia: o Gemini aceita até ~20 MB por pedido, junto com o prompt. */
export const TAMANHO_MAXIMO_DA_MIDIA = 12 * 1024 * 1024;
const MAXIMO_GUARDADAS = 60;

function guardadas(): Map<string, Midia> {
  const g = globalThis as any;
  if (!g.__midiasDoAtendimento) g.__midiasDoAtendimento = new Map<string, Midia>();
  return g.__midiasDoAtendimento;
}

/** Tamanho em bytes de um base64 (sem decodificar). */
export const bytesDoBase64 = (base64: string) => Math.floor((String(base64 || "").replace(/^data:[^,]+,/, "").length * 3) / 4);

export function guardarMidia(mensagemId: string, base64: string, mimeType: string) {
  if (!mensagemId || !base64 || bytesDoBase64(base64) > TAMANHO_MAXIMO_DA_MIDIA) return;
  const mapa = guardadas();
  const agora = Date.now();
  for (const [id, m] of mapa) if (agora - m.guardadaEm > VALIDADE_MS) mapa.delete(id);
  while (mapa.size >= MAXIMO_GUARDADAS) mapa.delete(mapa.keys().next().value as string);
  mapa.set(mensagemId, { base64: base64.replace(/^data:[^,]+,/, ""), mimeType: String(mimeType || "image/jpeg").split(";")[0].trim(), guardadaEm: agora });
}

export function midiaGuardada(mensagemId: string): { base64: string; mimeType: string } | null {
  const m = guardadas().get(mensagemId);
  if (!m || Date.now() - m.guardadaEm > VALIDADE_MS) return null;
  return { base64: m.base64, mimeType: m.mimeType };
}

// ── Mídia ainda sendo lida ────────────────────────────────────────────────
// A leitura (baixar + descrever) roda depois de o webhook responder (entrada.ts):
// três fotos de cardápio seguidas segurariam o gateway meio minuto. Enquanto
// alguma mídia do contato está sendo lida, o robô espera (robo.ts) — senão
// responderia "a imagem não chegou" para um print que está chegando. Prazo de
// 90 s: leitura travada não cala o robô para sempre.
const PRAZO_DA_LEITURA_MS = 90_000;

function emLeitura(): Map<string, Map<string, number>> {
  const g = globalThis as any;
  if (!g.__midiasEmLeitura) g.__midiasEmLeitura = new Map<string, Map<string, number>>();
  return g.__midiasEmLeitura;
}

export function comecouALer(contatoId: string, mensagemId: string) {
  const mapa = emLeitura();
  if (!mapa.has(contatoId)) mapa.set(contatoId, new Map());
  mapa.get(contatoId)!.set(mensagemId, Date.now());
}

export function terminouDeLer(contatoId: string, mensagemId: string) {
  const doContato = emLeitura().get(contatoId);
  doContato?.delete(mensagemId);
  if (doContato && !doContato.size) emLeitura().delete(contatoId);
}

export function midiaSendoLida(contatoId: string): boolean {
  const doContato = emLeitura().get(contatoId);
  if (!doContato) return false;
  for (const [id, desde] of doContato) if (Date.now() - desde > PRAZO_DA_LEITURA_MS) doContato.delete(id);
  return doContato.size > 0;
}

/** Os tipos de arquivo que o Gemini lê: imagem, vídeo e PDF. */
export function midiaQueOModeloLe(mimeType: string): boolean {
  const m = String(mimeType || "").toLowerCase();
  return m.startsWith("image/") || m.startsWith("video/") || m === "application/pdf";
}
