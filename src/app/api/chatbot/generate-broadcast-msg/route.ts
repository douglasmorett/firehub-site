import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { GoogleGenAI } from "@google/genai";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  try {
    const user = await prisma.user.findUnique({
      where: { email: session.user?.email || "" },
      select: { id: true, name: true, slug: true, city: true, ownerId: true }
    });

    if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

    const storeName = user.name || "Nossa Loja";
    const storeLink = user.slug ? `https://firehub.com.br/loja/${user.slug}` : "";

    const apiKey = process.env.GEMINI_API_KEY || "";

    if (!apiKey) {
      // Fallback persuasivo se não houver API key configurada
      const fallbackMsgs = [
        `Oi! 🍕 Sentimos sua falta aqui na ${storeName}! Que tal aproveitar nossos combos hoje? Peça agora e receba quentinho na sua casa! ${storeLink}`,
        `Oie! 🔥 Liberamos uma oferta ESPECIAL hoje pra você na ${storeName}! Garanta o seu lanche favorito direto pelo nosso site: ${storeLink} 🚀`,
        `Que tal um lanche delicioso hoje? 🍔 Na ${storeName} preparamos tudo com muito carinho pra você! Peça já: ${storeLink} ❤️`,
        `Bateu aquela fome? 😋 Aproveite os melhores lanches da ${storeName} com entrega super rápida! Peça pelo link: ${storeLink}`
      ];
      const randomMsg = fallbackMsgs[Math.floor(Math.random() * fallbackMsgs.length)];
      return NextResponse.json({ success: true, message: randomMsg });
    }

    const ai = new GoogleGenAI({ apiKey });

    const prompt = `Você é um especialista em copywriting persuasivo e marketing digital para delivery de restaurantes no WhatsApp.
Crie UMA ÚNICA MENSAGEM CURTA, altamente atrativa, engajadora e vendedora para ser enviada aos clientes do restaurante "${storeName}".

REGRAS OBRIGATÓRIAS:
1. Use emojis chamativos e vibrantes (comida, fogo, coração, foguete, etc).
2. Crie senso de urgência ou oferta irresistível (ex: saudade do cliente, promoção do dia, combo imperdível).
3. Inclua obrigatoriamente a chamada para ação com o link do cardápio: ${storeLink ? storeLink : "[Link da Loja]"}.
4. Mantenha o texto com no máximo 250 caracteres, super leve e humano para o WhatsApp.
5. RESPONDA APENAS E SOMENTE COM O TEXTO DA MENSAGEM PRONTA (SEM ASAS, SEM MARCKDOWN, SEM TÍTULOS E SEM EXPLICAÇÕES).`;

    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });

    let generatedText = response.text || "";
    generatedText = generatedText
      .replace(/(\*\*|\*|_|#|`)/g, "")
      .replace(/^"|"$/g, "")
      .trim();

    if (!generatedText) {
      generatedText = `Oi! 🍕 Sentimos sua falta aqui na ${storeName}! Que tal aproveitar nossas delícias hoje? Peça já pelo nosso site: ${storeLink}`;
    }

    return NextResponse.json({ success: true, message: generatedText });
  } catch (err: any) {
    console.error("[Generate Broadcast Msg AI Error]:", err);
    const storeName = session.user?.name || "Nossa Loja";
    return NextResponse.json({
      success: true,
      message: `Oi! 🍕 Sentimos sua falta na ${storeName}! Que tal pedir um lanche delicioso hoje? Aproveite nossos combos exclusivos!`
    });
  }
}
