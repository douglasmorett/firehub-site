import { prisma } from "@/lib/prisma";

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
  const agentName = (chatbotConfig.agentName || "Hakim").trim();
  const storeName = user.storeName || "Nossa Loja";
  const storeLink = user.slug ? `https://firehubfood.com.br/loja/${user.slug}` : "https://firehubfood.com.br";

  // Formatar horários de funcionamento
  let hoursText = "Todos os dias das 18:00 às 23:30.";
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

  // Cardápio resumido
  const catalogSummary = products
    .map((p) => `- ${p.name} (${p.category}): R$ ${p.price.toFixed(2).replace(".", ",")}${p.description ? ` — ${p.description}` : ""}`)
    .join("\n");

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || process.env.VITE_GEMINI_API_KEY;

  // ─── TENTATIVA COM A API GERATIVA DO GEMINI (ESTILO BRENDI / ULTRA-HUMANA) ───
  if (apiKey) {
    try {
      const systemPrompt = `Você é ${agentName}, atendente humana e super simpática do restaurante "${storeName}".
SEU OBJETIVO: Atender os clientes no WhatsApp com extrema leveza, carinho, humor e humanidade, EXATAMENTE como uma pessoa real respondendo no WhatsApp.
O cliente NUNCA deve perceber que você é um robô. Responda de forma fluida, solta e natural.

📍 **DADOS DA SUA LOJA**:
- Nome: ${storeName}
- Atendente: ${agentName}
- Endereço/Cidade: ${user.storeAddress || user.city || "Não informado"}
- Telefone: ${user.storePhone || "Não informado"}
- Link do Cardápio Digital: ${storeLink}
- Status de Funcionamento Hoje: ${nowStatusText || "Aberto normalmente"}

📋 **CARDÁPIO COMPLETO E PREÇOS**:
${catalogSummary || "Cardápio em atualização."}

${customPrompt ? `📌 **INSTRUÇÕES ESPECIAIS DA LOJA**: ${customPrompt}` : ""}

🎯 **REGRAS DE CONVERSA ESTILO BRENDI IA**:
1. Se o cliente disser "te amo", "amor", "linda", "te adoro" ou flertar de brincadeira, responda com carinho, leveza e bom humor! Exemplo: "Aaaah eu também te amo! 🥰 Que tal a gente lanchar juntos hoje? Vou te dar o link do nosso site: ${storeLink}".
2. Se o cliente fizer perguntas gerais, rir ("kkkk") ou bater papo, responda com naturalidade de uma pessoa real, e convide de forma leve a ver o cardápio no link: ${storeLink}.
3. Responda em Português do Brasil com frases curtas, simpáticas e emojis fofos (😊, 🥰, 🍕, 🍔, 🥤).
4. NUNCA use modelos robóticos genéricos como "Olá! Sou o atendente virtual do sistema X". Seja humana e leve!
`;

      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
      const conversationHistory = (history || []).map((h: any) => ({
        role: h.sender === "user" ? "user" : "model",
        parts: [{ text: h.text }]
      }));

      const payload = {
        contents: [
          { role: "user", parts: [{ text: systemPrompt }] },
          ...conversationHistory,
          { role: "user", parts: [{ text: message }] }
        ]
      };

      const res = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        const data = await res.json();
        const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (generatedText) {
          return { reply: generatedText.trim() };
        }
      }
    } catch (geminiErr) {
      console.warn("[Chatbot AI] Erro ao chamar API Gemini, usando motor conversacional humanizado:", geminiErr);
    }
  }

  // ─── MOTOR CONVERSACIONAL HUMANIZADO LOCAL (ESTILO BRENDI IA) ───
  const msg = message.toLowerCase().trim();
  const alreadyGreeted = Array.isArray(history) && history.some((h: any) => h.sender === "Atendente" || h.sender === "bot");

  // 1. AFETO / CARINHO / FLERTE / AMOR ("te amo", "te adoro", "linda", "amor", "gatinha", "gato")
  if (/te amo|te adoro|te amooo|amor|linda|gatinha|gato|lindão|perfeita|maravilhosa|lindo|sou seu fã/i.test(msg)) {
    return {
      reply: `Aaaah, eu também te amo! 🥰 Que tal a gente comemorar esse carinho lanchando juntos hoje? Vou te passar o link do nosso site:\n👉 ${storeLink}`
    };
  }

  // 2. PERGUNTA DE ABERTO AGORA / HORÁRIOS ("vocês tão abertos agora?", "tá aberto?", "tão aberto?")
  if (/t[aã]o aberto|t[aã] aberto|aberto agora|t[aã] funcionando|abre hoje/i.test(msg)) {
    return {
      reply: `Oii, tudo bem? 😊 Tô sim, aberta até 23h! Quer ver o cardápio ou já sabe o que vai querer?`
    };
  }

  // 3. ANOTAÇÃO DE PEDIDO DIRETO ("Quero 2 ...", "Me vê 1 ...", "vou querer 2 ...")
  if (/(quero|me v[eê]|vou querer|manda|trazer)\s+(\d+)?\s*(.+)/i.test(msg)) {
    const match = msg.match(/(quero|me v[eê]|vou querer|manda|trazer)\s+(.+)/i);
    const orderText = match ? match[2] : msg;
    
    // Tentar localizar itens do cardápio e preços
    let totalPrice = 0;
    const foundItems: string[] = [];

    products.forEach((p) => {
      if (orderText.toLowerCase().includes(p.name.toLowerCase())) {
        totalPrice += p.price;
        foundItems.push(`1x ${p.name}`);
      }
    });

    if (foundItems.length > 0) {
      return {
        reply: `Anotado! 🍔 ${foundItems.join(" + ")} = R$ ${totalPrice.toFixed(2).replace(".", ",")}. É entrega ou retirada?`
      };
    } else {
      return {
        reply: `Anotado! 🍔 ${orderText}. É entrega ou retirada?`
      };
    }
  }

  // 4. RESPOSTA PARA ENTREGA OU RETIRADA ("entrega", "retirada", "no endereço de sempre")
  if (/entrega|retirada|buscar|retirar|endereço|endereco/i.test(msg) && alreadyGreeted) {
    return {
      reply: `Perfeito! Chega em ~40 min. Segue o link pra concluir seu pedido 👇\n👉 ${storeLink}`
    };
  }

  // 5. AGRADECIMENTOS ("obrigado", "obrigada", "valeu", "tmj")
  if (/obrigad|valeu|tmj|brigad|gratidão|gratidao/i.test(msg)) {
    return {
      reply: `Por nada!! 😊 Precisando de qualquer coisa ou se bater aquela fome, estou sempre por aqui! Se quiser pedir algo saboroso agora:\n👉 ${storeLink}`
    };
  }

  // 6. RISADAS / BRINCADEIRAS ("kkk", "hahaha", "rsrs")
  if (/k{2,}|ha{2,}|he{2,}|rs{2,}/i.test(msg)) {
    return {
      reply: `Hahaha, maravilhoso! 😂 Bateu aquela fome por aí também? Se quiser dar uma olhada no nosso cardápio caprichado:\n👉 ${storeLink}`
    };
  }

  // 7. ELOGIOS À COMIDA OU LOJA ("delícia", "delicia", "muito bom")
  if (/delícia|delicia|muito bom|melhor|adoro|top|perfeito|bom demais/i.test(msg)) {
    return {
      reply: `Aaah que demais! Ficamos muito felizes em saber disso! ❤️ Fazer tudo com amor pra vocês é nossa prioridade. Bora pedir uma delícia hoje?\n👉 ${storeLink}`
    };
  }

  // 8. CUMPRIMENTOS LEVES ("oi", "oii", "boa noite", "bom dia")
  if (/^(oi|oii|oiii|oioi|eai|eaí|ola|olá|boa noite|bom dia|boa tarde|fala|opa)$/i.test(msg)) {
    return {
      reply: `Oii, tudo bem? 😊 Tô sim, aberta até 23h! Quer ver o cardápio ou já sabe o que vai querer?`
    };
  }

  // 9. CARDÁPIO / MENUS
  if (/cardapio|cardápio|menu|pedir|comprar|fazer pedido|fome|lanche|esfiha|esfirra|pizza/i.test(msg)) {
    const sample = products.slice(0, 4).map((p) => `• *${p.name}*: R$ ${p.price.toFixed(2).replace(".", ",")}`).join("\n");
    return {
      reply: `Dá uma olhada em algumas das nossas gostosuras no *${storeName}*:\n\n${sample}\n\nAcesse nosso site completo e faça seu pedido em 1 minuto:\n👉 ${storeLink}`
    };
  }

  // 10. RESPOSTA PADRÃO LEVE & HUMANA (ESTILO BRENDI IA)
  return {
    reply: `Aaaah que bacana! 😊 Se precisar de qualquer coisa ou se bater aquela fome pra lanchar hoje, conta comigo! Dá uma olhada no nosso cardápio:\n👉 ${storeLink}`
  };
}
