import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || "" });

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

    // Formatar horários de funcionamento
    let hoursText = "Horário de funcionamento padrão: Todos os dias das 18:00 às 23:30.";
    let nowStatusText = "";
    if (Array.isArray(user.storeHours) && (user.storeHours as any[]).length > 0) {
      const hoursArr = user.storeHours as any[];
      hoursText = hoursArr
        .map((h: any) => `${h.day || h.dayName || "Dia"}: ${h.active ? `${h.open || "18:00"} às ${h.close || "23:30"}` : "Fechado"}`)
        .join("\n");

      const now = new Date();
      const dayIdx = now.getDay() === 0 ? 6 : now.getDay() - 1;
      const today = hoursArr[dayIdx];
      if (today && today.active) {
        nowStatusText = `Hoje funcionamos das ${today.open} às ${today.close}.`;
      } else if (today && !today.active) {
        nowStatusText = "Hoje a loja está fechada.";
      }
    }

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
Seu objetivo é atender o cliente no WhatsApp de forma humana, fluida, sem erros, sanar dúvidas sobre o cardápio, horários de funcionamento, endereço e ajudar a fazer o pedido.

📍 **DADOS DA LOJA**:
- Nome: ${user.storeName || "Nossa Loja"}
- Cidade/Endereço: ${user.storeAddress || user.city || "Não informado"}
- Telefone: ${user.storePhone || "Não informado"}
- Link do Cardápio Digital: ${storeLink}
- Status de Funcionamento Hoje: ${nowStatusText || "Aberto normalmente"}

⏰ **HORÁRIOS DE FUNCIONAMENTO**:
${hoursText}

📋 **CARDÁPIO COMPLETO E PREÇOS AO VIVO**:
${catalogSummary || "Cardápio em atualização."}

⚙️ **PERSONALIDADE E ESTILO**:
${personalityInstruction}
${customPrompt ? `\n📌 **INSTRUÇÕES EXTRAS DA LOJA**: ${customPrompt}` : ""}

🎯 **REGRAS INVIOLÁVEIS DE ATENDIMENTO**:
1. Responda DIRETAMENTE à pergunta feita pelo cliente. Se ele perguntou "que horas abre" ou sobre horários, informe o horário exato de abertura com clareza.
2. NUNCA mande uma saudação genérica repetida se o cliente fez uma pergunta direta.
3. Responda em Português do Brasil de forma fluida, natural e inteligente (estilo Gemini / Brendi).
4. NUNCA invente produtos, horários ou preços que não estejam listados acima.
5. Se o cliente demonstrar intenção de pedir, informe os itens e envie o link direto para finalizar: ${storeLink}.
6. NUNCA diga que é um robô genérico. Você é a atendente oficial do ${user.storeName}.
`;

    // Chamada à API Gemini (Model gemini-2.0-flash)
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.0-flash",
        contents: [
          { role: "user", parts: [{ text: `${systemPrompt}\n\nHistorico da conversa:\n${(history || []).map((h: any) => `${h.sender}: ${h.text}`).join("\n")}\n\nCliente: ${message}` }] },
        ],
      });

      const replyText = response.text || `Olá! Sou o atendente virtual do ${user.storeName}. ${nowStatusText} Como posso te ajudar hoje? Confira nosso cardápio completo em ${storeLink}!`;

      return NextResponse.json({ reply: replyText });
    } catch (geminiErr: any) {
      console.warn("[Chatbot AI Fallback] Gemini API call failed, using intelligent fallback:", geminiErr);

      // Smart Fallback Inteligente baseado na pergunta exata do cliente
      let fallbackReply = "";
      if (/horario|aberto|fecha|abre|fechado|horário|funcionamento|que horas/i.test(message)) {
        fallbackReply = `Olá! O ${user.storeName} ${nowStatusText || "funciona das 18:00 às 23:30"}. 😊\n\nConfira nosso cardápio completo e faça seu pedido em:\n👉 ${storeLink}`;
      } else if (/cardapio|menu|opções|fome|preço|valor|lanche|burger|comida/i.test(message)) {
        fallbackReply = `Olá! Confira todos os nossos produtos e valores ao vivo pelo nosso cardápio digital:\n👉 ${storeLink}`;
      } else if (/entrega|frete|taxa|endereço|local|onde fica/i.test(message)) {
        fallbackReply = `Olá! Nosso endereço é ${user.storeAddress || user.city || "consulte pelo link"}.\nFaça seu pedido diretamente pelo link:\n👉 ${storeLink}`;
      } else {
        fallbackReply = `Olá! Sou o atendente virtual do ${user.storeName}! 😊 Como posso te ajudar hoje? Você pode ver nosso cardápio completo e fazer seu pedido por aqui:\n👉 ${storeLink}`;
      }

      return NextResponse.json({ reply: fallbackReply });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Erro no processamento da IA" }, { status: 500 });
  }
}
