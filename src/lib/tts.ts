import * as googleTTS from "google-tts-api";

/**
 * Converte um texto longo para áudio usando ElevenLabs se disponível,
 * ou a API gratuita do Google TTS como fallback.
 * Retorna o base64 completo do áudio (formato MP3 ou semelhante).
 */
export async function textToSpeechBase64(text: string): Promise<string | null> {
  const elevenLabsKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID || "EXAVITQu4vr4xnSDxMaL"; // Default Sarah voice or similar

  if (elevenLabsKey) {
    try {
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: "POST",
        headers: {
          "Accept": "audio/mpeg",
          "Content-Type": "application/json",
          "xi-api-key": elevenLabsKey,
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_multilingual_v2",
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          }
        }),
      });

      if (response.ok) {
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        return buffer.toString("base64");
      } else {
        console.warn("[TTS] Erro no ElevenLabs (caiu pro Fallback):", await response.text());
      }
    } catch (err) {
      console.error("[TTS] Exceção no ElevenLabs:", err);
    }
  }

  // Fallback para Google TTS Gratuito
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
