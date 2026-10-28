/**
 * SÓ PARA O LABORATÓRIO DE A/B (scripts/ab-do-robo.ts): responde no lugar do
 * Gemini por outro provedor, via OpenRouter (uma chave, vários modelos:
 * Claude, OpenAI, DeepSeek, Qwen...), para comparar QUALIDADE, TEMPO e CUSTO
 * no robô de verdade, com o mesmo prompt e o mesmo histórico.
 *
 * NÃO vai para produção: só é chamado com FIREHUB_AB_PROVEDOR=openrouter e um
 * modelo com "/" ("anthropic/claude-haiku-5.5"). Se um candidato passar,
 * produção fala direto com o provedor (no Claude, pelo SDK da Anthropic).
 *
 * Recebe o pedido no formato do Gemini (`contents` com role user/model e
 * `systemInstruction`) e devolve `{ text, usageMetadata }` no formato do
 * Gemini, para o resto do robô não mudar. O custo exato em US$ vem do próprio
 * OpenRouter (`usage.cost`).
 *
 *   OPENROUTER_API_KEY   chave (no .env.local)
 *   FIREHUB_AB_ESFORCO   low | medium | high (pensamento); vazio = padrão do modelo
 */
type Parte = { text?: string; inlineData?: { data: string; mimeType: string } };
type Conteudo = { role: string; parts?: Parte[] };

function paraMensagem(c: Conteudo) {
  const role = c.role === "model" ? "assistant" : "user";
  const partes = (c.parts || []).flatMap((p): any[] => {
    if (p.text) return [{ type: "text", text: p.text }];
    // Imagem vai; áudio não (no robô de verdade o áudio continua no Gemini).
    if (p.inlineData && p.inlineData.mimeType.startsWith("image/"))
      return [{ type: "image_url", image_url: { url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}` } }];
    return [];
  });
  if (!partes.length) return null;
  return { role, content: partes.length === 1 && partes[0].type === "text" ? (partes[0] as any).text : partes };
}

export async function abOpenRouter(params: { model: string; contents: Conteudo[]; config?: any }) {
  const chave = process.env.OPENROUTER_API_KEY;
  if (!chave) throw new Error("OPENROUTER_API_KEY não está no .env.local");
  const sistema = String(params.config?.systemInstruction || "");
  const esforco = process.env.FIREHUB_AB_ESFORCO;

  const corpo: any = {
    model: params.model,
    messages: [
      // O prompt da loja com marca de cache: o Claude só guarda com ela; OpenAI/DeepSeek guardam sozinhos e ignoram.
      { role: "system", content: [{ type: "text", text: sistema, cache_control: { type: "ephemeral" } }] },
      ...params.contents.map(paraMensagem).filter(Boolean),
    ],
    max_tokens: params.config?.maxOutputTokens || 3000,
    usage: { include: true },
    // Só provedores que não guardam nem treinam com os dados.
    provider: { data_collection: "deny" },
    ...(esforco ? { reasoning: { effort: esforco } } : {}),
  };

  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json", "X-Title": "FireHub laboratorio A/B" },
    body: JSON.stringify(corpo),
    signal: params.config?.abortSignal,
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(`openrouter ${r.status}: ${JSON.stringify(j.error || j).slice(0, 300)}`);

  const u = j.usage || {};
  const g: any = globalThis;
  // O custo de verdade (US$) e quem serviu, para o relatório do laboratório.
  (g.__abCustos ||= []).push({ modelo: params.model, provedor: j.provider, custo: u.cost || 0 });
  return {
    text: String(j.choices?.[0]?.message?.content || ""),
    usageMetadata: {
      promptTokenCount: u.prompt_tokens || 0,
      candidatesTokenCount: Math.max(0, (u.completion_tokens || 0) - (u.completion_tokens_details?.reasoning_tokens || 0)),
      thoughtsTokenCount: u.completion_tokens_details?.reasoning_tokens || 0,
      cachedContentTokenCount: u.prompt_tokens_details?.cached_tokens || 0,
      custoUsd: u.cost || 0,
    },
  };
}
