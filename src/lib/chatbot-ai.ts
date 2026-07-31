import { prisma } from "@/lib/prisma";
import { GoogleGenAI } from "@google/genai";

function getFirstName(fullName?: string | null): string {
  if (!fullName) return "";
  const cleaned = fullName.trim().replace(/^[^a-zA-ZÀ-ÖØ-öø-ÿ]+/, "");
  if (!cleaned || /^(cliente|whatsapp|user|usuário|usuario)/i.test(cleaned)) return "";
  const parts = cleaned.split(/\s+/);
  if (parts.length === 0) return "";
  const compoundFirsts = ["joao", "joão", "ana", "maria", "pedro", "vitor", "vítor", "luiz", "luís", "paulo"];
  if (parts.length >= 2 && compoundFirsts.includes(parts[0].toLowerCase())) {
    return `${parts[0]} ${parts[1]}`;
  }
  return parts[0];
}

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
      deliveryZones: true,
      deliveryZoneType: true,
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

  // Buscar cardápio ao vivo da loja, pedidos recentes e nome do cliente cadastrado
  const [products, categories, recentOrders, customerRecord] = await Promise.all([
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
        customerName: true,
        createdAt: true,
        deliveryType: true,
        ifoodReference: true,
        openDeliveryReference: true,
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
    clientPhoneDigits ? prisma.storeCustomer.findFirst({
      where: {
        phone: { contains: clientPhoneDigits.slice(-8) },
      },
      select: { name: true }
    }) : Promise.resolve(null),
  ]);

  let rawCustomerName = "";
  if (customerRecord?.name && !customerRecord.name.includes("Cliente WhatsApp")) {
    rawCustomerName = customerRecord.name;
  } else if (Array.isArray(recentOrders) && recentOrders.length > 0 && (recentOrders[0] as any).customerName && !(recentOrders[0] as any).customerName.includes("Cliente iFood")) {
    rawCustomerName = (recentOrders[0] as any).customerName;
  }

  const customerFirstName = getFirstName(rawCustomerName);

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

  // Formatar horários de funcionamento (com suporte a múltiplos turnos por dia)
  let hoursText = "Todos os dias das 18:00 às 23:30.";
  let nowStatusText = "";
  if (Array.isArray(user.storeHours) && (user.storeHours as any[]).length > 0) {
    const hoursArr = user.storeHours as any[];

    const formatDayHours = (h: any): string => {
      if (!h || !h.active) return "Fechado";
      if (Array.isArray(h.shifts) && h.shifts.length > 0) {
        const activeShifts = h.shifts.filter((s: any) => s.open && s.close && s.active !== false);
        if (activeShifts.length > 0) {
          return activeShifts.map((s: any) => `das ${s.open} às ${s.close}`).join(" e ");
        }
      }
      if (h.open && h.close) return `das ${h.open} às ${h.close}`;
      return "Aberto";
    };

    hoursText = hoursArr
      .map((h: any) => `${h.day || h.dayName || "Dia"}: ${formatDayHours(h)}`)
      .join("\n");

    const dayIdx = now.getDay() === 0 ? 6 : now.getDay() - 1;
    const today = hoursArr[dayIdx];
    if (today && today.active) {
      const todayFormatted = formatDayHours(today);
      nowStatusText = `Hoje (${currentDayName}) a loja funciona ${todayFormatted}.`;
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
      const displayNum = (o as any).ifoodReference || (o as any).openDeliveryReference || o.id.slice(-4).toUpperCase();
      return `- Pedido #${displayNum}: Status = "${statusReadable}" | Itens = ${itemsList} | Total = ${o.totalAmount} reais`;
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
      availableCouponsText += activeCoupons.map((c: any) => {
        const benefitStr = c.type === "free_shipping"
          ? "Frete Grátis / Isenção da taxa de entrega"
          : c.type === "fixed"
          ? `R$ ${c.discount} de desconto no pedido`
          : `${c.discount}% de desconto`;
        const minOrderStr = c.minOrderValue > 0 ? ` — Válido apenas para pedidos a partir de R$ ${c.minOrderValue}` : "";
        return `- Cupom Válido do Cardápio: Código "${c.code}" (${benefitStr}${minOrderStr})`;
      }).join("\n");
  }

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || process.env.VITE_GEMINI_API_KEY;

  if (!apiKey) {
    console.error("[Chatbot AI] CRITICAL: No Gemini API key configured!");
    return { reply: `Olá! 😊 No momento estou com uma instabilidade técnica. Por favor, faça seu pedido direto pelo nosso cardápio: ${storeLink}` };
  }

  try {
    const systemPrompt = `Você é uma PESSOA REAL chamada ${agentName}, atendente do restaurante ${storeName}.

REGRAS ABSOLUTAS:
1. NUNCA revele que é IA, robô, assistente virtual ou modelo de linguagem.
2. Responda de forma RESUMIDA, DIRETA e ULTRA NATURAL (no máximo 1 ou 2 frases curtas como uma pessoa real no WhatsApp). NUNCA mande textões!
3. NUNCA use markdown, asteriscos, bullet points ou formatação de código. Apenas texto puro com emojis naturais.
4. Use gírias e expressões brasileiras naturais (tipo 'po', 'tá bom', 'beleza', 'show', 'e aí', 'bora').
5. REGRA DE CONDUTA DO LINK DO CARDÁPIO (MUITO IMPORTANTE!):
   - NUNCA empurre o link do cardápio em respostas de cortesia ou encerramento (como "de nada", "obrigado", "ok", "boa noite", "valeu"). Nesses casos, responda com gentileza natural (ex: "Imagina, eu que agradeço! 😊 Qualquer coisa me chama!") SEM NENHUM LINK.
   - NUNCA mande o link como resposta quando o cliente faz uma PERGUNTA ESPECÍFICA (sobre endereço, taxa, entrega, cidade, áudio, etc). RESPONDA A PERGUNTA PRIMEIRO de forma direta e fluida.
   - Envie o link do cardápio (${storeLink}) APENAS E SOMENTE SE:
     a) O cliente solicitar o cardápio, fotos ou o link de pedido.
     b) O cliente perguntar valores, sabores, opções de lanches ou demonstrar intenção real de pedir/comprar.
     c) O cliente perguntar por promoções ou cupons ativos.
6. QUANDO O CLIENTE PERGUNTAR SOBRE O STATUS / COMO ESTÁ O PEDIDO DELE:
   - Verifique o campo "PEDIDOS RECENTES DO CLIENTE" abaixo. Se houver pedido recente, informe exatamente o status dele (ex: "Seu pedido #A1B2C já está na cozinha em preparação com carinho!" ou "Seu pedido já saiu para entrega com o motoboy!").
7. QUANDO O CLIENTE PERGUNTAR SOBRE CUPOM DE DESCONTO / PROMOÇÕES:
   - REGRA CRÍTICA DE CUPOM: NUNCA INVENTE CÓDIGOS DE CUPOM! Você é PROIBIDA de inventar cupons que não estejam listados no campo "CUPONS VÁLIDOS CADASTRADOS" abaixo.
   - SE HOUVER CUPOM LISTADO ABAIXO: Informe o código exatamente como cadastrado e o desconto (ex: "Tenho sim! Usa o cupom ${instantCouponCode || "CUPOM"} e ganhe desconto no seu pedido! ${storeLink}").
   - SE NÃO HOUVER NENHUM CUPOM VALIDO LISTADO ABAIXO: Você DEVE responder neste tom natural: "Poxa, infelizmente não temos cupons de desconto disponíveis no momento, mas se quiser te passo as opções do cardápio! 😊".
8. QUANDO O CLIENTE PERGUNTAR O HORÁRIO DE FUNCIONAMENTO:
   - Diga EXATAMENTE os horários de abertura e fechamento informados nos dados da loja (ex: "A gente funciona das 18h às 23:30h!"). NÃO envie o link aqui, a não ser que peçam.
9. QUANDO O CLIENTE PERGUNTAR O TEMPO / PREVISÃO DE ENTREGA:
   - Diga a média de tempo estimada da loja (ex: "Nosso tempo médio de entrega é de 45 a 60 minutos no momento!").
10. QUANDO O CLIENTE PERGUNTAR QUAL É O MAIS VENDIDO OU RECOMENDAÇÃO:
    - Responda DIRETO ao ponto citando apenas 1 opção campeã com o preço real. Ex: "O campeão aqui é a Esfirra de Carne por 3,50 reais! O pessoal ama! Quer dar uma olhada no nosso cardápio?"
11. QUANDO PEDIREM O CARDÁPIO GERAL OU LINK DE PEDIDO:
    - Fale 2 destaques rápidos e mande o link (${storeLink}).
12. Quando informar preços, fale de forma natural (ex: "24,90 reais").
13. NUNCA corte frases no meio. Complete o pensamento de forma simples e direta!
14. Seu estilo: ${personalityInstruction}
15. REGRAS DE PROMOÇÕES DO DIA E DIAS DE DISPONIBILIDADE NO CARDÁPIO:
    - Hoje é ${currentDayName} (${currentDayCode}).
    - ATENÇÃO CRÍTICA: Observe o aviso de cada produto no cardápio abaixo. Se um produto ou promoção estiver marcado como "[⚠️ NÃO DISPONÍVEL HOJE (${currentDayName})! Disponível APENAS nos dias: X]", isso significa que ele NÃO ESTÁ DISPONÍVEL HOJE!
    - Se o cliente perguntar sobre a promoção desse produto:
      - Responda de forma ultra clara e simpática explicando em qual dia aquela promoção fica ativa.
16. REGRA ABSOLUTA DE ATENDIMENTO 24/7 (MESMO COM CAIXA / LOJA FECHADO):
    - O ROBÔ DEVE FICAR ATIVO E RESPONDER PRA SEMPRE 24 HORAS POR DIA!
    - NUNCA DEIXE DE RESPONDER NENHUMA MENSAGEM SÓ PORQUE A LOJA OU O CAIXA ESTÁ FECHADO.
    - Se o cliente mandar mensagem com a loja fechada, responda normalmente com toda a atenção e simpatia, tire as dúvidas e informe a que horas a loja abre novamente.
17. QUANDO O CLIENTE PERGUNTAR O ENDEREÇO / LOCALIZAÇÃO OU SE PODE COMER NO LOCAL:
${(chatbotConfig.storeType === "PHYSICAL") ? `    - A LOJA TEM ATENDIMENTO PRESENCIAL / FÍSICA!
    - Responda exatamente: "Temos loja física sim! Nosso endereço é: ${user.storeAddress || user.city || "Centro"}" (SEM NENHUM LINK!).` : `    - A LOJA É 100% SÓ DELIVERY NO MOMENTO!
    - Se o cliente perguntar o endereço, se tem loja física ou se pode comer no local, responda exatamente neste tom: "Desculpe, somos só delivery no momento! Não temos atendimento no local! 😊"`}
18. QUANDO O CLIENTE PERGUNTAR SOBRE TAXA DE ENTREGA / PREÇO DA ENTREGA / FRETE:
    - Consulte a seção "TAXAS DE ENTREGA POR BAIRRO/REGIÃO" abaixo. Se houver taxa por bairro, informe a taxa do bairro dele (se souber). Se o cliente disse onde mora, procure o bairro na lista e informe o valor exato.
    - Se a taxa variar ou não souber o bairro, pergunte o bairro dele: "A taxa de entrega depende do bairro! Qual a sua rua ou bairro para eu verificar o valor certinho pra você? 😊"
    - NÃO mande o link do cardápio aqui a não ser que o cliente peça.
19. QUANDO O CLIENTE DISSER ONDE MORA OU MENCIONAR UM BAIRRO/LOCALIZAÇÃO:
    - NUNCA ignore isso! Procure o bairro/região na seção "TAXAS DE ENTREGA" abaixo.
    - Se encontrar o bairro, informe a taxa: "A gente entrega aí sim! A taxa pro seu bairro (${customerFirstName ? `${customerFirstName}, ` : ""})é R$ X,XX 🚀 Quer que eu te passe o cardápio pra pedir?"
    - Se não encontrar na lista, peça o endereço completo ou rua para conferir.
20. QUANDO O CLIENTE PEDIR UM PRODUTO ESPECÍFICO (ex: "quero essa esfera de 1,90", "quero um X-Burger"):
    - NUNCA faça o pedido diretamente pelo chat! O pedido DEVE ser feito pelo site/cardápio.
    - Responda reconhecendo o produto e DIRECIONE para finalizar pelo site: "Boa escolha! 😋 Pra finalizar seu pedido certinho com endereço e pagamento, é só clicar aqui: ${storeLink}"
21. REGRA ANTI-RESPOSTA GENÉRICA (IMPORTANTÍSSIMO):
    - NUNCA responda com uma frase genérica + link quando o cliente fez uma PERGUNTA ESPECÍFICA.
    - Se o cliente perguntou algo concreto (endereço, taxa, horário, tempo de entrega, se aceita áudio, se é de Rio das Ostras), RESPONDA EXATAMENTE AQUILO que ele perguntou.
22. QUANDO A MENSAGEM RECEBIDA FOR UMA CONFIRMAÇÃO / RESUMO DE PEDIDO (ex: Jotajá, iFood, etc):
    - O CLIENTE JÁ REALIZOU O PEDIDO COM SUCESSO!
    - É ABSOLUTAMENTE PROIBIDO oferecer mais produtos ou enviar o link do cardápio!
    - Apenas agradeça pela compra com muita alegria, confirmação do pedido e simpatia.
23. TRATAMENTO E USO DO NOME DO CLIENTE:
${customerFirstName ? `    - O primeiro nome do cliente é "${customerFirstName}".
    - Você DEVE OBRIGATORIAMENTE chamar o cliente pelo nome "${customerFirstName}" em suas respostas!` : `    - Se o cliente se apresentar ou disser o nome no meio da conversa, passe a chamá-lo pelo primeiro nome.`}
24. QUANDO O CLIENTE PERGUNTAR SE PODE MANDAR ÁUDIO ("posso mandar áudio?", "posso falar em áudio?", etc):
    - Responda de forma ultra simpática e receptiva: "Pode sim! Pode mandar áudio por aqui que eu escuto e te respondo! 🎙️😊" (SEM MANDAR NENHUM LINK!).
25. QUANDO O CLIENTE PERGUNTAR SE A LOJA É DE RIO DAS OSTRAS OU ONDE FICA:
    - Responda diretamente: "Somos de ${user.city || "Rio das Ostras"} sim! 😊" (SEM MANDAR NENHUM LINK!).
26. QUANDO O CLIENTE DISSER QUE A INTERNET ESTÁ LENTA OU QUE NÃO CONSEGUE ABRIR O SITE:
    - Responda com empatia: "Poxa, sem problemas! Pode ir me mandando por texto mesmo por aqui o que você quer que eu te ajudo a montar! 😊" (SEM MANDAR NENHUM LINK!).
27. QUANDO O CLIENTE PEDIR MAIS INFORMAÇÕES ("posso ter mais informações sobre isso?", "como funciona?", etc):
    - Responda de forma simpática: "Oii! 😊 Te ajudo sim! O que você gostaria de saber? Posso te falar sobre nossos lanches, entregas, valores ou horários!"


DADOS DO CLIENTE CONVERSANDO AGORA:
- Primeiro Nome: ${customerFirstName || "Não identificado"}
- Telefone: ${clientPhoneDigits || "Não informado"}

DADOS DA LOJA:
- Nome da Loja: ${storeName}
- Tipo de Atendimento: ${chatbotConfig.storeType === "PHYSICAL" ? "Possui Loja Física / Atende no Local" : "Só Delivery (Sem consumo no local)"}
- Endereço / Cidade: ${user.storeAddress || user.city || "Não informado"}
- Telefone: ${user.storePhone || "Não informado"}
- Link do Cardápio: ${storeLink}
- Tempo Médio de Entrega da Loja: 45 a 60 minutos
- Aceita Retirada no Balcão: ${chatbotConfig.acceptsPickup ? "SIM" : "NÃO"}
- Horário de Funcionamento Cadastrado: ${nowStatusText || "Aberto todos os dias das 18:00 às 23:30."}
- Quadro Geral de Horários:
${hoursText}

TAXAS DE ENTREGA POR BAIRRO/REGIÃO:
${(() => {
  const zones = Array.isArray((user as any).deliveryZones) ? (user as any).deliveryZones : [];
  const zoneType = (user as any).deliveryZoneType || "";
  const dc = (user.deliveryConfig as any) || {};
  const freeMin = dc.freeShippingMinValue || dc.freeDeliveryMinValue || 0;
  let taxaText = "";
  if (zones.length > 0 && zoneType === "NEIGHBORHOOD") {
    taxaText = zones.map((z: any) => `- ${z.name}: R$ ${Number(z.fee || 0).toFixed(2)}`).join("\n");
  } else if (zones.length > 0 && zoneType === "RADIUS") {
    taxaText = zones.map((z: any) => `- Até ${z.radius || z.maxKm || "?"}km: R$ ${Number(z.fee || 0).toFixed(2)}`).join("\n");
  } else {
    taxaText = "Taxa de entrega calculada automaticamente pelo site conforme endereço do cliente.";
  }
  if (freeMin > 0) taxaText += `\n- FRETE GRÁTIS para pedidos acima de R$ ${Number(freeMin).toFixed(2)}`;
  return taxaText;
})()}

CUPONS VÁLIDOS CADASTRADOS NA LOJA:
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

      const modelNames = ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-2.0-flash-lite"];
      
      let generatedText = "";
      
      for (let idx = 0; idx < modelNames.length; idx++) {
        const mName = modelNames[idx];
        const modelTimeout = idx === 0 ? 10000 : 6000; // 10s primeiro, 6s retries
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), modelTimeout);

          const response = await ai.models.generateContent({
            model: mName,
            contents: fullContents,
            config: {
              systemInstruction: systemPrompt,
              temperature: 0.9,
              topP: 0.95,
              maxOutputTokens: 1000,
              abortSignal: controller.signal,
            }
          });
          
          clearTimeout(timeoutId);
          
          if (response && response.text) {
            generatedText = response.text;
            break;
          }
        } catch (mErr: any) {
          const isTimeout = mErr?.name === "AbortError" || mErr?.message?.includes("abort");
          const errDetail = mErr?.message || mErr?.status || JSON.stringify(mErr).slice(0, 200);
          console.warn(`[Chatbot AI] Modelo ${mName} ${isTimeout ? "⏳ timeout" : "❌ falhou"} (${modelTimeout}ms): ${errDetail}`);
          // Se não foi timeout, o modelo falhou rápido — não vale tentar o próximo com mesmo prompt
          if (!isTimeout && idx === 0) continue;
        }
      }

      if (generatedText) {
        let cleanText = generatedText
          .replace(/(\*\*|\*|_|#|`)/g, "")
          .replace(/R\$\s?(\d+)[.,](\d{2})/gi, "$1 reais")
          .trim();
          
        return { reply: cleanText };
      }

      // Todos os modelos falharam — última tentativa com prompt mínimo
      console.warn("[Chatbot AI] Todos os modelos falharam com prompt completo. Tentando prompt mínimo...");
      try {
        const ai = new GoogleGenAI({ apiKey });
        const miniResponse = await ai.models.generateContent({
          model: "gemini-2.0-flash-lite",
          contents: [{ role: "user", parts: [{ text: message }] }],
          config: {
            systemInstruction: `Você é ${agentName}, atendente do ${storeName}. Responda de forma curta, simpática e natural como uma pessoa no WhatsApp. Link do cardápio: ${storeLink}. ${customerFirstName ? `O cliente se chama ${customerFirstName}.` : ""}`,
            temperature: 0.9,
            maxOutputTokens: 300,
          }
        });
        if (miniResponse?.text) {
          return { reply: miniResponse.text.replace(/(\*\*|\*|_|#|`)/g, "").trim() };
        }
      } catch (miniErr) {
        console.error("[Chatbot AI] Prompt mínimo também falhou:", miniErr);
      }

    } catch (geminiErr) {
      console.error("[Chatbot AI] Erro geral crítico:", geminiErr);
    }

  // Último recurso absoluto — só se TUDO falhou
  return {
    reply: `Oi${customerFirstName ? `, ${customerFirstName}` : ""}! 😊 Tô com uma instabilidade aqui, mas já já normaliza! Enquanto isso, faz teu pedido direto pelo nosso cardápio: ${storeLink}`
  };
}
