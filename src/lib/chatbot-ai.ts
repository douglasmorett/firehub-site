import { prisma } from "@/lib/prisma";
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || "" });

export async function processChatbotAI(userId: string, message: string, history: any[] = []) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
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
    return { reply: "Desculpe, loja não encontrada." };
  }

  const targetFranchiseeId = user.ownerId || user.id;

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
  const customPrompt = (chatbotConfig.customPrompt || "").trim();
  const sendLinkConfig = chatbotConfig.sendLink !== false;
  const agentName = (chatbotConfig.agentName || "").trim();

  // Buscar os MAIS VENDIDOS REAIS
  let realTopProducts: any[] = [];
  try {
    const topSales = await (prisma as any).customerOrderItem.groupBy({
      by: ["menuProductId"],
      where: { order: { franchiseeId: targetFranchiseeId, status: { notIn: ["CANCELADO"] } }, menuProductId: { not: null } },
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: "desc" } },
      take: 15,
    });

    const isCondiment = (name: string) => /maionese|sach[eê]|molho|embalagem|adicional|taxa|troco|cobertura/i.test(name);
    const salesMap = new Map((topSales as any[]).map((s: any) => [s.menuProductId, s._sum?.quantity || 0]));

    const scoredProducts = products
      .filter((p) => !isCondiment(p.name))
      .map((p) => ({
        ...p,
        salesCount: salesMap.get(p.id) || 0,
      }))
      .sort((a, b) => b.salesCount - a.salesCount);

    realTopProducts = scoredProducts.slice(0, 3);
  } catch {
    realTopProducts = products.filter((p) => !/maionese|sach[eê]|molho|embalagem|adicional/i.test(p.name)).slice(0, 3);
  }

  if (realTopProducts.length === 0) {
    realTopProducts = products.slice(0, 3);
  }

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

  // Formatar cardápio estruturado
  const catalogSummary = products
    .map((p) => `- ${p.name} (${p.category}): R$ ${p.price.toFixed(2).replace(".", ",")}${p.isBeverage ? " [BEBIDA]" : ""}${p.description ? ` — ${p.description}` : ""}`)
    .join("\n");

  const storeLink = user.slug ? `https://firehubfood.com.br/loja/${user.slug}` : "nosso cardápio digital";
  const linkSuffix = sendLinkConfig ? `\n\n👉 ${storeLink}` : "";
  const extraNotice = customPrompt ? `\n\n📌 *Aviso importante da loja*: ${customPrompt}` : "";

  let personalityInstruction = "";
  if (personality === "SIMPATICO") {
    personalityInstruction = "Seja extremamente acolhedor, amigável e simpático. Use emojis adequados (😊, 🍕, 🥤, 🛵). Sempre sugira bebidas se o cliente pedir comida e vice-versa.";
  } else if (personality === "AGIL") {
    personalityInstruction = "Seja direto, rápido e objetivo. Responda com frases curtas e bullet points claros sem enrolação.";
  } else if (personality === "FORMAL") {
    personalityInstruction = "Use tom altamente profissional, cortês, elegante e impecável.";
  } else {
    personalityInstruction = "Seja divertido, bem-humorado, entusiasmado e descontraído!";
  }

  const systemPrompt = `Você é ${agentName ? `a ${agentName}, ` : ""}Atendente Virtual Oficial do restaurante "${user.storeName || "Nossa Loja"}".
Seu nome é "${agentName || "Atendente Virtual"}". Sempre que o cliente perguntar o seu nome ou quem está falando, diga que você é ${agentName ? `a ${agentName}` : "o atendente virtual"} do ${user.storeName}.
Seu objetivo é atender o cliente no WhatsApp de forma humana, fluida, sem erros, sanar dúvidas sobre o cardápio, horários de funcionamento, endereço e ajudar a fazer o pedido.

📍 **DADOS DA LOJA**:
- Nome: ${user.storeName || "Nossa Loja"}
- Atendente: ${agentName || "Atendente Virtual"}
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
3. Responda em Português do Brasil de forma fluida, natural e inteligente.
4. NUNCA invente produtos, horários ou preços que não estejam listados acima.
5. Se o cliente demonstrar intenção de pedir, informe os itens e envie o link direto para finalizar: ${storeLink}.
6. NUNCA diga que é um robô genérico. Você é ${agentName ? `a ${agentName}` : "a atendente oficial"} do ${user.storeName}.
`;

  // Chamada à API Gemini se chave estiver disponível
  try {
    if (process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY) {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [
          { role: "user", parts: [{ text: `${systemPrompt}\n\nHistorico da conversa:\n${(history || []).map((h: any) => `${h.sender}: ${h.text}`).join("\n")}\n\nCliente: ${message}` }] },
        ],
      });

      if (response.text) {
        return { reply: response.text };
      }
    }
  } catch (geminiErr: any) {
    console.warn("[Chatbot AI Engine] Chamando motor local inteligente:", geminiErr?.message || geminiErr);
  }

  // ─── MOTOR CONVERSACIONAL INTELIGENTE NLP ───
  const msg = message.toLowerCase().trim();
  const alreadyGreeted = Array.isArray(history) && history.some((h: any) => h.sender === "Atendente" || h.sender === "bot");
  const allowWhatsappOrders = chatbotConfig.allowWhatsappOrders === true;

  // Perguntas sobre Nome
  if (/qual (é|e) (o )?seu nome|como (você|voce) se chama|quem (é|e) você|quem (é|e) voce|quem (tá|ta) falando|seu nome/i.test(msg)) {
    return {
      reply: agentName
        ? `Eu me chamo *${agentName}*! 😊 Sou a atendente virtual oficial do *${user.storeName || "nosso restaurante"}*. Como posso te ajudar hoje?`
        : `Sou o atendente virtual oficial do *${user.storeName || "nosso restaurante"}*! 😊 Como posso te ajudar hoje?`,
    };
  }

  // Cumprimentos básicos
  if (/^(oi|oii|oiii|oioi|eai|eaí|ola|olá|boa noite|bom dia|boa tarde|fala|opa)$/i.test(msg)) {
    const reply = alreadyGreeted
      ? `Oii! Como posso te ajudar agora? 😊 Quer ver o cardápio ou tirar alguma dúvida sobre o *${user.storeName || "nosso restaurante"}*?`
      : `Olá! Seja muito bem-vindo(a) ao *${user.storeName || "nosso restaurante"}*! 😊\n\nComo posso te ajudar hoje? Posso te mandar o cardápio ou tirar qualquer dúvida!`;
    return { reply };
  }

  // Cardápio / Pedir
  if (/cardapio|cardápio|menu|pedir|comprar|fazer pedido|fome/i.test(msg)) {
    const sample = products.slice(0, 4).map((p) => `• *${p.name}*: R$ ${p.price.toFixed(2).replace(".", ",")}`).join("\n");
    return {
      reply: `Confira nossos principais produtos do *${user.storeName || "nosso restaurante"}*:\n\n${sample}\n\nAcesse nosso cardápio completo e peça em 1 minuto:\n👉 ${storeLink}`,
    };
  }

  // Horários
  if (/horario|horário|aberto|fecha|abre|fechado|funcionamento/i.test(msg)) {
    return {
      reply: `O *${user.storeName || "nosso restaurante"}* ${nowStatusText || "funciona das 18:00 às 23:30"}. 😊\n\nAcesse nosso cardápio:\n👉 ${storeLink}`,
    };
  }

  // Endereço
  if (/onde fica|endereço|endereco|local|bairro|rua|cidade/i.test(msg)) {
    return {
      reply: `Ficamos localizados em: 📍 *${user.storeAddress || user.city || "Nossa Loja"}*.\n\nMonte seu pedido diretamente em:\n👉 ${storeLink}`,
    };
  }

  // Resposta Padrão
  return {
    reply: `Olá! Sou ${agentName ? `a *${agentName}*` : "o atendente virtual"} do *${user.storeName || "nosso restaurante"}*! 😊\n\nComo posso te ajudar? Veja nosso cardápio completo e peça agora:\n👉 ${storeLink}`,
  };
}
