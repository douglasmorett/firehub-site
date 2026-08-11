/**
 * POST /api/meta-ads/generate-creative
 * Gera texto de anúncio otimizado usando IA (Gemini)
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const franchiseeId = (session.user as any).id;

  const user = await prisma.user.findUnique({ where: { id: franchiseeId } });
  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  // Buscar produtos do cardápio e ordenar
  const allProducts = await (prisma as any).menuProduct.findMany({
    where: { franchiseeId, active: true },
    select: { name: true, price: true, category: true, imageUrl: true },
  });

  allProducts.sort((a: any, b: any) => {
    if (a.imageUrl && !b.imageUrl) return -1;
    if (!a.imageUrl && b.imageUrl) return 1;
    return (b.price || 0) - (a.price || 0);
  });

  const products = allProducts.slice(0, 6);

  const storeName = user.storeName ?? user.name ?? "Restaurante";
  const city = user.city ?? "";
  const productNames = products.map((p: any) => `${p.name} (R$${p.price})`).join(", ");

  // Gerar copy com Gemini
  const apiKey = process.env.GEMINI_API_KEY;
  let adCopy = `🍔 Peça agora em ${storeName}! Entrega rápida na sua região. Clique e aproveite!`;
  let adDescription = `Delivery ${storeName}${city ? ` em ${city}` : ""}. Cardápio completo com os melhores preços. Peça pelo nosso site!`;

  if (apiKey) {
    try {
      const prompt = `Você é um copywriter especialista em anúncios de delivery de comida para Facebook/Instagram.

Gere um texto de anúncio focado em delivery local para o restaurante "${storeName}"${city ? ` em ${city}` : ""}.
Produtos em destaque: ${productNames || "diversos pratos deliciosos"}

Regras estritas:
- Mencione o nome do restaurante ("${storeName}").
- Destaque que é delivery com entrega rápida na região.
- Crie um senso de urgência (ex: "Bateu a fome?", "Não perca tempo", "Peça agora").
- Use emojis estrategicamente, sem excessos.
- Texto principal (adCopy): curto e impactante, no máximo 3 linhas.
- Descrição (adDescription): super curta, no máximo 1 linha para a área de botão/CTA.

Responda EXATAMENTE neste formato JSON (sem markdown, apenas o JSON puro):
{"adCopy": "texto principal aqui", "adDescription": "descrição curta aqui"}`;

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.8, maxOutputTokens: 300 },
          }),
        }
      );

      if (res.ok) {
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
        // Limpa markdown se houver
        const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        const parsed = JSON.parse(cleaned);
        if (parsed.adCopy) adCopy = parsed.adCopy;
        if (parsed.adDescription) adDescription = parsed.adDescription;
      }
    } catch (err) {
      console.error("[MetaAds] Erro ao gerar copy com Gemini:", err);
      // Usa fallback hardcoded acima
    }
  }

  // Retorna produtos com imagem para o grid de seleção
  const productImages = products
    .filter((p: any) => p.imageUrl)
    .map((p: any) => ({ name: p.name, imageUrl: p.imageUrl, price: p.price }));

  return NextResponse.json({
    adCopy,
    adDescription,
    storeName,
    productImages,
  });
}
