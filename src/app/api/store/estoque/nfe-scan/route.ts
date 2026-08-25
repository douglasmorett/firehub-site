import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { GoogleGenAI } from "@google/genai";
import { trackVisionUsage } from "@/lib/usage-tracker";
import { lerImagemEnviada } from "@/lib/imagem-enviada";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// A foto da nota é lida do disco (fs), então esta rota precisa do runtime Node.
export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

    const email = session.user.email || "";
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, ownerId: true }
    });
    if (!user) return NextResponse.json({ error: "Lojista não encontrado" }, { status: 404 });

    // O STAFF é um User com ownerId apontando para o dono da loja: cobrando pelo id dele,
    // a leitura de nota feita pelo funcionário nunca aparecia no consumo da loja.
    const franchiseeId = user.ownerId || user.id;

    const { imageUrl } = await req.json();

    // A foto vem do /api/upload, que grava em disco e devolve "/uploads/...".
    // Fazer fetch dessa URL relativa estourava em "Failed to parse URL" dentro
    // do undici, e aceitar URL de qualquer host era SSRF (bastava mandar
    // http://169.254.169.254/). lerImagemEnviada lê o arquivo do disco e recusa
    // o que não veio do upload deste site.
    const imagem = await lerImagemEnviada(imageUrl, req);
    if (!imagem.ok) return NextResponse.json({ error: imagem.erro }, { status: 400 });

    const { base64: base64Data, mimeType } = imagem;

    const prompt = `Você é um assistente especialista em leitura de notas fiscais de COMPRA de insumos para restaurantes e estabelecimentos alimentícios.

O usuário enviou uma foto de uma nota fiscal de COMPRA (não de venda).

TIPOS DE DOCUMENTO:
- DANFE (Documento Auxiliar da Nota Fiscal Eletrônica)
- NF-e (Nota Fiscal Eletrônica)
- CF-e-SAT (Cupom Fiscal Eletrônico SAT)
- Cupom Fiscal de compra
- Nota de entrega de fornecedor
- Recibo de compra de insumos

SUA TAREFA:
Extraia TODOS os itens de compra listados na nota fiscal, com suas quantidades, unidades de medida e valores.

Para cada item, identifique:
1. Nome do produto/insumo (limpe abreviações quando possível, ex: "QJO MUCARELA" → "Queijo Muçarela")
2. Quantidade comprada
3. Unidade de medida (kg, g, un, l, ml, cx, pc, fd, etc. — padronize para minúsculas)
4. Valor unitário (R$)
5. Valor total do item (R$)

Também extraia:
- Nome do fornecedor/emissor (razão social ou nome fantasia)
- Número da nota fiscal
- Data de emissão
- Valor total da nota

Retorne um JSON válido com esta estrutura:
{
  "sucesso": true,
  "fornecedor": "Nome do Fornecedor",
  "numeroNF": "123456",
  "dataEmissao": "2026-08-12",
  "itens": [
    {
      "nome": "Queijo Muçarela",
      "quantidade": 5,
      "unidade": "kg",
      "valorUnitario": 42.00,
      "valorTotal": 210.00
    }
  ],
  "valorTotal": 422.50
}

Se a imagem NÃO for uma nota fiscal de compra ou não for legível:
{
  "sucesso": false,
  "motivoRejeicao": "Explique o motivo"
}

IMPORTANTE:
- Padronize unidades: quilograma → kg, grama → g, unidade → un, litro → l, mililitro → ml
- Se a unidade for "cx" (caixa), "fd" (fardo), "pc" (pacote), mantenha como está
- Limpe nomes de produtos removendo códigos internos do fornecedor
- Se houver desconto por item, use o valor com desconto
- NÃO RETORNE NENHUM TEXTO ALÉM DO JSON`;

    let aiText = "";
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [prompt, { inlineData: { data: base64Data, mimeType } }],
        config: { responseMimeType: "application/json" }
      });
      aiText = response.text ?? "";
    } catch (geminiError: any) {
      console.error("Gemini primary failed, trying fallback:", geminiError.message);
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [prompt, { inlineData: { data: base64Data, mimeType } }]
      });
      aiText = response.text ?? "";
    }

    if (!aiText?.trim()) {
      return NextResponse.json({ error: "A IA não retornou resposta. Tente novamente com uma foto mais nítida." }, { status: 400 });
    }

    // Extract JSON from response
    let jsonStr = aiText;
    const jsonMatch = aiText.match(/\{[\s\S]*\}/);
    if (jsonMatch) jsonStr = jsonMatch[0];

    const parsed = JSON.parse(jsonStr);
    
    if (!parsed.sucesso) {
      return NextResponse.json({ 
        success: false, 
        error: parsed.motivoRejeicao || "Não foi possível ler a nota fiscal" 
      }, { status: 400 });
    }

    // Track Vision AI usage (fire-and-forget)
    trackVisionUsage(franchiseeId, { imageUrl });

    return NextResponse.json({ success: true, data: parsed });
  } catch (error: any) {
    console.error("[NFe Scan] Error:", error);
    return NextResponse.json({ error: error.message || "Erro interno" }, { status: 500 });
  }
}
