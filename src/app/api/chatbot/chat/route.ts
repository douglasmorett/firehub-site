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

    // Chamada à API Gemini (Model gemini-2.0-flash) se chave estiver disponível
    try {
      if (process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY) {
        const response = await ai.models.generateContent({
          model: "gemini-2.0-flash",
          contents: [
            { role: "user", parts: [{ text: `${systemPrompt}\n\nHistorico da conversa:\n${(history || []).map((h: any) => `${h.sender}: ${h.text}`).join("\n")}\n\nCliente: ${message}` }] },
          ],
        });

        if (response.text) {
          return NextResponse.json({ reply: response.text });
        }
      }
    } catch (geminiErr: any) {
      console.warn("[Chatbot AI Engine] Gemini API call skipped or failed, using ultra-smart local NLP engine:", geminiErr?.message || geminiErr);
    }

    // ─── ULTRA-SMART LOCAL AI NLP ENGINE (Respostas Precisas ao Vivo do Banco da Loja) ───
    const msg = message.toLowerCase().trim();

    // 1. Mais Vendidos / Destaques / Populares / Recomendações
    if (/mais vende|mais vendido|campeao|campeão|recomend|indic|sucesso|popular|melhor|especial|top|qual o melhor/i.test(msg)) {
      const topProducts = products.slice(0, 3);
      if (topProducts.length > 0) {
        const topList = topProducts
          .map((p) => `⭐ *${p.name}* (${p.category}) — R$ ${p.price.toFixed(2).replace(".", ",")}${p.description ? `\n   _${p.description}_` : ""}`)
          .join("\n\n");
        return NextResponse.json({
          reply: `Os campeões de vendas no *${user.storeName || "nosso restaurante"}* são:\n\n${topList}\n\nDeu fome? 😋 Faça seu pedido em 1 minuto pelo nosso cardápio digital:\n👉 ${storeLink}`
        });
      }
    }

    // 2. Refrigerantes / Bebidas / Bebida
    if (/refrigerante|refri|bebida|coca|suco|agua|água|guaraná|cerveja/i.test(msg)) {
      const bevs = products.filter((p) => p.isBeverage || /bebida|refrigerante|suco|coca|água|agua|cerveja/i.test(p.category || "") || /bebida|refrigerante|coca|suco/i.test(p.name));
      if (bevs.length > 0) {
        const bevList = bevs
          .map((b) => `🥤 *${b.name}* — R$ ${b.price.toFixed(2).replace(".", ",")}`)
          .join("\n");
        return NextResponse.json({
          reply: `Temos as seguintes opções de bebidas bem geladinhas no *${user.storeName || "nosso restaurante"}*:\n\n${bevList}\n\nQuer incluir alguma no seu pedido? Acesse:\n👉 ${storeLink}`
        });
      }
    }

    // 3. Horário de funcionamento / Que horas abre / Que horas fecha
    if (/horario|horário|aberto|fecha|abre|fechado|funcionamento|que horas/i.test(msg)) {
      return NextResponse.json({
        reply: `O *${user.storeName || "nosso restaurante"}* ${nowStatusText || "funciona das 18:00 às 23:30"}. 😊\n\nConfira todos os nossos horários e faça seu pedido pelo cardápio:\n👉 ${storeLink}`
      });
    }

    // 4. Endereço / Onde fica / Local
    if (/onde fica|endereço|endereco|local|bairro|rua|cidade|localização|localizacao/i.test(msg)) {
      return NextResponse.json({
        reply: `Ficamos localizados em: 📍 *${user.storeAddress || user.city || "Nossa Loja"}*.\n\nEntregamos na sua casa ou você pode retirar no local! Monte seu pedido em:\n👉 ${storeLink}`
      });
    }

    // 5. Entregas / Taxa / Frete / Entrega
    if (/entrega|frete|taxa|entregam|retirada/i.test(msg)) {
      return NextResponse.json({
        reply: `Fazemos entregas em toda a região de ${user.city || "nossa cidade"}! 🛵\n\nVocê pode consultar a taxa exata para o seu bairro e escolher entrega ou retirada no link:\n👉 ${storeLink}`
      });
    }

    // 6. Pagamento / Forma de pagamento / Aceita Pix / Cartão / Dinheiro
    if (/pagamento|forma|pix|cartao|cartão|dinheiro|troco|aceita/i.test(msg)) {
      return NextResponse.json({
        reply: `Aceitamos as seguintes formas de pagamento no *${user.storeName || "nosso restaurante"}*:\n\n✅ Pix\n✅ Cartão de Crédito e Débito\n✅ Dinheiro (com troco se precisar)\n\nMonte seu pedido diretamente em:\n👉 ${storeLink}`
      });
    }

    // 7. Cardápio / Menu / Opções / Preços
    if (/cardapio|cardápio|menu|opções|opcoes|lanche|burger|comida|preço|preco|valor/i.test(msg)) {
      const sample = products.slice(0, 4).map((p) => `• *${p.name}*: R$ ${p.price.toFixed(2).replace(".", ",")}`).join("\n");
      return NextResponse.json({
        reply: `Confira os destaques do nosso cardápio no *${user.storeName || "nosso restaurante"}*:\n\n${sample}\n\nE muito mais! Acesse o cardápio completo e peça agora:\n👉 ${storeLink}`
      });
    }

    // 8. Resposta Inteligente Padrão (Saudações ou Perguntas Gerais)
    const featured = products[0] ? `Dica da casa: experimente o nosso *${products[0].name}* por R$ ${products[0].price.toFixed(2).replace(".", ",")}!` : "";
    return NextResponse.json({
      reply: `Olá! Sou o atendente virtual do *${user.storeName || "nosso restaurante"}*! 😊\n\n${featured}\n\nComo posso te ajudar? Você pode consultar todo o nosso cardápio e fazer seu pedido no link:\n👉 ${storeLink}`
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Erro no processamento da IA" }, { status: 500 });
  }
}
