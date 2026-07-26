import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "AIzaSy_demo_key" });

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: {
      id: true,
      ownerId: true,
      storeName: true,
      storePhone: true,
      storeAddress: true,
      city: true,
      slug: true,
      storeHours: true,
      deliveryConfig: true,
      chatbotConfig: true,
    },
  });

  if (!user) {
    return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  }

  const { message, history } = await req.json();

  if (!message) {
    return NextResponse.json({ error: "Mensagem vazia" }, { status: 400 });
  }

  const targetFranchiseeId = user.ownerId || user.id;

  try {
    // Buscar cardápio ao vivo da loja
    const [products, categories] = await Promise.all([
      prisma.menuProduct.findMany({
        where: { franchiseeId: targetFranchiseeId, active: true },
        select: { id: true, name: true, description: true, price: true, category: true, isCombo: true, isBeverage: true },
        orderBy: { category: "asc" },
      }),
      prisma.menuCategory.findMany({
        where: { franchiseeId: targetFranchiseeId },
        select: { name: true, emoji: true },
        orderBy: { sortOrder: "asc" },
      }),
    ]);

    const chatbotConfig = (user.chatbotConfig as any) || {};
    const personality = chatbotConfig.personality || "SIMPATICO";
    const customPrompt = chatbotConfig.customPrompt || "";

    // Formatar cardápio estruturado para a IA
    const catalogSummary = products
      .map((p) => `- ${p.name} (${p.category}): R$ ${p.price.toFixed(2).replace(".", ",")}${p.isBeverage ? " [BEBIDA]" : ""}${p.description ? ` — ${p.description}` : ""}`)
      .join("\n");

    const storeLink = user.slug ? `https://firehubfood.com/loja/${user.slug}` : "nosso cardápio digital";

    let personalityInstruction = "";
    if (personality === "SIMPATICO") {
      personalityInstruction = "Seja extremamente acolhedor, amigável e simpático. Use emojis adequados (😊, 🍔, 🥤, 🛵). Sempre sugira bebidas se o cliente pedir comida e vice-versa.";
    } else if (personality === "AGIL") {
      personalityInstruction = "Seja direto, rápido e objetivo. Responda com frases curtas e bullet points claros sem enrolação.";
    } else if (personality === "FORMAL") {
      personalityInstruction = "Use tom altamente profissional, cortês, elegante e impecável.";
    } else {
      personalityInstruction = "Seja divertido, bem-humorado e entusiasmado!";
    }

    const systemPrompt = `Você é a IA Atendente Virtual Oficial do restaurante "${user.storeName || "Nossa Loja"}".
Seu objetivo é atender o cliente no WhatsApp de forma humana, sem erros, sanar dúvidas sobre o cardápio e ajudar a fazer o pedido.

📍 **DADOS DA LOJA**:
- Nome: ${user.storeName || "Nossa Loja"}
- Cidade/Endereço: ${user.storeAddress || user.city || "Não informado"}
- Telefone: ${user.storePhone || "Não informado"}
- Link do Cardápio Digital: ${storeLink}

📋 **CARDÁPIO COMPLETO E PREÇOS AO VIVO**:
${catalogSummary || "Cardápio em atualização."}

⚙️ **PERSONALIDADE E ESTILO**:
${personalityInstruction}
${customPrompt ? `\n📌 **INSTRUÇÕES EXTRAS DA LOJA**: ${customPrompt}` : ""}

🎯 **REGRAS INVIOLÁVEIS DE ATENDIMENTO**:
1. Responda em Português do Brasil de forma fluida e natural.
2. NUNCA invente produtos ou preços que não estejam na lista acima.
3. Se o cliente demonstrar intenção de pedir, informe os itens e envie o link direto para finalizar: ${storeLink}.
4. NUNCA diga que é um robô genérico. Você é a atendente oficial do ${user.storeName}.
5. Responda de forma completa, clara e sem erros.
`;

    // Chamada à API Gemini
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [
          { role: "user", parts: [{ text: `${systemPrompt}\n\nHistorico da conversa:\n${(history || []).map((h: any) => `${h.sender}: ${h.text}`).join("\n")}\n\nCliente: ${message}` }] },
        ],
      });

      const replyText = response.text || `Olá! Sou o atendente virtual do ${user.storeName}. Como posso te ajudar hoje? Confira nosso cardápio completo em ${storeLink}!`;

      return NextResponse.json({ reply: replyText });
    } catch (geminiErr: any) {
      console.warn("[Chatbot AI Fallback] Gemini call failed, using intelligent fallback:", geminiErr);

      // Smart Fallback Inteligente
      let fallbackReply = `Olá! Sou o atendente virtual do ${user.storeName}! 😊\n\n`;
      if (/cardapio|menu|opções|fome|preço|valor/i.test(message)) {
        fallbackReply += `Confira todos os nossos produtos e combos ao vivo pelo nosso cardápio digital:\n👉 ${storeLink}\n\nSe precisar de ajuda para escolher, estou por aqui!`;
      } else if (/entrega|frete|taxa|endereço|local/i.test(message)) {
        fallbackReply += `Entregamos em toda a região! Nosso endereço é ${user.storeAddress || user.city}.\nFaça seu pedido diretamente pelo link:\n👉 ${storeLink}`;
      } else {
        fallbackReply += `Como posso te ajudar hoje? Você pode ver nosso cardápio completo e fazer seu pedido em 1 minuto por aqui:\n👉 ${storeLink}`;
      }

      return NextResponse.json({ reply: fallbackReply });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Erro no processamento da IA" }, { status: 500 });
  }
}
