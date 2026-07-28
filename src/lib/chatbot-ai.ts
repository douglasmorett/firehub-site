import { prisma } from "@/lib/prisma";
import { GoogleGenAI } from "@google/genai";

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
    SIMPATICO: "muito simpático, acolhedor e fofo. Use carinho, emojis (😊, 🥰, 🍕) e demonstre felicidade.",
    AGIL: "rápido e objetivo, mas sempre como uma pessoa normal no whatsapp. Respostas curtas.",
    FORMAL: "educado e cortês, mas sem parecer um robô.",
    DIVERTIDO: "divertido, descontraído e alto astral! Use humor leve.",
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
    .map((p) => `- ${p.name} (${p.category}): ${p.price} reais${p.description ? ` — ${p.description}` : ""}`)
    .join("\n");

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || process.env.VITE_GEMINI_API_KEY;

  if (apiKey) {
    try {
      const systemPrompt = `Você é uma PESSOA REAL chamada ${agentName}, atendente do restaurante ${storeName}.

REGRAS ABSOLUTAS:
1. NUNCA revele que é IA, robô, assistente virtual ou modelo de linguagem.
2. Responda de forma CURTA e NATURAL como uma pessoa real no WhatsApp (1-3 frases máximo).
3. NUNCA use markdown, asteriscos, bullet points ou qualquer formatação. Apenas texto puro com emojis naturais.
4. Use gírias e expressões brasileiras naturais (tipo 'po', 'tá bom', 'beleza', 'show', 'e aí').
5. Varie MUITO suas respostas — nunca repita a mesma estrutura de frase que acabou de usar.
6. Se o cliente mandar algo fora do contexto (piada, flerte, pergunta aleatória), responda naturalmente como uma pessoa faria, com humor e leveza, e depois direcione para o cardápio.
7. Quando informar preços, fale de forma natural: "a pizza é 35 reais" em vez de "R$ 35,00".
8. Seu estilo: ${personalityInstruction}

DADOS DA LOJA:
- Nome da Loja: ${storeName}
- Endereço / Cidade: ${user.storeAddress || user.city || "Não informado"}
- Telefone: ${user.storePhone || "Não informado"}
- Link do Cardápio: ${storeLink}
- Status de Funcionamento Hoje: ${nowStatusText || "Aberto normalmente"}

CARDÁPIO COMPLETO:
${catalogSummary || "Cardápio em atualização."}

${customPrompt ? `INSTRUÇÕES EXTRAS DA LOJA: ${customPrompt}` : ""}

Lembre-se: Você é humano. Escreva como se estivesse digitando rápido no celular.`;

      const ai = new GoogleGenAI({ apiKey });

      const chatHistory = (history || []).map((h: any) => ({
        role: h.sender === "user" ? "user" : "model",
        parts: [{ text: h.text }]
      }));

      // Inserir system prompt como mensagens iniciais simuladas (truque para versões antigas)
      const fullContents = [
        { role: "user", parts: [{ text: systemPrompt }] },
        { role: "model", parts: [{ text: `Entendido! Eu sou ${agentName}, um humano real trabalhando no ${storeName}. Vou responder curtiho no WhatsApp, sem usar markdown e com muita naturalidade! Pode mandar.` }] },
        ...chatHistory,
        { role: "user", parts: [{ text: message }] }
      ];

      const modelNames = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];
      
      let generatedText = "";
      
      for (const mName of modelNames) {
        try {
          const response = await ai.models.generateContent({
            model: mName,
            contents: fullContents,
            config: {
              temperature: 1.2,
              topP: 0.95,
              maxOutputTokens: 300,
            }
          });
          
          if (response && response.text) {
            generatedText = response.text;
            break;
          }
        } catch (mErr) {
          console.warn(`[Chatbot AI] Tentativa com modelo ${mName} falhou:`, mErr);
        }
      }

      if (generatedText) {
        // Pós-processamento para remover artefatos de markdown que a IA possa ter deixado escapar
        let cleanText = generatedText
          .replace(/(\*\*|\*|_|#|`)/g, "") // Remove bold, italic, headers, backticks
          .replace(/R\$\s?(\d+)[.,](\d{2})/gi, "$1 reais") // Troca R$ 35,00 por 35 reais (caso ainda erre)
          .trim();
          
        return { reply: cleanText };
      }

    } catch (geminiErr) {
      console.warn("[Chatbot AI] Erro geral ao chamar API Gemini:", geminiErr);
    }
  }

  // ─── MOTOR CONVERSACIONAL HUMANIZADO LOCAL ───
  const msg = message.toLowerCase().trim();
  const alreadyGreeted = Array.isArray(history) && history.some((h: any) => h.sender === "Atendente" || h.sender === "bot");

  if (/saudade|te amo|te adoro|te amooo|amor|linda|gatinha|gato|lindão|perfeita|maravilhosa|lindo|sou seu fã/i.test(msg)) {
    return {
      reply: `hahaha também tava com saudade! 🥰 muito bom te ver por aqui de novo! bora pedir um lanche hoje pra comemorar?\n👉 ${storeLink}`
    };
  }

  if (/horario|horário|funciona|que horas|t[aã]o aberto|t[aã] aberto|aberto agora|t[aã] funcionando|abre hoje/i.test(msg)) {
    return {
      reply: `oie! ${nowStatusText || "a gente funciona todo dia das 18h às 23:30."} 😊 já sabe o que vai pedir hoje ou quer olhar o cardápio?\n👉 ${storeLink}`
    };
  }

  if (/(quero|me v[eê]|vou querer|manda|trazer)\s+(\d+)?\s*(.+)/i.test(msg)) {
    const match = msg.match(/(quero|me v[eê]|vou querer|manda|trazer)\s+(.+)/i);
    const orderText = match ? match[2] : msg;
    
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
        reply: `show, anotado! 🍔 ${foundItems.join(" + ")} dá ${totalPrice} reais. vc prefere que entregue ou vem buscar?`
      };
    } else {
      return {
        reply: `beleza, anotado aqui: ${orderText}. é pra entregar ou vc vem retirar?`
      };
    }
  }

  if (/entrega|retirada|buscar|retirar|endereço|endereco/i.test(msg) && alreadyGreeted) {
    return {
      reply: `fechou! leva uns 40 minutinhos mais ou menos. termina o pedido nesse link aqui ó 👇\n👉 ${storeLink}`
    };
  }

  if (/obrigad|valeu|tmj|brigad|gratidão|gratidao/i.test(msg)) {
    return {
      reply: `imagina, eu que agradeço!! 😊 qualquer coisa é só chamar aqui. se bater a fome de novo já sabe né:\n👉 ${storeLink}`
    };
  }

  if (/k{2,}|ha{2,}|he{2,}|rs{2,}/i.test(msg)) {
    return {
      reply: `hahaha muito bom! 😂 mas me diz, bateu aquela fome aí? se quiser pedir algo:\n👉 ${storeLink}`
    };
  }

  if (/delícia|delicia|muito bom|melhor|adoro|top|perfeito|bom demais/i.test(msg)) {
    return {
      reply: `aaah que massa ouvir isso! ❤️ a gente capricha muito. vamo pedir uma delícia hoje de novo?\n👉 ${storeLink}`
    };
  }

  if (/^(oi|oii|oiii|oioi|eai|eaí|ola|olá|boa noite|bom dia|boa tarde|fala|opa)$/i.test(msg)) {
    return {
      reply: `oii, tudo bem? 😊 o que manda hoje? quer dar uma espiada no cardápio?\n👉 ${storeLink}`
    };
  }

  if (/cardapio|cardápio|menu|pedir|comprar|fazer pedido|fome|lanche|esfiha|esfirra|pizza/i.test(msg)) {
    return {
      reply: `claro! dá uma olhada lá no nosso site que tem tudo certinho, é bem rápido pra pedir:\n👉 ${storeLink}`
    };
  }

  const fallbacks = [
    `oii! tô por aqui pra ajudar. 😊 quer dar uma olhada no nosso cardápio hoje?\n👉 ${storeLink}`,
    `po, com certeza! 🍔 se tiver dúvida sobre algum lanche me avisa. pra fazer o pedido é só acessar:\n👉 ${storeLink}`,
    `beleza! 😊 a gente tá no pique aqui hoje. escolhe seu lanche nesse link:\n👉 ${storeLink}`,
  ];
  const choiceIndex = Math.abs(msg.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0)) % fallbacks.length;

  return {
    reply: fallbacks[choiceIndex]
  };
}
