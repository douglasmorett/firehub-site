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

  const personalityMap: Record<string, string> = {
    SIMPATICO: "Seja extremamente simpático, acolhedor, amigável e fofo! Use bastante carinho, emojis acolhedores (😊, 🥰, 🍕) e demonstre felicidade em atender o cliente.",
    AGIL: "Seja extremamente ágil, focado, rápido e objetivo! Dê respostas curtas, diretas e sem enrolação, tirando as dúvidas em 1 ou 2 frases objetivas.",
    FORMAL: "Seja formal, polido, elegante e refinado! Use linguagem exemplar, mantendo o tom muito bem educado, profissional e cortês.",
    DIVERTIDO: "Seja extremamente divertido, descontraído, engraçado, entusiasmado e alegre! Use humor leve, alto astral, energia lá no alto e muita descontração (hahaha, maravilha)!",
  };

  const personalityInstruction = personalityMap[personality] || personalityMap.SIMPATICO;

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

  // ─── INTEGRAÇÃO DIRETA COM GEMINI 2.5 FLASH (ESTILO BRENDI IA / RACIOCÍNIO FLUIDO E LIVRE) ───
  if (apiKey) {
    try {
      const systemPrompt = `Você é ${agentName}, atendente oficial do restaurante "${storeName}".
SEU NOME: ${agentName} (sempre que se apresentar ou for perguntado seu nome, diga que seu nome é ${agentName}!).
SEU ESTILO DE VOZ E HUMOR: ${personalityInstruction}

📍 **DADOS DA SUA LOJA**:
- Nome da Loja: ${storeName}
- Nome do Atendente: ${agentName}
- Endereço / Cidade: ${user.storeAddress || user.city || "Não informado"}
- Telefone: ${user.storePhone || "Não informado"}
- Cardápio Digital / Site para Pedir: ${storeLink}
- Status de Funcionamento Hoje: ${nowStatusText || "Aberto normalmente"}

📋 **CARDÁPIO COMPLETO E PREÇOS DA LOJA**:
${catalogSummary || "Cardápio em atualização."}

${customPrompt ? `📌 **INSTRUÇÕES ESPECIAIS DA SUA LOJA**: ${customPrompt}` : ""}

🎯 **REGRAS DE CONVERSA COM O CLIENTE**:
1. Apresente-se ou responda como ${agentName}. Siga ESTRITAMENTE o estilo de humor e tom de voz configurado: "${personalityInstruction}".
2. RACIOCÍNIO LIVRE: Responda diretamente e com inteligência a qualquer pergunta, carinho, piada ou dúvida trazida pelo cliente no WhatsApp!
3. NUNCA fale que é um robô. Responda como uma pessoa real no estilo ${personality}!
4. Se fizer sentido na conversa, convide o cliente a ver o cardápio no link: ${storeLink}.`;

      const modelNames = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];
      const conversationHistory = (history || []).map((h: any) => ({
        role: h.sender === "user" ? "user" : "model",
        parts: [{ text: h.text }]
      }));

      for (const mName of modelNames) {
        try {
          const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${mName}:generateContent?key=${apiKey}`;
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
        } catch (mErr) {
          console.warn(`[Chatbot AI] Tentativa com modelo ${mName} falhou:`, mErr);
        }
      }
    } catch (geminiErr) {
      console.warn("[Chatbot AI] Erro geral ao chamar API Gemini:", geminiErr);
    }
  }

  // ─── MOTOR CONVERSACIONAL HUMANIZADO LOCAL (ESTILO BRENDI IA) ───
  const msg = message.toLowerCase().trim();
  const alreadyGreeted = Array.isArray(history) && history.some((h: any) => h.sender === "Atendente" || h.sender === "bot");

  // 1. AFETO / CARINHO / FLERTE / SAUDADE ("saudade", "te amo", "linda", "amor", "fã")
  if (/saudade|te amo|te adoro|te amooo|amor|linda|gatinha|gato|lindão|perfeita|maravilhosa|lindo|sou seu fã/i.test(msg)) {
    return {
      reply: `Aaaah, eu também estava com saudade! 🥰 Que fofura te ver por aqui de novo! Que tal a gente comemorar lanchando juntos hoje?\n👉 ${storeLink}`
    };
  }

  // 2. PERGUNTA DE ABERTO AGORA / HORÁRIOS / FUNCIONAMENTO ("horario", "que horas funciona", "tá aberto?")
  if (/horario|horário|funciona|que horas|t[aã]o aberto|t[aã] aberto|aberto agora|t[aã] funcionando|abre hoje/i.test(msg)) {
    return {
      reply: `Oii! ${nowStatusText || "Funcionamos normalmente das 18:00 às 23:30."} 😊 Quer dar uma olhada no nosso cardápio ou já sabe o que vai querer hoje?\n👉 ${storeLink}`
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
      reply: `Oii, tudo bem? 😊 Como posso te ajudar hoje? Quer dar uma olhada no nosso cardápio?\n👉 ${storeLink}`
    };
  }

  // 9. CARDÁPIO / MENUS
  if (/cardapio|cardápio|menu|pedir|comprar|fazer pedido|fome|lanche|esfiha|esfirra|pizza/i.test(msg)) {
    const sample = products.slice(0, 4).map((p) => `• *${p.name}*: R$ ${p.price.toFixed(2).replace(".", ",")}`).join("\n");
    return {
      reply: `Dá uma olhada em algumas das nossas gostosuras no *${storeName}*:\n\n${sample}\n\nAcesse nosso site completo e faça seu pedido em 1 minuto:\n👉 ${storeLink}`
    };
  }

  // 10. RESPOSTAS DIVERSISFICADAS PARA O FALLBACK (NUNCA REPETIR A MESMA FRASE 3X)
  const fallbacks = [
    `Oii! Estou por aqui para te atender com o maior carinho! 😊 Quer dar uma olhada no nosso cardápio caprichado hoje?\n👉 ${storeLink}`,
    `Com certeza! 🍔 Qualquer dúvida sobre nossos lanches e porções é só me falar! Dá uma olhadinha no nosso site pra fazer seu pedido:\n👉 ${storeLink}`,
    `Maravilha! 😊 Fazer tudo bem gostoso pra você é a nossa prioridade! Se quiser escolher seu lanche agora:\n👉 ${storeLink}`,
  ];
  const choiceIndex = Math.abs(msg.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0)) % fallbacks.length;

  return {
    reply: fallbacks[choiceIndex]
  };
}
