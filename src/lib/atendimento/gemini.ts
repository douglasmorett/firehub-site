import { GoogleGenAI } from "@google/genai";
import { prisma } from "@/lib/prisma";

/**
 * A chave e o cliente do Gemini para o atendimento do FireHub.
 *
 * A ordem é a do robô das lojas (`resolverChaveGemini` em lib/chatbot-ai.ts):
 * variável de ambiente primeiro, depois a chave guardada na conta matriz
 * (isFireHubSystem). Repetida aqui em vez de importada porque aquela função
 * não é exportada e o arquivo do robô das lojas é o mais mexido do projeto.
 */
let cacheDaMatriz: { valor: string | null; expiraEm: number } | null = null;

export async function chaveDoGemini(): Promise<string | null> {
  const doAmbiente = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || process.env.VITE_GEMINI_API_KEY;
  if (doAmbiente) return doAmbiente;
  if (cacheDaMatriz && cacheDaMatriz.expiraEm > Date.now()) return cacheDaMatriz.valor;
  try {
    const matriz = await prisma.user.findFirst({ where: { isFireHubSystem: true }, select: { chatbotConfig: true } });
    const valor = ((matriz?.chatbotConfig as any)?.geminiApiKey as string) || null;
    if (valor) cacheDaMatriz = { valor, expiraEm: Date.now() + 5 * 60_000 };
    return valor;
  } catch {
    return null;
  }
}

export async function clienteDoGemini(): Promise<GoogleGenAI | null> {
  const chave = await chaveDoGemini();
  return chave ? new GoogleGenAI({ apiKey: chave }) : null;
}

/**
 * O que a pessoa disse no áudio, em texto — para a conversa na tela e para o
 * robô. Vazio quando não deu (a tela mostra "áudio" e segue).
 */
export async function transcreverAudio(base64: string, mimeType = "audio/ogg"): Promise<string> {
  const ai = await clienteDoGemini();
  if (!ai || !base64) return "";
  for (const modelo of ["gemini-2.5-flash", "gemini-2.0-flash"]) {
    try {
      const r = await ai.models.generateContent({
        model: modelo,
        contents: [{
          role: "user",
          parts: [
            { inlineData: { mimeType: mimeType.split(";")[0] || "audio/ogg", data: base64.replace(/^data:[^,]+,/, "") } },
            { text: "Transcreva este áudio de WhatsApp em português, exatamente como a pessoa falou, sem comentários. Se não houver fala, responda só: [sem fala]" },
          ],
        }],
        config: { temperature: 0 },
      });
      const texto = (r.text || "").trim();
      if (texto) return texto === "[sem fala]" ? "" : texto.slice(0, 4000);
    } catch (err: any) {
      console.warn(`[Atendimento] Transcrição com ${modelo} falhou: ${err?.message}`);
    }
  }
  return "";
}
