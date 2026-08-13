import * as googleTTS from "google-tts-api";

/**
 * Converte um texto longo para áudio usando a API gratuita do Google TTS.
 * Retorna o base64 completo do áudio (formato MP3 ou semelhante).
 */
export async function textToSpeechBase64(text: string): Promise<string | null> {
  try {
    const urls = googleTTS.getAllAudioUrls(text, {
      lang: "pt-BR",
      slow: false,
      host: "https://translate.google.com",
    });

    if (!urls || urls.length === 0) return null;

    const buffers: Buffer[] = [];
    for (const { url } of urls) {
      const res = await fetch(url);
      if (!res.ok) continue;
      const arrayBuffer = await res.arrayBuffer();
      buffers.push(Buffer.from(arrayBuffer));
    }

    if (buffers.length === 0) return null;

    const finalBuffer = Buffer.concat(buffers);
    return finalBuffer.toString("base64");
  } catch (err) {
    console.error("[TTS Error]", err);
    return null;
  }
}
