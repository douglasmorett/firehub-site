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
  audioData?: { base64: string; mimeType: string },
  pushName?: string
) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      ownerId: true,
      storeName: true,
      storePhone: true,
      storeAddress: true,
      storeLatLng: true,
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

  // Extrai todas as sequências numéricas (3 a 12 dígitos) presentes na mensagem e no histórico recente
  const textToScan = `${message || ""} ${history ? history.slice(-3).map((h: any) => h.text).join(" ") : ""}`;
  const extractedNumbers = textToScan.match(/\d{3,12}/g) || [];

  // Data de início do dia de hoje (UTC/Brasília) para buscar todos os pedidos ativos
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const orderOrConditions: any[] = [];
  if (clientPhoneDigits && clientPhoneDigits.length >= 8) {
    orderOrConditions.push({ customerPhone: { contains: clientPhoneDigits.slice(-8) } });
  }

  for (const numStr of extractedNumbers) {
    orderOrConditions.push({ openDeliveryReference: numStr });
    orderOrConditions.push({ ifoodReference: numStr });
    orderOrConditions.push({ openDeliveryOrderId: { contains: numStr } });
    orderOrConditions.push({ ifoodOrderId: { contains: numStr } });
    orderOrConditions.push({ id: { contains: numStr } });
  }

  // Buscar cardápio ao vivo da loja, pedidos por código/telefone e nome do cliente
  const [products, categories, searchedOrders, customerRecord] = await Promise.all([
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
    orderOrConditions.length > 0 ? prisma.customerOrder.findMany({
      where: {
        franchiseeId: targetFranchiseeId,
        createdAt: { gte: startOfToday },
        status: { not: "CRIANDO_IA" },
        OR: orderOrConditions,
      },
      select: {
        id: true,
        status: true,
        totalAmount: true,
        customerName: true,
        customerPhone: true,
        createdAt: true,
        deliveryType: true,
        ifoodReference: true,
        openDeliveryReference: true,
        openDeliveryChannel: true,
        cancelledBy: true,
        notes: true,
        items: {
          select: {
            quantity: true,
            menuProduct: { select: { name: true } }
          }
        }
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    }) : Promise.resolve([]),
    clientPhoneDigits ? prisma.storeCustomer.findFirst({
      where: {
        phone: { contains: clientPhoneDigits.slice(-8) },
      },
      select: { name: true }
    }) : Promise.resolve(null),
  ]);

  // Filtrar APENAS os pedidos que pertencem EXCLUSIVAMENTE a este cliente/telefone ou aos códigos digitados por ele
  let recentOrders: any[] = searchedOrders.filter((o: any) => {
    if (!clientPhoneDigits) return true;
    const orderPhone = (o.customerPhone || "").replace(/\D/g, "");
    if (orderPhone && orderPhone.includes(clientPhoneDigits.slice(-8))) return true;
    if (extractedNumbers.some((num: string) => o.ifoodReference === num || o.openDeliveryReference === num || o.id.includes(num))) return true;
    return false;
  });

  let rawCustomerName = "";
  if (customerRecord?.name && !/cliente|whatsapp|ifood/i.test(customerRecord.name)) {
    rawCustomerName = customerRecord.name;
  } else if (Array.isArray(recentOrders) && recentOrders.length > 0 && (recentOrders[0] as any).customerName && !/cliente|whatsapp|ifood/i.test((recentOrders[0] as any).customerName)) {
    rawCustomerName = (recentOrders[0] as any).customerName;
  }

  const customerFirstName = getFirstName(rawCustomerName);

  const chatbotConfig = (user.chatbotConfig as any) || {};
  const aiOrderingEnabled = chatbotConfig.aiOrderingEnabled === true;
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

  // ── FIX CRÍTICO DE TIMEZONE (BRASÍLIA / UTC-3) ──
  // No Vercel, new Date() roda em UTC (ex: 22h50 no BR já é 01h50 de sexta em UTC).
  // Precisamos forçar a data atual para o fuso 'America/Sao_Paulo'.
  const getBrazilDayCode = (offsetDays = 0): { code: string; name: string } => {
    const now = new Date();
    if (offsetDays !== 0) now.setDate(now.getDate() + offsetDays);
    const brDayStr = now.toLocaleDateString("en-US", { weekday: "short", timeZone: "America/Sao_Paulo" });
    const EN_TO_BR: Record<string, string> = {
      Sun: "DOM", Mon: "SEG", Tue: "TER", Wed: "QUA", Thu: "QUI", Fri: "SEX", Sat: "SAB"
    };
    const code = EN_TO_BR[brDayStr] || "QUI";
    return { code, name: DAY_NAMES[code] || "Hoje" };
  };

  const { code: currentDayCode, name: currentDayName } = getBrazilDayCode(0);
  const { code: tomorrowDayCode, name: tomorrowDayName } = getBrazilDayCode(1);

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

    const now = new Date();
    const dayIdx = now.getDay() === 0 ? 6 : now.getDay() - 1;
    const today = hoursArr[dayIdx];
    if (today && today.active) {
      const todayFormatted = formatDayHours(today);
      nowStatusText = `Hoje (${currentDayName}) a loja funciona ${todayFormatted}.`;
    } else if (today && !today.active) {
      nowStatusText = `Hoje (${currentDayName}) a loja está fechada.`;
    }
  }

  // Separar catálogo entre Promoções R$ 1,90 HOJE, AMANHÃ, CRONOGRAMA SEMANAL, Combos e Itens Avulsos
  const todayPromotions: string[] = [];
  const itemsAt190Today: string[] = [];
  const tomorrowPromotions: string[] = [];
  const itemsAt190Tomorrow: string[] = [];
  const availableCombos: string[] = [];
  const availableSingleProducts: string[] = [];
  const unavailableTodayProducts: string[] = [];

  const dayScheduleMap: Record<string, string[]> = {
    DOM: [], SEG: [], TER: [], QUA: [], QUI: [], SEX: [], SAB: []
  };

  const seenProductKeys = new Set<string>();

  products.forEach((p: any) => {
    const rawCleanName = (p.name || "").split("|")[0].trim();
    const uniqueKey = `${rawCleanName.toLowerCase()}_${p.price}`;

    const days = parseAvailableDays(p.availableDays);
    let isToday = true;
    let isTomorrow = true;
    let dayNotice = "";

    if (days.length > 0) {
      const upperDays = days.map((d) => d.toUpperCase());
      isToday = upperDays.includes(currentDayCode);
      isTomorrow = upperDays.includes(tomorrowDayCode);
      const dayNamesList = days.map((d) => DAY_NAMES[d.toUpperCase()] || d).join(", ");
      if (isToday) {
        dayNotice = ` [DISPONÍVEL HOJE (${currentDayName})]`;
      } else {
        dayNotice = ` [⚠️ INDISPONÍVEL HOJE (${currentDayName})! Item válido apenas em: ${dayNamesList}]`;
      }
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

    const isChannelImport = /jotaja|ifood|online/i.test(p.category || "");
    const isCombo = p.isCombo === true || /combo|oferta|kit|pack|imperia|príncip|principe|rei|sábio|sabio/i.test(rawCleanName) || /combo|oferta/i.test(p.category || "");
    // Desconsidera itens importados do Jotajá/iFood para a classificação de promoções de R$ 1,90
    const isPrice190 = !isChannelImport && (Math.abs(p.price - 1.90) < 0.10 || p.price === 1.9 || /1[\.,]90/i.test(rawCleanName) || /1[\.,]90/i.test(p.description || ""));
    const isPromoItem = !isChannelImport && (isPrice190 || /promo|promoção|promocao|esfirra do dia|oferta do dia/i.test(rawCleanName) || /promo|promoção|promocao/i.test(p.category || ""));

    // Preenche o cronograma semanal de promoções da loja
    if (isPromoItem || isPrice190) {
      const activeDays = days.length === 0 ? ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SAB"] : days.map(d => d.toUpperCase());
      activeDays.forEach(d => {
        if (dayScheduleMap[d]) {
          dayScheduleMap[d].push(`${rawCleanName} (R$ ${p.price.toFixed(2)})`);
        }
      });
    }

    if (isToday) {
      const priceFormatted = p.price.toFixed(2).replace(".", ",");
      const line = `- ${isCombo ? "COMBO REAL DA LOJA" : "PRODUTO"}: "${rawCleanName}" (${p.category}) ➔ PREÇO EXATO E OBRIGATÓRIO = R$ ${priceFormatted}${tagsNotice}${p.description ? ` — ${p.description}` : ""}`;

      if (!seenProductKeys.has(uniqueKey)) {
        seenProductKeys.add(uniqueKey);

        if (isPrice190) {
          itemsAt190Today.push(line);
        }
        if (isPromoItem) {
          todayPromotions.push(line);
        }
        if (isCombo) {
          availableCombos.push(line);
        } else {
          availableSingleProducts.push(line);
        }
      }
    } else {
      const line = `- "${rawCleanName}" (${p.category}): [PROIBIDO VENDER PELO VALOR PROMOCIONAL HOJE]${dayNotice}`;
      unavailableTodayProducts.push(line);
    }

    if (isTomorrow && (isPromoItem || isPrice190)) {
      const line = `- "${rawCleanName}" (${p.category}): R$ ${p.price.toFixed(2)}${p.description ? ` — ${p.description}` : ""}`;
      if (isPrice190) itemsAt190Tomorrow.push(line);
      tomorrowPromotions.push(line);
    }
  });

  const weeklyScheduleSummary = Object.entries(dayScheduleMap)
    .filter(([_, items]) => items.length > 0)
    .map(([dCode, items]) => `- ${DAY_NAMES[dCode] || dCode}: ${items.join(", ")}`)
    .join("\n");

  const catalogSummary = `=== 🏷️ PROMOÇÃO DE R$ 1,90 / ANÚNCIOS META DE HOJE (${currentDayName}) ===
${itemsAt190Today.length > 0 ? itemsAt190Today.join("\n") : (todayPromotions.length > 0 ? todayPromotions.join("\n") : "- Nenhuma esfirra de R$ 1,90 ativa hoje.")}

=== 📅 PROMOÇÃO E ITENS DE R$ 1,90 AMANHÃ (${tomorrowDayName}) ===
${itemsAt190Tomorrow.length > 0 ? itemsAt190Tomorrow.join("\n") : (tomorrowPromotions.length > 0 ? tomorrowPromotions.join("\n") : "- Amanhã haverá promoção de R$ 1,90 conforme o cardápio da loja.")}

=== 🗓️ CRONOGRAMA DE PROMOÇÕES / DIAS DA SEMANA CADASTRADOS NA LOJA ===
${weeklyScheduleSummary || "- Promoções diárias conforme cardápio ativo da loja!"}
(SE O CLIENTE PERGUNTAR QUAIS DIAS TEM PROMOÇÃO OU SE AMANHÃ VAI TER 1,90, CONSULTE ESTA TABELA REAL DA LOJA E RESPONDA COM TOTAL CERTEZA!)

=== 🌟 PROMOÇÃO / ESFIRRA DO DIA EXCLUSIVA DE HOJE (${currentDayName}) 🌟 ===
${todayPromotions.length > 0 ? todayPromotions.join("\n") : "- Nenhuma promoção cadastrada para hoje."}
(SE O CLIENTE PERGUNTAR QUAL A PROMOÇÃO DE HOJE OU QUAL A ESFIRRA DA PROMOÇÃO, RESPONDA EXATAMENTE A OPÇÃO ACIMA! É PROIBIDO MENCIONAR QUALQUER OUTRA ESFIRRA COMO SE FOSSE A PROMOÇÃO DE HOJE!)

=== COMBOS E OFERTAS COMPLETAS DISPONÍVEIS HOJE (${currentDayName}) — PRIORIDADE MÁXIMA DE SUGESTÃO! ===
${availableCombos.length > 0 ? availableCombos.join("\n") : "Nenhum combo específico cadastrado."}

=== PRODUTOS E ITENS AVULSOS DISPONÍVEIS HOJE (${currentDayName}) ===
${availableSingleProducts.length > 0 ? availableSingleProducts.join("\n") : "Nenhum item avulso cadastrado."}

=== PRODUTOS/PROMOÇÕES INDISPONÍVEIS HOJE (${currentDayName}) - PROIBIDO OFERECER E PROIBIDO DAR O DESCONTO HOJE! ===
${unavailableTodayProducts.length > 0 ? unavailableTodayProducts.join("\n") : "Nenhum produto indisponível."}`;

  let wasInactivityCancelled = false;
  // Formatar pedidos recentes deste cliente
  let recentOrdersSummary = "Nenhum pedido ativo ou recente encontrado no sistema da loja hoje.";
  if (Array.isArray(recentOrders) && recentOrders.length > 0) {
    const last = recentOrders[0] as any;
    if (last.status === "CANCELADO" && (last.cancelledBy === "SYSTEM_INACTIVITY" || (last.notes || "").includes("inatividade"))) {
      wasInactivityCancelled = true;
    }
    recentOrdersSummary = recentOrders.map(o => {
      const statusMap: Record<string, string> = {
        NOVO: "Novo (Recebido no sistema e aguardando confirmação na cozinha)",
        ACEITO: "Em Preparação na Cozinha 🔥",
        PREPARANDO: "Em Preparação na Cozinha 🔥",
        EM_PREPARO: "Em Preparação na Cozinha 🔥",
        SAIU_ENTREGA: "Saiu para Entrega com Motoboy 🛵",
        SAIU_PARA_ENTREGA: "Saiu para Entrega com Motoboy 🛵",
        ENTREGUE: "Entregue com Sucesso ✅",
        CANCELADO: "Cancelado ❌"
      };
      const statusReadable = statusMap[o.status] || o.status;
      const itemsList = o.items.map((i: any) => `${i.quantity}x ${i.menuProduct?.name || "Item"}`).join(", ");
      const channel = (o as any).openDeliveryChannel || ((o as any).openDeliveryReference ? "Jotajá" : (o as any).ifoodReference ? "iFood" : "Site/WhatsApp");
      const refNum = (o as any).openDeliveryReference || (o as any).ifoodReference || (o as any).dailyOrderNumber || o.id.slice(-4).toUpperCase();
      const customerName = o.customerName || "Cliente";

      return `- Pedido #${refNum} (${channel}) | Cliente: "${customerName}" | Tel: "${o.customerPhone || '—'}" | Status: "${statusReadable}" | Itens: ${itemsList} | Total: R$ ${o.totalAmount.toFixed(2)}`;
    }).join("\n");
  }

  // Tratar cupons válidos cadastrados no banco de dados e configuração instantânea do WhatsApp
  const instantCouponEnabled = chatbotConfig.instantCouponEnabled === true;
  const instantCouponCode = (chatbotConfig.instantCouponCode || "").trim();
  const instantCouponDiscount = chatbotConfig.instantCouponDiscount || "10%";

  let availableCouponsText = "";
  if (instantCouponEnabled && instantCouponCode) {
    availableCouponsText += `- Cupom Instantâneo Público de WhatsApp: Código "${instantCouponCode}" (${instantCouponDiscount} OFF)\n`;
  }

  if (Array.isArray(user.storeCoupons) && (user.storeCoupons as any[]).length > 0) {
    // FILTRO DE SEGURANÇA MÁXIMA: APENAS cupons públicos permitidos ou o cupom instantâneo (ex: HAKIM10) podem ser passados para a IA!
    // Cupons sigilosos/estratégicos de recuperação de clientes inativos (como HAKIM15, SAUDADE10) NUNCA são expostos!
    const activePublicCoupons = (user.storeCoupons as any[]).filter(
      (c: any) => c.active !== false && c.code && (c.isPublic === true || c.code.toUpperCase() === (instantCouponCode || "HAKIM10").toUpperCase())
    );
    if (activePublicCoupons.length > 0) {
      availableCouponsText += activePublicCoupons.map((c: any) => {
        const benefitStr = c.type === "free_shipping"
          ? "Frete Grátis / Isenção da taxa de entrega"
          : c.type === "fixed"
          ? `R$ ${c.discount} de desconto no pedido`
          : `${c.discount}% de desconto`;
        const minOrderStr = c.minOrderValue > 0 ? ` — Válido apenas para pedidos a partir de R$ ${c.minOrderValue}` : "";
        return `- Cupom Público Permitido: Código "${c.code}" (${benefitStr}${minOrderStr})`;
      }).join("\n");
    }
  }

  const apiKey = (user.chatbotConfig as any)?.geminiApiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || process.env.VITE_GEMINI_API_KEY;

  if (!apiKey) {
    console.error("[Chatbot AI] CRITICAL: No Gemini API key configured!");
    return { reply: `Olá! 😊 No momento estou com uma instabilidade técnica. Por favor, faça seu pedido direto pelo nosso cardápio: ${storeLink}` };
  }

  // Geocodificação e verificação de raio no mapa em tempo real
  let addressValidationText = "";
  const potentialAddressText = `${message || ""} ${history ? history.slice(-2).map((h: any) => h.text).join(" ") : ""}`;
  const addressRegex = /\b(rua|r\.|avenida|av\.|bairro|estrada|est\.|alameda|travessa|praça|praca|quadra|qd|lote|lt|serra mar|zabulão|zambulao|mariléa|marilea|centro|costa azul|cidade praiana|âncora|ancora|remanso)\b/i;

  if (addressRegex.test(potentialAddressText)) {
    try {
      const { verifyStoreDeliveryAddress } = await import("@/lib/geocoding");
      const geoResult = await verifyStoreDeliveryAddress(
        user.storeAddress,
        user.storeLatLng as any,
        user.city,
        (user.deliveryZones as any) || [],
        user.deliveryZoneType,
        potentialAddressText
      );

      if (geoResult && geoResult.addressFound && geoResult.distanceKm != null) {
        if (geoResult.isWithinRadius) {
          addressValidationText = `
🗺️ VALIDAÇÃO DE MAPA E RAIO DE ENTREGA EM TEMPO REAL:
- Endereço do cliente no mapa: "${geoResult.matchedAddress || geoResult.searchedQuery}"
- Distância calculada no mapa até a loja: ${geoResult.distanceKm} KM
- Raio Máximo Configurado da Loja: ${geoResult.maxRadiusKm} KM
- RESULTADO DO MAPA: ✅ ATENDE COM SUCESSO!
- Taxa de Entrega Calculada: R$ ${geoResult.deliveryFee?.toFixed(2)} (${geoResult.estimatedTimeMin} min)
- INSTRUÇÃO OBRIGATÓRIA DA IA: Diga ao cliente que a loja atende esse endereço SIM com muita alegria! A taxa de entrega é de R$ ${geoResult.deliveryFee?.toFixed(2)}. NUNCA RECUSE ESSE PEDIDO!
`;
        } else {
          addressValidationText = `
🗺️ VALIDAÇÃO DE MAPA E RAIO DE ENTREGA EM TEMPO REAL:
- Endereço do cliente no mapa: "${geoResult.matchedAddress || geoResult.searchedQuery}"
- Distância calculada no mapa até a loja: ${geoResult.distanceKm} KM
- Raio Máximo Configurado da Loja: ${geoResult.maxRadiusKm} KM
- RESULTADO DO MAPA: 🛑 FORA DO RAIO MÁXIMO (${geoResult.distanceKm} km excede o limite de ${geoResult.maxRadiusKm} km da loja)!
- INSTRUÇÃO OBRIGATÓRIA DA IA: Informe com gentileza que o endereço do cliente fica a ${geoResult.distanceKm} km da loja, o que ultrapassa o nosso raio máximo de entrega de ${geoResult.maxRadiusKm} km.
`;
        }
      }
    } catch (errGeo) {
      console.warn("[Chatbot AI] Erro no geocoding do mapa:", errGeo);
    }
  }

  try {
    const systemPrompt = `Você é uma PESSOA REAL chamada ${agentName}, atendente do restaurante ${storeName}.

REGRAS ABSOLUTAS:
1. NUNCA revele que é IA, robô, assistente virtual ou modelo de linguagem. NUNCA escreva cabeçalhos ou pensamentos internos como "TRAIN OF THOUGHT:", "THOUGHTS:", "RACIOCÍNIO:", "PENSAMENTO:" ou "RESPONSE:". Responda diretamente com o texto final em linguagem humana natural!
2. Responda de forma RESUMIDA, DIRETA e NATURAL como uma pessoa real no WhatsApp. (Quando estiver anotando um pedido, confirme o que foi anotado e pergunte de forma proativa os dados que faltam para finalizar: endereço e forma de pagamento!).
3. NUNCA use markdown, asteriscos, bullet points ou formatação de código. Apenas texto puro com emojis naturais.
4. Use gírias e expressões brasileiras naturais (tipo 'po', 'tá bom', 'beleza', 'show', 'e aí', 'bora').
5. REGRA DE CONDUTA DO LINK DO CARDÁPIO (MUITO IMPORTANTE!):
   - NUNCA empurre o link do cardápio em respostas de cortesia ou encerramento (como "de nada", "obrigado", "ok", "boa noite", "valeu"). Nesses casos, responda com gentileza natural (ex: "Imagina, eu que agradeço! 😊 Qualquer coisa me chama!") SEM NENHUM LINK.
   - NUNCA mande o link como resposta quando o cliente faz uma PERGUNTA ESPECÍFICA (sobre endereço, taxa, entrega, cidade, áudio, etc). RESPONDA A PERGUNTA PRIMEIRO de forma direta e fluida.
   - Envie o link do cardápio (${storeLink}) APENAS E SOMENTE SE:
     a) O cliente solicitar o cardápio, fotos ou o link de pedido.
     b) O cliente perguntar valores, sabores, opções de lanches ou demonstrar intenção real de pedir/comprar.
     c) O cliente perguntar por promoções ou cupons ativos.
6. REGRAS DE CONSULTA E STATUS DE PEDIDO DO DIA (JOTAJA, IFOOD, SITE E WHATSAPP):
   - Você tem acesso EM TEMPO REAL aos pedidos do dia cadastrados no sistema da loja (Jotajá, iFood, Site e WhatsApp) listados no campo "PEDIDOS RECENTES DO CLIENTE / PEDIDOS ATIVOS DO DIA" abaixo.
   - Quando o cliente perguntar sobre o pedido ("Chega dentro da prévia?", "cadê meu pedido?", "meu pedido já saiu?", "tá demorando?", "onde tá meu pedido?", "já fiz o pedido"):
     a) Consulte a lista de pedidos abaixo. Se encontrar um pedido correspondente (seja pelo número do WhatsApp, pelo nome do cliente ou pelo número de referência informado como 32653126, 1876 ou #142):
        RESPONDA IMEDIATAMENTE INFORMANDO O STATUS REAL DO PEDIDO COM MUITA SIMPATIA E ALEGRIA! Exemplo: "Oi, Paulo Victor! 🥰 Localizei aqui seu pedido nº 32653126 do Jotajá (16x Esfirra de Calabresa)! Ele já está em preparação na nossa cozinha e vai sair para entrega em instantes dentro da prévia! 🛵🔥"
     b) Se o cliente informar um número de código (ex: 32653126, 1876, #142) ou disser que fez pelo Jotajá/iFood:
        Localize o pedido correspondente na lista abaixo e informe a posição na hora. Se houver qualquer dúvida ou se não tiver 100% de certeza do nome do cliente, pergunte com carinho: "É o pedido no nome de [Nome do Cliente] pelo Jotajá/iFood? Me confirma que eu já te passo a posição exata!"
     c) Se o pedido estiver com status "SAIU_PARA_ENTREGA" ou "SAIU_ENTREGA":
        Diga que o entregador já está a caminho com o pedido e peça para o cliente ficar atento ao interfone/portaria!
7. QUANDO O CLIENTE PERGUNTAR SOBRE PROMOÇÕES OU CUPOM:
   - REGRA MANDATÓRIA DE RESPOSTA A PROMOÇÕES: Se o cliente perguntar "tem alguma promoção?", "quais são as promoções?", "o que tem de promoção hoje?":
     a) VOCÊ DEVE OBRIGATORIAMENTE APRESENTAR PRIMEIRO A ESFIRRA DA PROMOÇÃO DO DIA DE HOJE (ex: Se hoje for Domingo, informe a Esfirra de Queijo (Promo) por R$ 1,90!) E OS COMBOS DA LOJA! NUNCA responda apenas com cupons de desconto sem falar da esfirra da promoção do dia!
     b) Se houver o cupom instantâneo público (${instantCouponCode || "HAKIM10"}), você pode citar APENAS esse cupom de 10% como um agrado extra.
     c) TRAVA DE SEGURANÇA DE CUPONS SIGILOSOS: É RIGOROSAMENTE PROIBIDO divulgar ou citar cupons estratégicos de recuperação (como HAKIM15, SAUDADE10 ou qualquer outro cupom de 15% ou valor em dinheiro). Esses cupons são totalmente secretos e sigilosos! Cite no máximo o cupom público de 10% (${instantCouponCode || "HAKIM10"}).
8. QUANDO O CLIENTE PERGUNTAR O HORÁRIO DE FUNCIONAMENTO:
   - Diga EXATAMENTE os horários de abertura e fechamento informados nos dados da loja (ex: "A gente funciona das 18h às 23:30h!"). NÃO envie o link aqui, a não ser que peçam.
9. QUANDO O CLIENTE PERGUNTAR O TEMPO / PREVISÃO DE ENTREGA:
   - Diga a média de tempo estimada da loja (ex: "Nosso tempo médio de entrega é de 45 a 60 minutos no momento!").
10. REGRA ZERO DE FIDELIDADE ABSOLUTA AO CARDÁPIO DA LOJA (PROIBIÇÃO TOTAL DE ALUCINAÇÃO DE PREÇOS):
    - É SEVERAMENTE PROIBIDO INVENTAR OU MENCIONAR QUALQUER PRODUTO, COMBO, SABOR, REFRIGERANTE OU PREÇO QUE NÃO ESTEJA EXPLICITAMENTE CADASTRADO NO CARDÁPIO ABAIXO!
    - QUANDO CITAR QUALQUER COMBO OU PRODUTO, VOCÊ É OBRIGADO A COPIAR O VALOR EXATO QUE CONSTA APÓS "PREÇO EXATO E OBRIGATÓRIO = R$"!
    - É PROIBIDO DIVIDIR, SOMAR, CALCULAR OU CHUTAR QUALQUER PREÇO! Exemplo: "Monte seu Combo (10 itens Variados)" custa EXATAMENTE R$ 59,90. É PROIBIDO inventar R$ 47,85, R$ 42,89 ou qualquer outro valor!
    - FALE APENAS E EXCLUSIVAMENTE DOS PRODUTOS E COMBOS REAIS CADASTRADOS ABAIXO COM SEUS PREÇOS EXATOS. Se o cliente perguntar o que tem de bom, quais os combos ou como pedir, cite APENAS os itens reais cadastrados abaixo e envie o link oficial: ${storeLink}.
11. QUANDO PEDIREM O CARDÁPIO GERAL OU LINK DE PEDIDO:
    - Cite APENAS itens/combos reais cadastrados no cardápio abaixo com o seu preço exato oficial e envie o link (${storeLink}). NUNCA invente ou chute um produto ou preço que não seja o cadastrado no banco!
12. Quando informar preços, fale de forma natural (ex: "24,90 reais").
13. NUNCA corte frases no meio. Complete o pensamento de forma simples e direta!
14. Seu estilo: ${personalityInstruction}
15. REGRAS ABSOLUTAS DE PREÇO E DISPONIBILIDADE DO DIA (MUITA ATENÇÃO!):
    - Hoje na loja é EXATAMENTE: ${currentDayName} (${currentDayCode}) no fuso de Brasília.
    - REGRA INFALÍVEL DA PROMOÇÃO DO DIA: Se o cliente perguntar "qual a esfirra da promoção?", "qual a promoção de hoje?" ou similar, consulte a seção "🌟 PROMOÇÃO / ESFIRRA DO DIA EXCLUSIVA DE HOJE" no cardápio. RESPONDA EXATAMENTE E APENAS ESSA PROMOÇÃO!
    - REGRA ABSOLUTA DE DOMINGO: Se hoje for Domingo, a promoção de R$ 1,90 é a ESFIRRA DE QUEIJO (PROMO)! É SEVERAMENTE PROIBIDO AFIRMAR QUE A ESFIRRA DE CARNE É A PROMOÇÃO DE HOJE NO DOMINGO!
    - REGRA DE PREÇOS EXATOS: Diga o preço exato do produto HOJE de primeira! NUNCA invente preços como R$ 4,00 ou R$ 15,99 se eles não existirem no cardápio ativo da loja. Se um produto promocional de outro dia estiver indisponível hoje, NUNCA mencione o valor promocional dele hoje.
    - REGRA DE ITENS INDISPONÍVEIS: Produtos na seção "PRODUTOS/PROMOÇÕES INDISPONÍVEIS HOJE" NÃO PODEM ser oferecidos nem vendidos hoje pelo valor promocional sob hipótese alguma.
16. REGRA ABSOLUTA DE ATENDIMENTO 24/7 (MESMO COM CAIXA / LOJA FECHADO):
    - O ROBÔ DEVE FICAR ATIVO E RESPONDER PRA SEMPRE 24 HORAS POR DIA!
    - NUNCA DEIXE DE RESPONDER NENHUMA MENSAGEM SÓ PORQUE A LOJA OU O CAIXA ESTÁ FECHADO.
    - Se o cliente mandar mensagem com a loja fechada, responda normalmente com toda a atenção e simpatia, tire as dúvidas e informe a que horas a loja abre novamente.
17. QUANDO O CLIENTE PERGUNTAR O ENDEREÇO / LOCALIZAÇÃO OU SE PODE COMER NO LOCAL:
${(chatbotConfig.storeType === "PHYSICAL") ? `    - A LOJA TEM ATENDIMENTO PRESENCIAL / FÍSICA!
    - Responda exatamente: "Temos loja física sim! Nosso endereço é: ${user.storeAddress || user.city || "Centro"}" (SEM NENHUM LINK!).` : `    - A LOJA É 100% SÓ DELIVERY NO MOMENTO!
    - Se o cliente perguntar o endereço, se tem loja física ou se pode comer no local, responda exatamente neste tom: "Desculpe, somos só delivery no momento! Não temos atendimento no local! 😊"`}
18. QUANDO O CLIENTE PERGUNTAR SOBRE TAXA DE ENTREGA, FRETE OU SE ENTREGAMOS EM UM BAIRRO/RUA:
    - REGRA INFALÍVEL DE ÁREA DE ENTREGA:
      a) Consulte o campo "VALIDAÇÃO DE MAPA E RAIO DE ENTREGA EM TEMPO REAL" abaixo caso o cliente tenha enviado um endereço.
      b) Se o resultado do mapa indicar "ATENDE COM SUCESSO", aceite o pedido imediatamente, diga que entregamos sim com alegria e informe o valor da taxa de entrega!
      c) Se o resultado do mapa indicar "FORA DO RAIO MÁXIMO", informe com carinho que o endereço fica além do raio máximo da loja.
    - REQUISITO DE RUA E NÚMERO PARA VALOR EXATO DE TAXA DE ENTREGA:
      a) Se o cliente perguntar se entregamos na rua/bairro dele ou o valor da taxa, diga a taxa estimada ou peça a rua e número para conferir o valor exato no mapa: "A nossa taxa de entrega é calculada conforme o seu endereço. Qual a sua rua e número para eu colocar no pedido e ver o valor certinho pra você? 😊"
19. DISCRIMINAÇÃO OBRIGATÓRIA DA TAXA DE ENTREGA NO RESUMO DO PEDIDO:
    - Ao apresentar o resumo do pedido para o cliente (or ao finalizar):
      a) Você DEVE obrigatoriamente discriminar no texto:
         - Subtotal dos itens: R$ X,XX
         - Taxa de entrega: R$ X,XX (ou Frete Grátis)
         - Valor Total a pagar: R$ X,XX
      b) NUNCA omita a taxa de entrega no resumo final do pedido!
20. REGRA ABSOLUTA PARA MENSAGENS DE COMPROVANTE DO JOTAJA OU IFOOD:
    - Se a mensagem do cliente contiver "SEU PEDIDO:", "Acompanhe abaixo o pedido", "Pedido nº:", "RESUMO DO PEDIDO", "jotaja.com" ou "ifood.com.br":
    - O cliente está APENAS colando o comprovante de um pedido que ele JÁ REALIZOU pelo Jotajá ou iFood!
    - O pedido JÁ ENTROU no sistema da cozinha da loja! É TOTALMENTE PROIBIDO CRIAR QUALQUER RASCUNHO OU SEGUNDO PEDIDO! NUNCA GERE TAG [[PEDIDO_IA:...]]!
    - Responda apenas com simpatia: "Recebemos a confirmação do seu pedido feito pelo Jotajá/iFood com sucesso! 🚀 Ele já deu entrada na nossa cozinha e está sendo preparado!"
${aiOrderingEnabled ? `21. MÓDULO DE PEDIDOS DIRETO VIA IA ATIVADO (FLUXO COMPLETO E PROATIVO!):
    - FOCO ABSOLUTO NO PEDIDO ATUAL:
      Ao anotar, alterar ou adicionar itens ao pedido do cliente (ex: "acrescenta 2 esfirras", "muda pra pix", "troca o refri"):
      a) Atualize o rascunho com os itens, recálculo de valor e confirmação natural.
      b) VERIFIQUE O QUE FALTA E PERGUNTE PROATIVAMENTE NA MESMA MENSAGEM:
         - Se não sabe o NOME DO CLIENTE (quando constar "Primeiro Nome: Não identificado" ou "Cliente WhatsApp"), PERGUNTE OBRIGATORIAMENTE: "Qual o seu nome para o cadastro do pedido?"
         - Se falta o endereço completo (Rua, Número e BAIRRO), PERGUNTE OBRIGATORIAMENTE O BAIRRO: "Qual o endereço completo para entrega (rua, número e BAIRRO)?"
         - Se falta o pagamento, pergunte: "Qual a forma de pagamento (Pix, Cartão de Crédito/Débito na entrega ou Dinheiro)?"
         - Se falta o troco (caso dinheiro), pergunte se precisa de troco para quanto.
      c) NUNCA pergunte se o cliente quer fazer "um novo pedido ou alterar o pedido anterior" enquanto ele estiver montando, alterando ou confirmando o pedido atual!
    - CONFIRMAÇÃO E FINALIZAÇÃO IMEDIATA (REGRA CRÍTICA!):
      Se você enviou o resumo do pedido (com Itens, Taxa de Entrega, Total, Endereço e Pagamento) e perguntou "Confirma pra mim?" (ou similar), E O CLIENTE RESPONDEU CONFIRMANDO (ex: "Certo", "Sim", "Tudo certo", "Pode mandar", "Certo!!!!", "OK"):
      a) Você DEVE imediatamente incluir a tag JSON de finalização:
         [[PEDIDO_IA: {"status": "NOVO", "items": [...], "customerName": "Nome", "address": "Endereço", "paymentMethod": "Forma", "deliveryFee": 5.00, "totalAmount": 30.00, "finalized": true}]]
      b) Diga ao cliente: "Perfeito! Seu pedido foi confirmado e enviado para a cozinha! Te avisamos assim que sair para entrega! 🚀"
    - ANOTAÇÃO TEMPORÁRIA DO RASCUNHO (RASCUNHO EM ANDAMENTO):
      Em TODA mensagem onde você estiver anotando itens ou dados sem ter a confirmação final:
      Inclua a tag JSON com "finalized": false:
      [[PEDIDO_IA: {"status": "CRIANDO_IA", "items": [...], "customerName": "...", "address": "...", "paymentMethod": "...", "deliveryFee": 5.00, "totalAmount": 30.00, "finalized": false}]]` : ""}
28. REGRA CRÍTICA PARA SEGUNDO PEDIDO / MUDANÇA DE PEDIDO DA MESMA PESSOA:
    - Esta regra se aplica APENAS se o cliente JÁ tiver um pedido que JÁ ESTÁ NA COZINHA OU EM ENTREGA (status "Em Preparação", "Aceito", "Saiu para Entrega") cadastrado no campo "PEDIDOS RECENTES DO CLIENTE".
    - Se o cliente mandar uma nova mensagem solicitando itens DO ZERO enquanto já tem um pedido em preparação na cozinha, informe com gentileza que o pedido anterior já está em preparo e pergunte se ele quer fazer um SEGUNDO pedido separado.
    - ATENÇÃO SUPREMA: NUNCA acione esta regra nem pergunte sobre "pedido novo vs pedido anterior" durante o atendimento de um pedido que está sendo montado ou alterado nesta conversa! Se o cliente está informando itens, endereço, pagamento, fazendo alterações ou confirmando ("Certo!", "Sim!"), MANTENHA O FLUXO NORMAL DO PEDIDO ATUAL E FINALIZE SEM PERGUNTAR SOBRE PEDIDO NOVO OU ANTIGO!
29. REGRA ABSOLUTA DE ERRO DE IA, RECALCULO DE PREÇO E PROIBIÇÃO DE DAR DESCONTOS CUSTOMIZADOS:
    - A IA É ABSOLUTAMENTE PROIBIDA DE DAR DESCONTOS CUSTOMIZADOS OU DIZER "A GENTE VAI HONRAR O VALOR QUE TE PASSEI PRIMEIRO"!
    - Se o cliente pedir para pagar um valor mais barato porque a IA errou o cálculo inicialmente ou recalculou o valor correto depois:
    - Você DEVE OBRIGATORIAMENTE responder usando EXATAMENTE a seguinte estrutura de justificativa e postura:
30. QUANDO O CLIENTE FIZER UMA LIGAÇÃO DE VOZ OU PERGUNTAR POR QUE NÃO ATENDEU A CHAMADA:
    - Responda educadamente com exatamente este tom carinhoso: "Desculpe, não conseguimos atender ligações por aqui! 😅 Como posso te ajudar?" (SEM MANDAR LINK!).
${wasInactivityCancelled ? `31. REGRA DE RETORNO APÓS INATIVIDADE DE 20 MINUTOS (MUITO IMPORTANTE!):
    - O pedido rascunho anterior do cliente foi cancelado por ter ficado mais de 20 minutos sem resposta.
    - Na PRIMEIRA mensagem de retorno do cliente agora, diga exatamente neste tom carinhoso: "Olha, como você ficou muito tempo ausente, eu acabei parando o pedido por aqui! Mas que bom que voltou! 😊 Como posso te ajudar agora?"
    - Reinicie o atendimento com toda a simpatia!` : ""}
32. REGRA ABSOLUTA PARA PROMOÇÕES DE R$ 1,90, ANÚNCIOS E CONSULTAS SOBRE AMANHÃ OU DIAS DA SEMANA ("Amanhã vai ter 1,90?", "Quais dias tem 1,90?", "Ué não era todo dia?"):
    - É SEVERA E STRICTAMENTE PROIBIDO responder "pra amanhã eu ainda não tenho essa informação certinha", "não sei a de amanhã", "no momento não temos nenhuma por 1,90" ou qualquer frase sem certeza!
    - SE O CLIENTE PERGUNTAR SE AMANHÃ VAI TER SABOR POR R$ 1,90 OU QUAL O SABOR DE AMANHÃ:
      a) Consulte a seção "PROMOÇÃO E ITENS DE R$ 1,90 AMANHÃ (${tomorrowDayName})" no cardápio abaixo.
      b) Se houver item/promoção programada para amanhã (ou se a loja tem promoção todo dia), RESPONDA COM TOTAL CERTEZA E SIMPATIA:
         "Sim! Amanhã (${tomorrowDayName}) teremos promoção de R$ 1,90 sim! 😊 O sabor será [Nome do Sabor de Amanhã / Sabores Promocionais]! Lembramos que para entrega o pedido mínimo é de 26 reais."
    - SE O CLIENTE PERGUNTAR QUAIS DIAS DA SEMANA TEM PROMOÇÃO (ex: "é todo dia?", "quais dias tem?"):
      a) Consulte a seção "CRONOGRAMA DE PROMOÇÕES / DIAS DA SEMANA CADASTRADOS NA LOJA" no cardápio abaixo.
      b) Informe com exatidão os dias reais da semana que aquela loja específica oferece a promoção de R$ 1,90 (ex: "Aqui na nossa loja a promoção de R$ 1,90 rola de Segunda, Quarta e Sexta!" ou "Aqui na nossa loja temos promoção de R$ 1,90 TODOS OS DIAS sim! 😊"). NUNCA diga que não tem certeza sobre os dias da loja!


DADOS DO CLIENTE CONVERSANDO AGORA:
- Primeiro Nome: ${customerFirstName || "NÃO INFORMADO"}
- Telefone: ${clientPhoneDigits || "Não informado"}

REGRAS CRÍTICAS DE NOME E IDENTIFICAÇÃO DO CLIENTE:
1. ${customerFirstName ? `O nome CONFIRMADO deste cliente no banco da loja é "${customerFirstName}". Cumprimente-o com simpatia pelo nome!` : `O nome deste cliente NÃO FOI INFORMADO e NÃO CONSTA no cadastro. Você está RIGOROSAMENTE PROIBIDO de inventar, supor ou usar qualquer nome! Cumprimente SEMPRE usando apenas "Oi!", "Olá!", "Boa noite!", "Tudo bem?". NUNCA chame por nenhum nome se ele não estiver confirmado!`}
2. PROIBIÇÃO ABSOLUTA DE ATRIBUIR PEDIDOS DE OUTROS: Se o cliente veio de um anúncio (ex: "Olá! Posso ter mais informações sobre isso?"), pergunta "quero fazer pedido" ou se não possui pedido cadastrado no seu número de telefone hoje, NUNCA diga que ele tem um pedido em preparação ou em entrega! Acolha a pessoa com simpatia, ofereça ajuda e ENVIE O LINK DO CARDÁPIO DIGITAL DA LOJA: ${storeLink}

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

TAXAS E REGRAS DE ENTREGA POR BAIRRO/REGIÃO:
${(() => {
  const zones = Array.isArray((user as any).deliveryZones) ? (user as any).deliveryZones : [];
  const zoneType = (user as any).deliveryZoneType || "";
  const dc = (user.deliveryConfig as any) || {};
  const fixedFee = dc.fixedFee ?? dc.defaultFee ?? dc.deliveryFee ?? dc.fixedDeliveryFee ?? dc.fee ?? null;
  const freeMin = dc.freeShippingMinValue || dc.freeDeliveryMinValue || 0;
  let taxaText = "";
  if (zones.length > 0 && zoneType === "NEIGHBORHOOD") {
    taxaText = "TIPO DE ENTREGA DA LOJA: POR BAIRRO ESPECÍFICO\n" + zones.map((z: any) => `- ${z.name}: R$ ${Number(z.fee || 0).toFixed(2)}`).join("\n");
  } else if (zones.length > 0 && zoneType === "RADIUS") {
    const maxKm = Math.max(...zones.map((z: any) => Number(z.radius || z.maxKm || 0)));
    taxaText = `TIPO DE ENTREGA DA LOJA: POR RAIO DE DISTÂNCIA DA LOJA!\n- FAIXAS DE KM E TAXAS PERMITIDAS:\n` +
      zones.map((z: any) => `  * Até ${z.radius || z.maxKm || "?"} km: R$ ${Number(z.fee || 0).toFixed(2)}`).join("\n") +
      `\n- RAIO MÁXIMO DE ENTREGA DA LOJA: ${maxKm} KM.`;
  } else if (fixedFee !== null) {
    taxaText = `- Taxa Padrão de Entrega da Loja: R$ ${Number(fixedFee).toFixed(2)}`;
  } else {
    taxaText = "- Taxa Padrão de Entrega da Loja: R$ 5,00 (ou conforme distância/bairro do cliente).";
  }
  if (freeMin > 0) taxaText += `\n- FRETE GRÁTIS para pedidos acima de R$ ${Number(freeMin).toFixed(2)}`;
  return taxaText;
})()}

CUPONS VÁLIDOS CADASTRADOS NA LOJA:
${availableCouponsText || "NENHUM CUPOM DISPONÍVEL NO MOMENTO."}

PEDIDOS RECENTES DESTE CLIENTE NO SEU NÚMERO:
${recentOrdersSummary}

NOSSO CARDÁPIO COMPLETO DA LOJA:
${customPrompt ? `INSTRUÇÕES EXTRAS E PROMOÇÕES DA LOJA: ${customPrompt}` : ""}
${addressValidationText}

Lembre-se: Seja ultra sucinto e objetivo como uma pessoa de verdade digitando no WhatsApp!`;

      const ai = new GoogleGenAI({ apiKey });

      const chatHistory = (history || []).map((h: any) => ({
        role: h.sender === "user" ? "user" : "model",
        parts: [{ text: h.text }]
      }));

      const userParts: any[] = [];
      if (audioData?.base64) {
        const rawMime = audioData.mimeType || "audio/ogg";
        const cleanMime = rawMime.split(";")[0].trim() || "audio/ogg";
        userParts.push({
          inlineData: {
            data: audioData.base64,
            mimeType: cleanMime,
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
              maxOutputTokens: 2000,
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
        // REGRA DE SEGURANÇA MÁXIMA: Sanitizar e remover vazamentos de 'TRAIN OF THOUGHT:', 'RESPONSE:', '1. Acknowledge...', etc.
        if (/(?:TRAIN OF THOUGHT|THOUGHTS|RACIOCÍNIO|THINKING|PENSAMENTO|STEPS|PLAN):/i.test(generatedText)) {
          if (/RESPONSE:/i.test(generatedText)) {
            generatedText = generatedText.split(/RESPONSE:/i).pop() || generatedText;
          } else if (/RESPOSTA:/i.test(generatedText)) {
            generatedText = generatedText.split(/RESPOSTA:/i).pop() || generatedText;
          } else {
            generatedText = generatedText.replace(/(?:TRAIN OF THOUGHT|THOUGHTS|RACIOCÍNIO|THINKING|PENSAMENTO|STEPS|PLAN):[\s\S]*?(?=\n\n|\n[A-Z]|$)/gi, "").trim();
          }
        }

        // Se a resposta vazar lista numerada de instruções internas (ex: "1. Acknowledge and be polite: ... 2. Reinforce... 3. Avoid... Imagina, eu que agradeço!")
        if (/^\s*1\.\s+[A-Z]/i.test(generatedText) || /\b1\.\s+Acknowledge/i.test(generatedText)) {
          // Remove trechos no padrão "1. Step: text. 2. Step: text. 3. Step: text."
          generatedText = generatedText.replace(/(?:\d+\.\s+[^:\n]+:\s*[^.\n]+\.?\s*)+/gi, "").trim();
          // Remove qualquer prefixo numerado até a frase natural humana
          generatedText = generatedText.replace(/^\s*(?:\d+\.\s+[\s\S]*?)+?(?=(?:Imagina|Oi|Olá|Tudo|Certo|Perfeito|É|Desculpe|[A-ZÀ-Ú][a-zà-ú]+!|\n\n|$))/m, "").trim();
        }

        let cleanText = generatedText
          .replace(/^(?:TRAIN OF THOUGHT|THOUGHTS|RACIOCÍNIO|THINKING|PENSAMENTO|RESPONSE|RESPOSTA|PLAN|STEPS):\s*/gi, "")
          .replace(/(\*\*|\*|_|#|`)/g, "")
          .replace(/R\$\s?(\d+)[.,](\d{2})/gi, (_, g1, g2) => (g2 === "00" ? `${g1} reais` : `${g1},${g2} reais`))
          .trim();

        // ── SINCRONIZAR PEDIDO IA EM TEMPO REAL ──
        let rawJsonPayload = "";
        const tagStartIdx = cleanText.indexOf("[[");
        
        if (tagStartIdx !== -1) {
          const tagContent = cleanText.substring(tagStartIdx);
          // Extrai o conteúdo entre o primeiro { e o último }
          const jsonStart = tagContent.indexOf("{");
          if (jsonStart !== -1) {
            let jsonEnd = tagContent.lastIndexOf("}");
            if (jsonEnd > jsonStart) {
              rawJsonPayload = tagContent.substring(jsonStart, jsonEnd + 1);
            } else {
              // Se o JSON foi truncado sem '}', tenta fechar o JSON automaticamente
              rawJsonPayload = tagContent.substring(jsonStart) + '}]}]}';
            }
          }
          // REGRA DE SEGURANÇA IMPERDIÁVEL: Corta TUDO a partir do '[[' da mensagem final enviada ao WhatsApp
          cleanText = cleanText.substring(0, tagStartIdx).trim();
        }

        if (rawJsonPayload) {
          try {
            // Tenta dar parse (com fallback de reparo para JSONs incompletos)
            let orderPayload: any = null;
            try {
              orderPayload = JSON.parse(rawJsonPayload);
            } catch {
              // Tenta fechar colchetes e chaves caso tenha sido cortado
              const repaired = rawJsonPayload.replace(/,\s*$/, "") + '}]}';
              try { orderPayload = JSON.parse(repaired); } catch {}
            }

            if (orderPayload && Array.isArray(orderPayload.items) && clientPhoneDigits) {
              await syncAiOrderToDatabase({
                franchiseeId: targetFranchiseeId,
                customerPhone: clientPhoneDigits,
                customerName: rawCustomerName || customerFirstName || "Cliente WhatsApp",
                payload: orderPayload,
                storeProducts: products,
                autoAccept: user.chatbotConfig ? (user.chatbotConfig as any).autoAcceptOrders === true : false,
              });
            }
          } catch (syncErr) {
            console.error("[Chatbot AI] Erro ao sincronizar pedido IA no banco:", syncErr);
          }
        }
          
        return { reply: cleanText };
      }

      // Todos os modelos falharam — última tentativa com prompt mínimo
      console.warn("[Chatbot AI] Todos os modelos falharam com prompt completo. Tentando prompt mínimo...");
      try {
        const ai = new GoogleGenAI({ apiKey });
        const miniResponse = await ai.models.generateContent({
          model: "gemini-2.0-flash",
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

  // Se o cliente tem pedido ativo de hoje no banco e a mensagem é sobre status ou se houve falha na IA:
  if (Array.isArray(recentOrders) && recentOrders.length > 0) {
    const activeOrder = recentOrders.find((o: any) => {
      const st = (o.status || "").toUpperCase();
      return st !== "CANCELADO" && st !== "ENTREGUE" && st !== "CONCLUIDO";
    }) || recentOrders[0];

    if (activeOrder) {
      const numLabel = activeOrder.ifoodReference ? `#${activeOrder.ifoodReference}` : activeOrder.openDeliveryReference ? `#${activeOrder.openDeliveryReference}` : `#${activeOrder.id.slice(-4).toUpperCase()}`;
      const itemsList = (activeOrder.items || []).map((i: any) => `${i.quantity}x ${i.menuProduct?.name || "Item"}`).join(", ");
      const itemsStr = itemsList ? ` (${itemsList})` : "";
      const st = (activeOrder.status || "").toUpperCase();

      if (st === "SAIU_ENTREGA" || st === "SAIU_PARA_ENTREGA") {
        return { reply: `Oi${customerFirstName ? `, ${customerFirstName}` : ""}! 🛵 Seu pedido ${numLabel}${itemsStr} já saiu para entrega e está a caminho com o motoboy! Em breve chega aí! 😋` };
      } else if (st === "NOVO" || st === "ACEITO" || st === "PREPARANDO" || st === "EM_PREPARO") {
        return { reply: `Oi${customerFirstName ? `, ${customerFirstName}` : ""}! 😊 Seu pedido ${numLabel}${itemsStr} está em preparação na nossa cozinha! Ele vai sair para entrega em instantes, dentro da prévia! 🛵🔥` };
      } else if (st === "ENTREGUE" || st === "CONCLUIDO") {
        return { reply: `Oi${customerFirstName ? `, ${customerFirstName}` : ""}! ✅ Consta em nosso sistema que seu pedido ${numLabel} já foi entregue! Bom apetite!` };
      }
    }
  }

  // Último recurso absoluto — só se TUDO falhou e não havia nenhum pedido no banco
  return {
    reply: `Oi${customerFirstName ? `, ${customerFirstName}` : ""}! 😊 Como posso te ajudar? Se quiser conferir nossos pratos e fazer seu pedido, acesse nosso cardápio digital: ${storeLink}`
  };
}

async function syncAiOrderToDatabase({
  franchiseeId,
  customerPhone,
  customerName,
  payload,
  storeProducts,
  autoAccept,
}: {
  franchiseeId: string;
  customerPhone: string;
  customerName: string;
  payload: any;
  storeProducts: any[];
  autoAccept?: boolean;
}) {
  const phoneClean = customerPhone.replace(/\D/g, "");
  if (!phoneClean) return;

  // Formatar número de telefone de forma numérico limpa (ex: +55 (22) 99823-2027 ou (22) 99823-2027)
  let formattedCustomerPhone = "";
  if (phoneClean.length === 13 && phoneClean.startsWith("55")) {
    formattedCustomerPhone = `+55 (${phoneClean.slice(2, 4)}) ${phoneClean.slice(4, 9)}-${phoneClean.slice(9)}`;
  } else if (phoneClean.length === 12 && phoneClean.startsWith("55")) {
    formattedCustomerPhone = `+55 (${phoneClean.slice(2, 4)}) ${phoneClean.slice(4, 8)}-${phoneClean.slice(8)}`;
  } else if (phoneClean.length === 11) {
    formattedCustomerPhone = `(${phoneClean.slice(0, 2)}) ${phoneClean.slice(2, 7)}-${phoneClean.slice(7)}`;
  } else if (phoneClean.length === 10) {
    formattedCustomerPhone = `(${phoneClean.slice(0, 2)}) ${phoneClean.slice(2, 6)}-${phoneClean.slice(6)}`;
  } else if (phoneClean.length > 0) {
    formattedCustomerPhone = `+${phoneClean}`;
  } else {
    formattedCustomerPhone = customerPhone;
  }

  // Busca pedido rascunho em aberto ou pedido recente nos últimos 20 minutos para evitar duplicidades
  const twentyMinutesAgo = new Date(Date.now() - 20 * 60 * 1000);
  const existingDraft = await prisma.customerOrder.findFirst({
    where: {
      franchiseeId,
      customerPhone: { contains: phoneClean.slice(-8) },
      OR: [
        { status: "CRIANDO_IA" },
        { createdAt: { gte: twentyMinutesAgo }, status: { in: ["NOVO", "ACEITO", "PREPARANDO"] } }
      ]
    },
    include: { items: true },
    orderBy: { createdAt: "desc" },
  });

  // Extrai nome real do cliente se o robô capturou no payload da IA
  const payloadName = (payload.customerName || payload.name || "").trim();
  const finalCustomerName = (payloadName && !payloadName.includes("Cliente WhatsApp"))
    ? payloadName
    : (customerName && !customerName.includes("Cliente WhatsApp") ? customerName : (existingDraft?.customerName || "Cliente WhatsApp"));

  // Salva/Atualiza na base de clientes (StoreCustomer) se o nome for válido e tiver número limpo
  if (finalCustomerName !== "Cliente WhatsApp" && phoneClean && phoneClean.length <= 13) {
    prisma.storeCustomer.upsert({
      where: { phone: phoneClean },
      update: { name: finalCustomerName, updatedAt: new Date() },
      create: { phone: phoneClean, name: finalCustomerName, password: "" },
    }).catch((e) => console.error("[Chatbot AI] Erro ao salvar StoreCustomer:", e));
  }

  const rawStatus = (payload.status || "").toUpperCase().replace(/_/g, "");
  const isCanceled = payload.canceled === true || rawStatus.includes("CANCEL") || rawStatus.includes("DESIST");

  if (isCanceled) {
    if (existingDraft) {
      await prisma.customerOrder.update({
        where: { id: existingDraft.id },
        data: {
          status: "CANCELADO",
          cancelledBy: "CUSTOMER",
          cancelReason: "Cliente desistiu/cancelou no WhatsApp com a IA",
          notes: "🤖 Rascunho cancelado pelo cliente no WhatsApp",
        },
      });
      console.log(`[Chatbot AI Order Sync] ❌ Pedido IA cancelado (${existingDraft.id})`);
    }
    return;
  }

  const isFinal = payload.finalized === true || rawStatus === "NOVO" || rawStatus === "ACEITO" || rawStatus === "FINALIZADO";
  const finalStatus = isFinal
    ? (autoAccept ? "ACEITO" : (rawStatus === "ACEITO" ? "ACEITO" : "NOVO"))
    : "CRIANDO_IA";

  // Se o payload ou dados forem derivados de um comprovante do Jotajá/iFood, bloqueia a criação de rascunho
  const payloadStr = JSON.stringify(payload || {});
  if (
    /SEU PEDIDO:/i.test(payloadStr) ||
    /Acompanhe abaixo o pedido/i.test(payloadStr) ||
    /Pedido nº:/i.test(payloadStr) ||
    /RESUMO DO PEDIDO/i.test(payloadStr) ||
    /jotaja\.com/i.test(payloadStr) ||
    /ifood\.com\.br/i.test(payloadStr)
  ) {
    console.log("[Chatbot AI Sync] 🛑 Abortando sincronização de rascunho IA pois o conteúdo é um comprovante do Jotajá/iFood.");
    return;
  }

  const orderItemsData = (payload.items || []).map((it: any) => {
    const matchedProduct = storeProducts.find(
      (p) => p.name.toLowerCase().trim() === (it.name || "").toLowerCase().trim()
    ) || storeProducts.find(
      (p) => p.name.toLowerCase().includes((it.name || "").toLowerCase()) || (it.name || "").toLowerCase().includes(p.name.toLowerCase())
    );

    // REGRA DE SEGURANÇA SUPREMA E ANTI-ALUCINAÇÃO DE PREÇOS:
    // NUNCA usar o preço inventado pela IA no payload! Usar sempre o preço REAL do produto cadastrado no banco de dados!
    const realPrice = matchedProduct ? matchedProduct.price : (Number(it.price) || 0);
    const quantity = Math.max(1, parseInt(it.quantity) || 1);

    return {
      menuProductId: matchedProduct?.id || null,
      name: matchedProduct?.name || it.name || "Item",
      quantity,
      price: realPrice,
    };
  });

  const totalItemsSum = orderItemsData.reduce((sum: number, i: any) => sum + (i.price * i.quantity), 0);
  const deliveryFee = Number(payload.deliveryFee || payload.deliveryTax || payload.shippingFee || 0);
  // Recalcula o total de forma determinística — NUNCA confiar no valor total chutado pela IA!
  const totalOrderAmount = totalItemsSum + deliveryFee;

  const notesText = payload.finalized
    ? `🤖 Pedido finalizado via IA pelo WhatsApp`
    : `🤖 Pedido sendo montado pela IA no WhatsApp`;

  if (existingDraft) {
    // Atualiza rascunho existente
    await prisma.customerOrderItem.deleteMany({ where: { orderId: existingDraft.id } });

    await prisma.customerOrder.update({
      where: { id: existingDraft.id },
      data: {
        customerName: finalCustomerName,
        customerPhone: formattedCustomerPhone,
        customerAddress: payload.address || existingDraft.customerAddress,
        paymentMethod: payload.paymentMethod || existingDraft.paymentMethod,
        deliveryFee: deliveryFee,
        totalAmount: totalOrderAmount,
        status: finalStatus,
        notes: notesText,
        items: {
          create: orderItemsData.map((i: any) => ({
            quantity: i.quantity,
            price: i.price,
            ...(i.menuProductId ? { menuProduct: { connect: { id: i.menuProductId } } } : {}),
          })),
        },
      },
    });
    console.log(`[Chatbot AI Order Sync] 🔄 Pedido IA atualizado (${existingDraft.id}): status=${finalStatus}, total=R$${totalOrderAmount} (entrega=R$${deliveryFee})`);
  } else {
    // Cria novo pedido rascunho
    const newOrder = await prisma.customerOrder.create({
      data: {
        franchiseeId,
        customerName: finalCustomerName,
        customerPhone: formattedCustomerPhone,
        customerAddress: payload.address || null,
        paymentMethod: payload.paymentMethod || null,
        deliveryFee: deliveryFee,
        totalAmount: totalOrderAmount,
        deliveryType: "DELIVERY",
        source: "WHATSAPP_IA",
        status: finalStatus,
        notes: notesText,
        items: {
          create: orderItemsData.map((i: any) => ({
            quantity: i.quantity,
            price: i.price,
            ...(i.menuProductId ? { menuProduct: { connect: { id: i.menuProductId } } } : {}),
          })),
        },
      },
    });
    console.log(`[Chatbot AI Order Sync] ✅ Novo pedido IA criado (${newOrder.id}): status=${finalStatus}, total=R$${totalOrderAmount} (entrega=R$${deliveryFee})`);
  }

  // 🖨️ APENAS SE O PEDIDO FOI TOTALMENTE FINALIZADO E CONFIRMADO PELO CLIENTE:
  if (isFinal) {
    try {
      const targetOrderId = existingDraft ? existingDraft.id : null;
      const { pushJobToPrintQueue } = await import("@/app/api/store/print-queue/route");
      const fullOrderForPrint = await prisma.customerOrder.findFirst({
        where: targetOrderId ? { id: targetOrderId } : { franchiseeId, status: finalStatus },
        include: { items: { include: { menuProduct: true } } },
        orderBy: { createdAt: "desc" },
      });
      if (fullOrderForPrint) {
        pushJobToPrintQueue(franchiseeId, fullOrderForPrint);
        console.log(`[Chatbot AI Order Sync] 🖨️ Pedido IA finalizado (${fullOrderForPrint.id}) enviado para impressão na cozinha!`);
      }
    } catch (printErr) {
      console.error("[Chatbot AI Order Sync] Erro ao enfileirar impressão do pedido IA:", printErr);
    }
  }

  // Executa limpeza preventiva de rascunhos antigos da loja
  checkAndCleanupStaleAiDrafts(franchiseeId).catch(() => {});
}

/**
 * Verifica rascunhos de pedidos IA ("CRIANDO_IA"):
 * 1. Após 20 minutos de inatividade sem resposta do cliente: envia mensagem no WhatsApp perguntando se deseja continuar o pedido.
/**
 * Cancela automaticamente rascunhos em estado CRIANDO_IA após 20 minutos sem resposta/interação do cliente.
 */
export async function checkAndCleanupStaleAiDrafts(franchiseeIdFilter?: string) {
  try {
    const now = Date.now();
    const twentyMinAgo = new Date(now - 20 * 60 * 1000); // 20 minutos sem interagir

    const whereCondition: any = {
      status: "CRIANDO_IA",
      updatedAt: { lte: twentyMinAgo }
    };
    if (franchiseeIdFilter) {
      whereCondition.franchiseeId = franchiseeIdFilter;
    }

    const staleDrafts = await prisma.customerOrder.findMany({
      where: whereCondition,
      select: {
        id: true,
        franchiseeId: true,
        customerPhone: true,
        customerName: true,
        notes: true,
      },
    });

    if (!staleDrafts || staleDrafts.length === 0) return;

    for (const draft of staleDrafts) {
      await prisma.customerOrder.update({
        where: { id: draft.id },
        data: {
          status: "CANCELADO",
          cancelledBy: "SYSTEM_INACTIVITY",
          cancelReason: "Cancelado por inatividade do cliente por mais de 20 minutos",
          notes: `${draft.notes || ""}\n🤖 Rascunho IA cancelado por inatividade de 20 min`,
        },
      });
      console.log(`[Chatbot AI Cleanup] ❌ Rascunho IA cancelado por inatividade de 20 min (${draft.id})`);
    }
  } catch (err: any) {
    console.error("[Chatbot AI Cleanup Error]:", err?.message);
  }
}
