import { prisma } from "@/lib/prisma";
import { GoogleGenAI } from "@google/genai";

export async function processChatbotAI(userId: string, message: string, history: any[] = [], remoteJid?: string) {
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

  // Extrai telefone limpo se fornecido remoteJid
  let clientPhoneDigits = "";
  if (remoteJid) {
    clientPhoneDigits = remoteJid.split("@")[0].replace(/\D/g, "");
  }

  // Buscar cardápio ao vivo da loja e pedidos recentes do cliente
  const [products, categories, recentOrders] = await Promise.all([
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
    clientPhoneDigits ? prisma.customerOrder.findMany({
      where: {
        franchiseeId: targetFranchiseeId,
        customerPhone: { contains: clientPhoneDigits.slice(-8) },
      },
      select: {
        id: true,
        status: true,
        totalAmount: true,
        createdAt: true,
        deliveryType: true,
        items: {
          select: {
            quantity: true,
            menuProduct: { select: { name: true } }
          }
        }
      },
      orderBy: { createdAt: "desc" },
      take: 2,
    }) : Promise.resolve([]),
  ]);

  const chatbotConfig = (user.chatbotConfig as any) || {};
  const personality = chatbotConfig.personality || "SIMPATICO";
  const customPrompt = (chatbotConfig.customPrompt || "").trim();
  const agentName = (chatbotConfig.agentName || "Hakim").trim();
  const storeName = user.storeName || "Nossa Loja";
  const defaultStoreLink = user.slug ? `https://firehubfood.com.br/loja/${user.slug}` : "https://firehubfood.com.br";
  const storeLink = (chatbotConfig.externalMenuUrl || "").trim() || defaultStoreLink;

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
      nowStatusText = `Hoje funcionamos exatamente das ${today.open || "18:00"} às ${today.close || "23:30"}.`;
    } else if (today && !today.active) {
      nowStatusText = "Hoje a loja está fechada.";
    }
  }

  const catalogSummary = products
    .map((p) => `- ${p.name} (${p.category}): ${p.price} reais${p.description ? ` — ${p.description}` : ""}`)
    .join("\n");

  // Formatar pedidos recentes deste cliente
  let recentOrdersSummary = "Nenhum pedido recente encontrado para este número.";
  if (Array.isArray(recentOrders) && recentOrders.length > 0) {
    recentOrdersSummary = recentOrders.map(o => {
      const statusMap: Record<string, string> = {
        NOVO: "Recebido (Aguardando confirmação da loja)",
        ACEITO: "Em Preparação / Cozinha 🔥",
        EM_PREPARO: "Em Preparação / Cozinha 🔥",
        SAIU_PARA_ENTREGA: "Saiu para Entrega com Motoboy 🛵",
        ENTREGUE: "Entregue ao cliente ✅",
        CANCELADO: "Cancelado ❌"
      };
      const statusReadable = statusMap[o.status] || o.status;
      const itemsList = o.items.map((i: any) => `${i.quantity}x ${i.menuProduct?.name || "Item"}`).join(", ");
      return `- Pedido #${o.id.slice(-5).toUpperCase()}: Status = "${statusReadable}" | Itens = ${itemsList} | Total = ${o.totalAmount} reais`;
    }).join("\n");
  }

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || process.env.VITE_GEMINI_API_KEY;

  if (apiKey) {
    try {
      const systemPrompt = `Você é uma PESSOA REAL chamada ${agentName}, atendente do restaurante ${storeName}.

REGRAS ABSOLUTAS:
1. NUNCA revele que é IA, robô, assistente virtual ou modelo de linguagem.
2. Responda de forma RESUMIDA, DIRETA e ULTRA NATURAL (no máximo 2 frases curtas + o link). NUNCA mande textões!
3. NUNCA use markdown, asteriscos, bullet points ou formatação de código. Apenas texto puro com emojis naturais.
4. Use gírias e expressões brasileiras naturais (tipo 'po', 'tá bom', 'beleza', 'show', 'e aí', 'bora').
5. QUANDO O CLIENTE PERGUNTAR SOBRE O STATUS / COMO ESTÁ O PEDIDO DELE:
   - Verifique o campo "PEDIDOS RECENTES DO CLIENTE" abaixo. Se houver pedido recente, informe exatamente o status dele (ex: "Seu pedido #A1B2C já está na cozinha em preparação com carinho!" ou "Seu pedido já saiu para entrega com o motoboy!").
6. QUANDO O CLIENTE PERGUNTAR SOBRE CUPOM DE DESCONTO / PROMOÇÕES / VOLTAR A COMPRAR:
   - Você tem AUTONOMIA para criar e conceder cupons de desconto aos clientes! (Ex: "Use o cupom VOLTEI10 para R$10 OFF" ou "Use o cupom PRIMEIRACOMPRA para 15% OFF!").
7. QUANDO O CLIENTE PERGUNTAR O HORÁRIO DE FUNCIONAMENTO:
   - Diga EXATAMENTE os horários de abertura e fechamento informados nos dados da loja (ex: "A gente funciona das 18h às 23:30h!").
7. QUANDO O CLIENTE PERGUNTAR O TEMPO / PREVISÃO DE ENTREGA:
   - Diga a média de tempo estimada da loja (ex: "Nosso tempo médio de entrega é de 45 a 60 minutos no momento!").
8. QUANDO O CLIENTE PERGUNTAR QUAL É O MAIS VENDIDO OU RECOMENDAÇÃO:
   - Responda DIRETO ao ponto citando apenas 1 opção campeã com o preço real. Ex: "O campeão aqui é o Combo Imperial por 24,90 reais! O pessoal ama!"
9. QUANDO PEDIREM O CARDÁPIO GERAL:
   - Fale 2 destaques rápidos e mande o link (${storeLink}).
10. Quando informar preços, fale de forma natural (ex: "24,90 reais").
11. NUNCA corte frases no meio. Complete o pensamento de forma simples e direta!
12. Seu estilo: ${personalityInstruction}

DADOS DA LOJA:
- Nome da Loja: ${storeName}
- Endereço / Cidade: ${user.storeAddress || user.city || "Não informado"}
- Telefone: ${user.storePhone || "Não informado"}
- Link do Cardápio: ${storeLink}
- Tempo Médio de Entrega da Loja: 45 a 60 minutos
- Horário de Funcionamento Cadastrado: ${nowStatusText || "Aberto todos os dias das 18:00 às 23:30."}
- Quadro Geral de Horários:
${hoursText}

PEDIDOS RECENTES DESTE CLIENTE NO SEU NÚMERO:
${recentOrdersSummary}

NOSSO CARDÁPIO COMPLETO DA LOJA:
${catalogSummary || "Cardápio disponível no nosso link."}

${customPrompt ? `INSTRUÇÕES EXTRAS E PROMOÇÕES DA LOJA: ${customPrompt}` : ""}

Lembre-se: Seja ultra sucinto e objetivo como uma pessoa de verdade digitando no WhatsApp!`;

      const ai = new GoogleGenAI({ apiKey });

      const chatHistory = (history || []).map((h: any) => ({
        role: h.sender === "user" ? "user" : "model",
        parts: [{ text: h.text }]
      }));

      const fullContents = [
        ...chatHistory,
        { role: "user", parts: [{ text: message }] }
      ];

      const modelNames = ["gemini-2.5-flash", "gemini-2.0-flash"];
      
      let generatedText = "";
      
      for (const mName of modelNames) {
        try {
          const response = await ai.models.generateContent({
            model: mName,
            contents: fullContents,
            config: {
              systemInstruction: systemPrompt,
              temperature: 0.9,
              topP: 0.95,
              maxOutputTokens: 1000,
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

  if (/cardapio|cardápio|menu|pedir|comprar|fazer pedido|fome|lanche|esfiha|esfirra|pizza|op[cç][õo]es|promo[cç][ãa]o|mais vendido/i.test(msg)) {
    const sampleProducts = products.slice(0, 3).map(p => `${p.name} por ${p.price} reais`).join(", ");
    const introText = sampleProducts ? `temos opções maravilhosas como ${sampleProducts}!` : "temos várias opções incríveis no nosso cardápio!";
    return {
      reply: `oie! ${introText} 😊 você pode ver o cardápio completo com todas as fotos e fazer seu pedido por aqui ó:\n👉 ${storeLink}`
    };
  }

  const sampleProductsFallback = products.slice(0, 2).map(p => `${p.name} (${p.price} reais)`).join(" e ");
  const productMention = sampleProductsFallback ? ` como ${sampleProductsFallback}` : "";

  const fallbacks = [
    `oie! tô por aqui pra te atender. 😊 hoje temos destaques incríveis${productMention}! dá uma olhadinha no nosso cardápio completo:\n👉 ${storeLink}`,
    `com certeza! 🍔 se quiser sugestão ou tiver dúvida sobre algum lanche me avisa. os mais pedidos estão no nosso cardápio:\n👉 ${storeLink}`,
    `beleza! 😊 a gente tá a todo vapor aqui. escolhe seu lanche favorito por aqui:\n👉 ${storeLink}`,
  ];
  const choiceIndex = Math.abs(msg.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0)) % fallbacks.length;

  return {
    reply: fallbacks[choiceIndex]
  };
}
