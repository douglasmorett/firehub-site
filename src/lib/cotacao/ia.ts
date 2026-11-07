/**
 * A IA DA COTAÇÃO — lê a tabela de preços que o fornecedor mandou (texto,
 * foto do encarte, PDF, áudio) e a lista de produtos que o lojista mandou
 * (foto da nota, PDF, áudio, texto). É a única porta para o modelo: o resto da
 * cotação é puro e testado sem ela (./leitura.ts confere o que volta daqui).
 *
 * O mesmo Gemini do Bill e do robô (lib/assessor/assessor.ts): ouve o áudio e
 * lê foto e PDF direto (inlineData), sem transcrever antes; o 2.5 é a reserva.
 * O consumo entra no painel de uso da loja (trackGeminiUsage, origem "cotacao").
 */
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { trackGeminiUsage } from "@/lib/usage-tracker";
import { linhasDaIa, unidadeDeCompra, type LinhaDePreco, type ProdutoLido } from "./leitura";

export type Midia = { base64: string; mimeType: string };

const MODELOS = ["gemini-3.6-flash", "gemini-2.5-flash"];

function chave() {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || "";
}

/** Uma chamada em JSON, com a reserva. Devolve o objeto lido (ou nulo). */
async function pedirJson(franchiseeId: string, origem: string, prompt: string, texto: string, midia: Midia | null): Promise<any | null> {
  const key = chave();
  if (!key) return null;
  const ai = new GoogleGenAI({ apiKey: key });
  const partes: any[] = [];
  if (midia?.base64) partes.push({ inlineData: { data: midia.base64, mimeType: midia.mimeType } });
  partes.push({ text: texto || "(sem texto: leia o anexo)" });
  for (const modelo of MODELOS) {
    try {
      const r = await ai.models.generateContent({
        model: modelo,
        contents: [{ role: "user", parts: partes }],
        config: {
          systemInstruction: prompt,
          temperature: 0.1,
          responseMimeType: "application/json",
          ...(modelo.startsWith("gemini-3") ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } : {}),
        },
      });
      const u = r.usageMetadata;
      trackGeminiUsage(franchiseeId, modelo, u?.promptTokenCount || 0, u?.candidatesTokenCount || 0, { origem }, { thoughtsTokens: u?.thoughtsTokenCount || 0, cachedTokens: u?.cachedContentTokenCount || 0 });
      const bruto = r.text || "";
      const json = bruto.match(/\{[\s\S]*\}|\[[\s\S]*\]/)?.[0];
      if (!json) return null;
      return JSON.parse(json);
    } catch (err: any) {
      console.error(`[Cotação] ${modelo} falhou (${origem}):`, err?.message || err);
    }
  }
  return null;
}

const PROMPT_DOS_PRECOS = `Você lê a TABELA DE PREÇOS que um FORNECEDOR mandou para um restaurante pelo WhatsApp: pode ser texto digitado, foto ou PDF de encarte/tabela, ou áudio falando os preços.

Extraia CADA produto que tem preço:
- "nome": o produto como está escrito, com as abreviações abertas quando for óbvio ("QJO MUSS" → "Queijo mussarela"), com marca e tamanho se houver ("Coca-Cola lata 350ml").
- "unidade": a unidade de VENDA do preço: un, kg, g, cx, fd (fardo), pct, dz, l, sc, bd, gf, lt.
- "preco": o preço em reais por essa unidade, como NÚMERO (42.9).
- "validade": se a tabela disser até quando vale ("válido até 10/11", "só hoje"), o texto; senão null.

Não invente produto nem preço. Ignore frete, taxa, pedido mínimo, telefone e endereço. Se não houver nenhum preço (só conversa, "bom dia", "ok"), devolva itens vazio.
Se for áudio, ponha em "transcricao" o que foi falado; senão null.

Responda SÓ o JSON: {"itens":[{"nome":"...","unidade":"kg","preco":42.9,"validade":null}],"transcricao":null}`;

/**
 * Os preços de uma mensagem do fornecedor. `produtosDaLoja` vai como dica de
 * vocabulário (para abrir abreviação), nunca como lista a preencher.
 */
export async function lerPrecosComIa(
  franchiseeId: string,
  entrada: { texto: string; midia: Midia | null },
  produtosDaLoja: string[],
): Promise<{ linhas: LinhaDePreco[]; transcricao: string | null } | null> {
  const dica = produtosDaLoja.length ? `\n\nProdutos que esta loja costuma comprar (só para entender abreviações; NÃO invente preço para eles): ${produtosDaLoja.slice(0, 150).join("; ")}` : "";
  const r = await pedirJson(franchiseeId, "cotacao_precos", PROMPT_DOS_PRECOS + dica, entrada.texto, entrada.midia);
  if (!r) return null;
  return { linhas: linhasDaIa(r), transcricao: typeof r.transcricao === "string" && r.transcricao.trim() ? r.transcricao.trim().slice(0, 4000) : null };
}

const PROMPT_DOS_PRODUTOS = `Você monta a LISTA DE COMPRAS de um restaurante: os produtos que ele compra dos fornecedores. A entrada pode ser texto, foto ou PDF de uma nota fiscal de compra ou de uma lista escrita, ou áudio do dono falando.

Para cada produto:
- "nome": nome limpo, sem código do fornecedor ("QJO MUSS PECA" → "Queijo mussarela peça"); marca e tamanho só se fizerem diferença na compra.
- "unidade": como ele COMPRA: un, kg, cx, fd (fardo), pct, dz, l, sc, bd, gf, lt.
- "quantidade": a quantidade que aparece (na nota, a comprada; no áudio, a falada), como número; senão null.
- "categoria": uma categoria curta de compra (Hortifruti, Carnes, Frios e laticínios, Bebidas, Mercearia, Embalagens, Limpeza, Padaria) ou null.

Não repita produto. Não invente. Responda SÓ o JSON: {"itens":[{"nome":"...","unidade":"kg","quantidade":5,"categoria":"Hortifruti"}]}`;

/** Os produtos de uma foto/PDF/áudio/texto, para o lojista conferir antes de gravar. */
export async function lerProdutosComIa(franchiseeId: string, entrada: { texto: string; midia: Midia | null }): Promise<ProdutoLido[] | null> {
  const r = await pedirJson(franchiseeId, "cotacao_produtos", PROMPT_DOS_PRODUTOS, entrada.texto, entrada.midia);
  if (!r) return null;
  const lista = Array.isArray(r) ? r : Array.isArray(r.itens) ? r.itens : [];
  const vistos = new Set<string>();
  const saida: ProdutoLido[] = [];
  for (const it of lista) {
    const nome = String(it?.nome ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
    if (!nome || vistos.has(nome.toLowerCase())) continue;
    vistos.add(nome.toLowerCase());
    const q = Number(it?.quantidade);
    saida.push({
      nome,
      unidade: unidadeDeCompra(it?.unidade) || "un",
      quantidade: Number.isFinite(q) && q > 0 ? q : null,
      categoria: typeof it?.categoria === "string" && it.categoria.trim() ? it.categoria.trim().slice(0, 60) : null,
    });
  }
  return saida.slice(0, 300);
}
