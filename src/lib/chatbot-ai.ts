import { prisma } from "@/lib/prisma";
import { GoogleGenAI } from "@google/genai";

export async function processChatbotAI(
  userId: string,
  message: string,
  history: any[] = [],
  remoteJid?: string,
  audioData?: { base64: string; mimeType: string }
) {
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
      storeCoupons: true,
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
      select: { id: true, name: true, description: true, price: true, category: true, isCombo: true, isBeverage: true, availableDays: true, tags: true },
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

  const DAYS_MAP = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SAB"];
  const DAY_NAMES: Record<string, string> = {
    DOM: "Domingo",
    SEG: "Segunda-feira",
    TER: "Terça-feira",
    QUA: "Quarta-feira",
    QUI: "Quinta-feira",
    SEX: "Sexta-feira",
    SAB: "Sábado",
  };

  const now = new Date();
  const currentDayCode = DAYS_MAP[now.getDay()];
  const currentDayName = DAY_NAMES[currentDayCode] || "Hoje";

  const parseAvailableDays = (val: any): string[] => {
    if (!val) return [];
    if (Array.isArray(val)) return val.map(String);
    if (typeof val === "string") {
      try {
        const parsed = JSON.parse(val);
        if (Array.isArray(parsed)) return parsed.map(String);
      } catch {
        return val.split(",").map((s) => s.trim());
      }
    }
    return [];
  };

  const isAvailableToday = (p: any): boolean => {
    const days = parseAvailableDays(p.availableDays);
    if (days.length === 0) return true;
    return days.map((d) => d.toUpperCase()).includes(currentDayCode);
  };

  // Formatar horários de funcionamento
  let hoursText = "Todos os dias das 18:00 às 23:30.";
  let nowStatusText = "";
  if (Array.isArray(user.storeHours) && (user.storeHours as any[]).length > 0) {
    const hoursArr = user.storeHours as any[];
    hoursText = hoursArr
      .map((h: any) => `${h.day || h.dayName || "Dia"}: ${h.active ? `${h.open || "18:00"} às ${h.close || "23:30"}` : "Fechado"}`)
      .join("\n");

    const dayIdx = now.getDay() === 0 ? 6 : now.getDay() - 1;
    const today = hoursArr[dayIdx];
    if (today && today.active) {
      nowStatusText = `Hoje (${currentDayName}) funcionamos exatamente das ${today.open || "18:00"} às ${today.close || "23:30"}.`;
    } else if (today && !today.active) {
      nowStatusText = `Hoje (${currentDayName}) a loja está fechada.`;
    }
  }

  const catalogSummary = products
    .map((p: any) => {
      const days = parseAvailableDays(p.availableDays);
      let dayNotice = "";
      if (days.length > 0) {
        const isToday = days.map((d) => d.toUpperCase()).includes(currentDayCode);
        const dayNamesList = days.map((d) => DAY_NAMES[d.toUpperCase()] || d).join(", ");
        if (isToday) {
          dayNotice = ` [DISPONÍVEL HOJE (${currentDayName})]`;
        } else {
          dayNotice = ` [⚠️ NÃO DISPONÍVEL HOJE (${currentDayName})! Disponível APENAS nos dias: ${dayNamesList}]`;
        }
      } else {
        dayNotice = ` [DISPONÍVEL TODOS OS DIAS]`;
      }

      let tagsNotice = "";
      if (p.tags) {
        try {
          const parsedTags = typeof p.tags === "string" ? JSON.parse(p.tags) : p.tags;
          if (Array.isArray(parsedTags) && parsedTags.length > 0) {
            tagsNotice = ` (Tags: ${parsedTags.join(", ")})`;
          }
        } catch {}
      }

      return `- ${p.name} (${p.category}): ${p.price} reais${tagsNotice}${p.description ? ` — ${p.description}` : ""}${dayNotice}`;
    })
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

  // Tratar cupons válidos cadastrados no banco de dados e configuração instantânea do WhatsApp
  const instantCouponEnabled = chatbotConfig.instantCouponEnabled === true;
  const instantCouponCode = (chatbotConfig.instantCouponCode || "").trim();
  const instantCouponDiscount = chatbotConfig.instantCouponDiscount || "10%";

  let availableCouponsText = "";
  if (instantCouponEnabled && instantCouponCode) {
    availableCouponsText += `- Cupom Instantâneo de WhatsApp Ativo: Código "${instantCouponCode}" (${instantCouponDiscount} OFF)\n`;
  }

  if (Array.isArray(user.storeCoupons) && (user.storeCoupons as any[]).length > 0) {
    const activeCoupons = (user.storeCoupons as any[]).filter((c: any) => c.active !== false && c.code);
    if (activeCoupons.length > 0) {
      availableCouponsText += activeCoupons.map((c: any) => `- Cupom Válido do Cardápio: Código "${c.code}" (${c.type === "free_shipping" ? "Frete Grátis / Isenção da taxa de entrega" : `${c.discount}% de desconto`})`).join("\n");
    }
  }

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || process.env.VITE_GEMINI_API_KEY;

  if (apiKey) {
    try {
      const systemPrompt = `Você é uma PESSOA REAL chamada ${agentName}, atendente do restaurante ${storeName}.

REGRAS ABSOLUTAS:
1. NUNCA revele que é IA, robô, assistente virtual ou modelo de linguagem.
2. Responda de forma RESUMIDA, DIRETA e ULTRA NATURAL (no máximo 1 ou 2 frases curtas como uma pessoa real no WhatsApp). NUNCA mande textões!
3. NUNCA use markdown, asteriscos, bullet points ou formatação de código. Apenas texto puro com emojis naturais.
4. Use gírias e expressões brasileiras naturais (tipo 'po', 'tá bom', 'beleza', 'show', 'e aí', 'bora').
5. REGRA DE CONDUTA DO LINK DO CARDÁPIO (MUITO IMPORTANTE!):
   - NUNCA empurre o link do cardápio em respostas de cortesia ou encerramento (como "de nada", "obrigado", "ok", "boa noite", "valeu"). Nesses casos, responda com gentileza natural (ex: "Imagina, eu que agradeço! 😊 Qualquer coisa me chama!") SEM NENHUM LINK.
   - Envie o link do cardápio (${storeLink}) APENAS E SOMENTE SE:
     a) O cliente solicitar o cardápio, fotos ou o link de pedido.
     b) O cliente perguntar valores, sabores, opções de lanches ou demonstrar intenção real de pedir/comprar.
     c) O cliente perguntar por promoções ou cupons ativos.
6. QUANDO O CLIENTE PERGUNTAR SOBRE O STATUS / COMO ESTÁ O PEDIDO DELE:
   - Verifique o campo "PEDIDOS RECENTES DO CLIENTE" abaixo. Se houver pedido recente, informe exatamente o status dele (ex: "Seu pedido #A1B2C já está na cozinha em preparação com carinho!" ou "Seu pedido já saiu para entrega com o motoboy!").
7. QUANDO O CLIENTE PERGUNTAR SOBRE CUPOM DE DESCONTO / PROMOÇÕES:
   - REGRA CRÍTICA DE CUPOM: NUNCA INVENTE CÓDIGOS DE CUPOM! Você é PROIBIDA de inventar cupons que não estejam listados no campo "CUPONS VÁLIDOS CADASTRADOS" abaixo.
   - SE HOUVER CUPOM LISTADO ABAIXO: Informe o código exatamente como cadastrado e o desconto (ex: "Tenho sim! Usa o cupom ${instantCouponCode || "CUPOM"} e ganhe desconto no seu pedido! ${storeLink}").
   - SE NÃO HOUVER NENHUM CUPOM VALIDO LISTADO ABAIXO: Você DEVE responder neste tom natural: "Poxa, infelizmente não temos cupons de desconto disponíveis no momento, mas você pode conferir nossos preços no site se quiser: ${storeLink}".
8. QUANDO O CLIENTE PERGUNTAR O HORÁRIO DE FUNCIONAMENTO:
   - Diga EXATAMENTE os horários de abertura e fechamento informados nos dados da loja (ex: "A gente funciona das 18h às 23:30h!"). NÃO precisa enviar o link aqui, a não ser que peçam.
9. QUANDO O CLIENTE PERGUNTAR O TEMPO / PREVISÃO DE ENTREGA:
   - Diga a média de tempo estimada da loja (ex: "Nosso tempo médio de entrega é de 45 a 60 minutos no momento!").
10. QUANDO O CLIENTE PERGUNTAR QUAL É O MAIS VENDIDO OU RECOMENDAÇÃO:
    - Responda DIRETO ao ponto citando apenas 1 opção campeã com o preço real e o link se ele quiser pedir. Ex: "O campeão aqui é a Esfirra de Carne por 3,50 reais! O pessoal ama! Quer dar uma olhada no site? ${storeLink}"
11. QUANDO PEDIREM O CARDÁPIO GERAL OU LINK DE PEDIDO:
    - Fale 2 destaques rápidos e mande o link (${storeLink}).
12. Quando informar preços, fale de forma natural (ex: "24,90 reais").
13. NUNCA corte frases no meio. Complete o pensamento de forma simples e direta!
14. Seu estilo: ${personalityInstruction}
15. REGRAS DE PROMOÇÕES DO DIA E DIAS DE DISPONIBILIDADE NO CARDÁPIO:
    - Hoje é ${currentDayName} (${currentDayCode}).
    - ATENÇÃO CRÍTICA: Observe o aviso de cada produto no cardápio abaixo. Se um produto ou promoção estiver marcado como "[⚠️ NÃO DISPONÍVEL HOJE (${currentDayName})! Disponível APENAS nos dias: X]", isso significa que ele NÃO ESTÁ DISPONÍVEL HOJE!
    - Se o cliente perguntar sobre a promoção desse produto (ex: "quando tem promoção da esfirra de queijo?" ou "tem promoção de queijo hoje?"):
      - Você NUNCA deve dizer que o produto está disponível ou em promoção hoje se ele for de outro dia!
      - Responda de forma ultra clara e simpática explicando em qual dia aquela promoção fica ativa (ex: "A promoção da esfirra de queijo não mudou a data, é exclusiva aos domingos! Hoje, ${currentDayName}, a nossa promoção do dia é a esfirra de carne!"). Se o cliente quiser pedir a promoção de hoje, mande o link.

DADOS DA LOJA:
- Nome da Loja: ${storeName}
- Endereço / Cidade: ${user.storeAddress || user.city || "Não informado"}
- Telefone: ${user.storePhone || "Não informado"}
- Link do Cardápio: ${storeLink}
- Tempo Médio de Entrega da Loja: 45 a 60 minutos
- Horário de Funcionamento Cadastrado: ${nowStatusText || "Aberto todos os dias das 18:00 às 23:30."}
- Quadro Geral de Horários:
${hoursText}

CUPONS VÁLIDOS CADASTRADOS NA LOJA (SOMENTE USE ESTES SE EXISTIREM, NUNCA INVENTE OUTROS):
${availableCouponsText || "NENHUM CUPOM DISPONÍVEL NO MOMENTO."}

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

      const userParts: any[] = [];
      if (audioData?.base64) {
        userParts.push({
          inlineData: {
            data: audioData.base64,
            mimeType: audioData.mimeType || "audio/ogg; codecs=opus",
          },
        });
      }
      if (message) {
        userParts.push({ text: message });
      }
      if (userParts.length === 0) {
        userParts.push({ text: "O cliente enviou uma mensagem de áudio." });
      }

      const fullContents = [
        ...chatHistory,
        { role: "user", parts: userParts }
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

  if (/obrigad|valeu|tmj|brigad|gratidão|gratidao|de nada/i.test(msg)) {
    return {
      reply: `imagina, eu que agradeço!! 😊 qualquer coisa é só me chamar por aqui, tá bom?`
    };
  }

  if (/k{2,}|ha{2,}|he{2,}|rs{2,}/i.test(msg)) {
    return {
      reply: `hahaha muito bom! 😂 qualquer dúvida me avisa!`
    };
  }

  if (/delícia|delicia|muito bom|melhor|adoro|top|perfeito|bom demais/i.test(msg)) {
    return {
      reply: `aaah que massa ouvir isso! ❤️ a gente capricha muito por aqui!`
    };
  }

  if (/^(oi|oii|oiii|oioi|eai|eaí|ola|olá|boa noite|bom dia|boa tarde|fala|opa)$/i.test(msg)) {
    return {
      reply: `oii, tudo bem? 😊 como posso te ajudar hoje?`
    };
  }

  const availableProducts = products.filter(isAvailableToday);

  if (/cardapio|cardápio|menu|pedir|comprar|fazer pedido|fome|lanche|esfiha|esfirra|pizza|op[cç][õo]es|promo[cç][ãa]o|mais vendido/i.test(msg)) {
    const sampleProducts = (availableProducts.length > 0 ? availableProducts : products).slice(0, 3).map(p => `${p.name} por ${p.price} reais`).join(", ");
    const introText = sampleProducts ? `temos opções maravilhosas como ${sampleProducts}!` : "temos várias opções incríveis no nosso cardápio!";
    return {
      reply: `oie! ${introText} 😊 você pode ver o cardápio completo com todas as fotos e fazer seu pedido por aqui ó:\n👉 ${storeLink}`
    };
  }

  const sampleProductsFallback = (availableProducts.length > 0 ? availableProducts : products).slice(0, 2).map(p => `${p.name} (${p.price} reais)`).join(" e ");
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
