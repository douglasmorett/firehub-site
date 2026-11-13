/**
 * O NCM QUE SOBROU EM BRANCO, sugerido pela IA pela descrição do produto —
 * sempre gravado como "sugerido, conferir" (CaixaMercadoProduto.ncmSugerido):
 * o contador confere na planilha por NCM, e a nota de compra que chegar
 * depois com o EAN troca a sugestão pelo NCM declarado pelo fornecedor.
 *
 * O mesmo Gemini da Cotação (lib/cotacao/ia.ts): modelos, reserva e consumo
 * no painel de uso da loja (trackGeminiUsage, origem "caixa_mercado_ncm").
 */
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { trackGeminiUsage } from "@/lib/usage-tracker";
import { ncmDaIa } from "./importacao/ncm";

const MODELOS = ["gemini-3.6-flash", "gemini-2.5-flash"];

const PROMPT = `Você classifica produtos de SUPERMERCADO do Brasil na NCM (Nomenclatura Comum do Mercosul, 8 dígitos, tabela TIPI vigente).
Para cada produto da lista, devolva o NCM mais provável pela descrição (marca, tipo, embalagem).
Regras:
- NCM com 8 dígitos, só números (ex.: "22021000" para refrigerante, "04012010" para leite UHT integral, "19053100" para biscoito doce).
- Se a descrição for ambígua demais para escolher, devolva null para aquele produto (não chute).
- Não invente produto. Use o mesmo "id" recebido.
Responda SÓ o JSON: {"itens":[{"id":"...","ncm":"22021000"}]}`;

export async function sugerirNcmsComIa(lojaId: string, produtos: { id: string; nome: string }[]): Promise<{ id: string; ncm: string }[] | null> {
  const chave = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || "";
  if (!chave || produtos.length === 0) return chave ? [] : null;
  const ai = new GoogleGenAI({ apiKey: chave });
  const lista = produtos.map((p) => ({ id: p.id, descricao: p.nome }));
  for (const modelo of MODELOS) {
    try {
      const r = await ai.models.generateContent({
        model: modelo,
        contents: [{ role: "user", parts: [{ text: JSON.stringify(lista) }] }],
        config: {
          systemInstruction: PROMPT,
          temperature: 0.1,
          responseMimeType: "application/json",
          ...(modelo.startsWith("gemini-3") ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } : {}),
        },
      });
      const u = r.usageMetadata;
      trackGeminiUsage(lojaId, modelo, u?.promptTokenCount || 0, u?.candidatesTokenCount || 0, { origem: "caixa_mercado_ncm" }, { thoughtsTokens: u?.thoughtsTokenCount || 0, cachedTokens: u?.cachedContentTokenCount || 0 });
      const json = (r.text || "").match(/\{[\s\S]*\}/)?.[0];
      if (!json) continue;
      const ids = new Set(produtos.map((p) => p.id));
      const itens = Array.isArray(JSON.parse(json)?.itens) ? JSON.parse(json).itens : [];
      return itens
        .map((i: any) => ({ id: String(i?.id || ""), ncm: ncmDaIa(i?.ncm) }))
        .filter((i: { id: string; ncm: string | null }): i is { id: string; ncm: string } => ids.has(i.id) && Boolean(i.ncm));
    } catch (err: any) {
      console.error(`[Caixa de mercado] NCM pela IA: ${modelo} falhou:`, err?.message || err);
    }
  }
  return null;
}
