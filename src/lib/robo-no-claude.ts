/**
 * O robô no Claude Haiku 5.5 (API da Anthropic) no lugar do Gemini 3.6.
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 *
 * O Gemini 3.6 Flash dobra de preço em 01/01/2027. No laboratório de 26 a
 * 29/10/2026 (worktree wt-robo-ab, scripts/ab-do-robo.ts: 15 lojas, baterias
 * grande, difícil, severa e de conta conferida com o sistema) o Haiku, com as
 * regras de lib/regras-do-claude.ts no fim do prompt, empatou ou ganhou do 3.6
 * em tudo, custando de um terço a um quarto. Vault: "FireHub - Plano custo de
 * IA em janeiro 2027".
 *
 * ── Como liga ───────────────────────────────────────────────────────────────
 *
 * Loja a loja: `chatbotConfig.modeloDoRobo = "claude-haiku-5-5"`
 * (scripts/robo-no-claude.ts liga e desliga; a tela do lojista não mexe no
 * campo) E a chave da Anthropic: ANTHROPIC_API_KEY no servidor ou, como a do
 * Gemini, `anthropicApiKey` no chatbotConfig da conta matriz (isFireHubSystem;
 * o navegador não a vê, lib/gateway-da-loja.ts). Faltando a marca ou a chave,
 * o robô segue no Gemini, exatamente como antes. O modo dono continua no Gemini.
 *
 * ── O que muda em relação ao Gemini ─────────────────────────────────────────
 *
 * - Áudio: o Claude não ouve. O Gemini 3.6 transcreve (sem pensamento) e a
 *   transcrição entra no lugar do áudio — o mesmo caminho testado no
 *   laboratório. Foto vai como imagem, o Claude lê.
 * - Prompt da loja: vai no `system` com cache da Anthropic (5 min; leitura a
 *   10% da entrada). Não usa o cache explícito do Google (lib/cache-do-prompt.ts).
 * - Sem temperatura: o Haiku 5.5 recusa (400). Pensamento adaptativo, no
 *   padrão do modelo (o mesmo do laboratório).
 * - Qualquer falha (chave, crédito, lentidão, recusa, resposta cortada) cai no
 *   Gemini 3.6 na mesma mensagem: o cliente não sente. Ver chatbot-ai.ts.
 *
 * A resposta volta no formato do Gemini ({ text, usageMetadata }) para o resto
 * do robô — limpeza, marcas, gravação do pedido — não mudar nada.
 */
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import { prisma } from "@/lib/prisma";
import { REGRAS_DO_CLAUDE } from "./regras-do-claude";

export const MODELO_CLAUDE = "claude-haiku-5-5";
const MODELO_DA_TRANSCRICAO = "gemini-3.6-flash";

let cacheDaChave: { valor: string | null; expiraEm: number } | null = null;

/** A chave da Anthropic: o ambiente e, sem ele, a conta matriz (cache de 5 min, como a do Gemini em chatbot-ai.ts). */
export async function chaveDoClaude(): Promise<string | null> {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  if (cacheDaChave && cacheDaChave.expiraEm > Date.now()) return cacheDaChave.valor;
  try {
    const matriz = await prisma.user.findFirst({ where: { isFireHubSystem: true }, select: { chatbotConfig: true } });
    const valor = ((matriz?.chatbotConfig as any)?.anthropicApiKey as string) || null;
    // A ausência também fica 5 min: sem chave é o caso comum, e seria uma consulta por mensagem.
    cacheDaChave = { valor, expiraEm: Date.now() + 5 * 60 * 1000 };
    return valor;
  } catch (err) {
    console.error("[Robô no Claude] Falha ao ler a chave da conta matriz:", (err as Error)?.message);
    return null;
  }
}

/** A loja responde pelo Claude: marcada no chatbotConfig e com a chave da Anthropic. */
export function lojaNoClaude(chatbotConfig: any, chave: string | null): boolean {
  return chatbotConfig?.modeloDoRobo === MODELO_CLAUDE && Boolean(chave);
}

type Parte = { text?: string; inlineData?: { data: string; mimeType: string } };
type Conteudo = { role: string; parts: Parte[] };
type UsoDoGemini = { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; cachedContentTokenCount?: number };

let cliente: { chave: string; sdk: Anthropic } | null = null;
// Sem nova tentativa no SDK: quem tenta de novo é o Gemini, logo em seguida.
const claude = (chave: string) => {
  if (cliente?.chave !== chave) cliente = { chave, sdk: new Anthropic({ apiKey: chave, maxRetries: 0 }) };
  return cliente.sdk;
};

/** O Gemini 3.6 transcreve o áudio do cliente (o Claude não ouve). Também usado pelo assessor no Claude. */
export async function transcrever(audio: { data: string; mimeType: string }, apiKey: string, signal: AbortSignal) {
  const r = await new GoogleGenAI({ apiKey }).models.generateContent({
    model: MODELO_DA_TRANSCRICAO,
    contents: [{ role: "user", parts: [
      { inlineData: audio },
      { text: "Transcreva exatamente o que o cliente falou neste áudio de WhatsApp, em português, sem comentar nada." },
    ] }],
    config: { temperature: 0, maxOutputTokens: 400, thinkingConfig: { thinkingBudget: 0 }, abortSignal: signal },
  });
  const texto = String(r.text || "").trim().replace(/"/g, "'");
  if (!texto) throw new Error("transcrição do áudio veio vazia");
  return { texto, uso: r.usageMetadata as UsoDoGemini | undefined };
}

export async function respostaDoClaude(p: {
  contents: Conteudo[];
  systemInstruction: string;
  signal: AbortSignal;
  /** A chave da Anthropic (`chaveDoClaude`). */
  chave: string;
  /** A chave do Gemini, para transcrever o áudio. */
  geminiApiKey: string;
}): Promise<{ text: string; usageMetadata: UsoDoGemini; usoDaTranscricao?: UsoDoGemini; motivoSemTexto?: string }> {
  let usoDaTranscricao: UsoDoGemini | undefined;
  const mensagens: Anthropic.MessageParam[] = [];

  for (const c of p.contents) {
    const role = c.role === "model" ? "assistant" : "user";
    const blocos: Anthropic.ContentBlockParam[] = [];
    for (const parte of c.parts || []) {
      const mime = parte.inlineData?.mimeType || "";
      if (mime.startsWith("audio/")) {
        const t = await transcrever(parte.inlineData!, p.geminiApiKey, p.signal);
        usoDaTranscricao = t.uso;
        blocos.push({ type: "text", text: `[O cliente mandou um ÁUDIO. Transcrição automática do que ele falou: "${t.texto}"]` });
      } else if (mime.startsWith("image/")) {
        blocos.push({ type: "image", source: { type: "base64", media_type: mime as "image/jpeg", data: parte.inlineData!.data } });
      } else if (parte.text?.trim() && !/^O cliente enviou uma mensagem de voz/.test(parte.text)) {
        // A instrução "ouça o áudio acima" é do Gemini; aqui a transcrição já está no texto.
        blocos.push({ type: "text", text: parte.text });
      }
    }
    if (!blocos.length) continue;
    // A API quer as falas alternadas: duas seguidas do mesmo lado viram uma.
    const anterior = mensagens[mensagens.length - 1];
    if (anterior?.role === role) (anterior.content as Anthropic.ContentBlockParam[]).push(...blocos);
    else mensagens.push({ role, content: blocos });
  }

  const r = await claude(p.chave).messages.create(
    {
      model: MODELO_CLAUDE,
      // O pensamento conta dentro do max_tokens: folga para ele e para o resumo do pedido.
      max_tokens: 8000,
      system: [{ type: "text", text: `${p.systemInstruction}\n\n${REGRAS_DO_CLAUDE}`, cache_control: { type: "ephemeral" } }],
      messages: mensagens,
    },
    { signal: p.signal },
  );

  const u = r.usage;
  const lido = u.cache_read_input_tokens || 0;
  // Recusa e resposta cortada não vão ao cliente: sem texto, o robô passa para o Gemini.
  const cortada = r.stop_reason === "refusal" || r.stop_reason === "max_tokens";
  return {
    text: cortada ? "" : r.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim(),
    ...(cortada ? { motivoSemTexto: r.stop_reason! } : {}),
    usageMetadata: {
      // Para o usage-tracker: a entrada inteira, com o pedaço lido do cache (cobrado a 10%).
      // A escrita do cache (1,25x, só na primeira mensagem em 5 min) entra como entrada comum.
      promptTokenCount: u.input_tokens + (u.cache_creation_input_tokens || 0) + lido,
      // No Claude o pensamento já vem dentro dos tokens de saída.
      candidatesTokenCount: u.output_tokens,
      cachedContentTokenCount: lido,
    },
    usoDaTranscricao,
  };
}
