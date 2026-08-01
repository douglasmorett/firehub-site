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
        status: { not: "CRIANDO_IA" },
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
  const getBrazilDayCode = (): { code: string; name: string } => {
    const brDayStr = new Date().toLocaleDateString("en-US", { weekday: "short", timeZone: "America/Sao_Paulo" });
    const EN_TO_BR: Record<string, string> = {
      Sun: "DOM", Mon: "SEG", Tue: "TER", Wed: "QUA", Thu: "QUI", Fri: "SEX", Sat: "SAB"
    };
    const code = EN_TO_BR[brDayStr] || "QUI";
    return { code, name: DAY_NAMES[code] || "Hoje" };
  };

  const { code: currentDayCode, name: currentDayName } = getBrazilDayCode();

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

  // Separar catálogo entre Promoções R$ 1,90, Combos, Produtos Avulsos Disponíveis Hoje e Indisponíveis
  const todayPromotions: string[] = [];
  const itemsAt190: string[] = [];
  const availableCombos: string[] = [];
  const availableSingleProducts: string[] = [];
  const unavailableTodayProducts: string[] = [];

  products.forEach((p: any) => {
    const days = parseAvailableDays(p.availableDays);
    let isToday = true;
    let dayNotice = "";

    if (days.length > 0) {
      isToday = days.map((d) => d.toUpperCase()).includes(currentDayCode);
      const dayNamesList = days.map((d) => DAY_NAMES[d.toUpperCase()] || d).join(", ");
      if (isToday) {
        dayNotice = ` [DISPONÍVEL HOJE (${currentDayName})]`;
      } else {
        dayNotice = ` [⚠️ INDISPONÍVEL HOJE (${currentDayName})! Promoção/Item válido apenas em: ${dayNamesList}]`;
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

    const isCombo = p.isCombo === true || /combo|oferta|kit|pack|imperia|príncip|principe|rei|sábio|sabio/i.test(p.name) || /combo|oferta/i.test(p.category || "");
    const isPrice190 = Math.abs(p.price - 1.90) < 0.10 || p.price === 1.9 || /1[\.,]90/i.test(p.name) || /1[\.,]90/i.test(p.description || "") || /1[\.,]90/i.test(p.category || "");
    const isPromoItem = isPrice190 || /promo|promoção|promocao|esfirra do dia|oferta do dia/i.test(p.name) || /promo|promoção|promocao/i.test(p.category || "");

    if (isToday) {
      const line = `- ${p.name} (${p.category}): PREÇO = R$ ${p.price.toFixed(2)}${tagsNotice}${p.description ? ` — ${p.description}` : ""}`;
      if (isPrice190) {
        itemsAt190.push(line);
      }
      if (isPromoItem) {
        todayPromotions.push(line);
      }
      if (isCombo) {
        availableCombos.push(line);
      } else {
        availableSingleProducts.push(line);
      }
    } else {
      const line = `- ${p.name} (${p.category}): [PROIBIDO VENDER PELO VALOR PROMOCIONAL HOJE]${dayNotice}`;
      unavailableTodayProducts.push(line);
    }
  });

  const catalogSummary = `=== 🏷️ PROMOÇÃO DE R$ 1,90 / ANÚNCIOS META/FACEBOOK DE HOJE (${currentDayName}) ===
${itemsAt190.length > 0 ? itemsAt190.join("\n") : (todayPromotions.length > 0 ? todayPromotions.join("\n") : "Consulte a Esfirra do Dia na seção abaixo para informar ao cliente!")}
(SE O CLIENTE PERGUNTAR "É 1,90 QUALQUER SABOR?", PERGUNTAR DO ANÚNCIO DE R$ 1,90 OU QUAL A PROMOÇÃO DE 1,90, INFORME O ITEM/PROMOÇÃO ACIMA! NUNCA DIGA QUE NÃO TEMOS SABOR POR 1,90!)

=== 🌟 PROMOÇÃO / ESFIRRA DO DIA EXCLUSIVA DE HOJE (${currentDayName}) 🌟 ===
${todayPromotions.length > 0 ? todayPromotions.join("\n") : "Nenhuma esfirra de promoção avulsa cadastrada para hoje."}
(SE O CLIENTE PERGUNTAR QUAL A PROMOÇÃO DE HOJE OU QUAL A ESFIRRA DA PROMOÇÃO, RESPONDA EXATAMENTE A OPÇÃO ACIMA! É PROIBIDO MENCIONAR QUALQUER OUTRA ESFIRRA COMO SE FOSSE A PROMOÇÃO DE HOJE!)

=== COMBOS E OFERTAS COMPLETAS DISPONÍVEIS HOJE (${currentDayName}) — PRIORIDADE MÁXIMA DE SUGESTÃO! ===
${availableCombos.length > 0 ? availableCombos.join("\n") : "Nenhum combo específico cadastrado."}

=== PRODUTOS E ITENS AVULSOS DISPONÍVEIS HOJE (${currentDayName}) ===
${availableSingleProducts.length > 0 ? availableSingleProducts.join("\n") : "Nenhum item avulso cadastrado."}

=== PRODUTOS/PROMOÇÕES INDISPONÍVEIS HOJE (${currentDayName}) - PROIBIDO OFERECER E PROIBIDO DAR O DESCONTO HOJE! ===
${unavailableTodayProducts.length > 0 ? unavailableTodayProducts.join("\n") : "Nenhum produto indisponível."}`;

  let wasInactivityCancelled = false;
  // Formatar pedidos recentes deste cliente
  let recentOrdersSummary = "Nenhum pedido recente encontrado para este número.";
  if (Array.isArray(recentOrders) && recentOrders.length > 0) {
    const last = recentOrders[0] as any;
    if (last.status === "CANCELADO" && (last.cancelledBy === "SYSTEM_INACTIVITY" || (last.notes || "").includes("inatividade"))) {
      wasInactivityCancelled = true;
    }
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
6. REGRA ABSOLUTA DE STATUS DE PEDIDO E PROIBIÇÃO DE PEDIR TELEFONE/NOME DE QUEM JÁ ESTÁ NO WHATSAPP:
   - PROIBIÇÃO DE PEDIR NOME OU TELEFONE: Você É ESTRITAMENTE PROIBIDA de pedir para o cliente o número de telefone, DDD ou nome completo para "procurar o pedido" ou "conferir no sistema"!
   - POR QUE? O sistema JÁ busca o número do WhatsApp do cliente automaticamente e JÁ consulta o histórico e pedidos recentes do cliente no campo "PEDIDOS RECENTES DO CLIENTE" abaixo.
   - Se o cliente perguntar o status do pedido ("alguma posição do meu pedido?", "cadê meu pedido?", "tá demorando"):
     a) Consulte o campo "PEDIDOS RECENTES DO CLIENTE" abaixo. Se houver pedido recente, informe o status atual dele com simpatia.
     b) Se o cliente disser "não recebi", "foi não" ou reclamar que o pedido ainda não chegou:
        NUNCA peça telefone, nome ou número do pedido! Responda com carinho e empatia:
        "Poxa, me desculpa! Vou verificar agora mesmo com a nossa equipe o que aconteceu com o seu pedido! Um instante, por favor! 😊"
7. QUANDO O CLIENTE PERGUNTAR SOBRE CUPOM DE DESCONTO / PROMOÇÕES:
   - REGRA CRÍTICA DE CUPOM: NUNCA INVENTE CÓDIGOS DE CUPOM! Você é PROIBIDA de inventar cupons que não estejam listados no campo "CUPONS VÁLIDOS CADASTRADOS" abaixo.
   - SE HOUVER CUPOM LISTADO ABAIXO: Informe o código exatamente como cadastrado e o desconto (ex: "Tenho sim! Usa o cupom ${instantCouponCode || "CUPOM"} e ganhe desconto no seu pedido! ${storeLink}").
   - SE NÃO HOUVER NENHUM CUPOM VALIDO LISTADO ABAIXO: Você DEVE responder neste tom natural: "Poxa, infelizmente não temos cupons de desconto disponíveis no momento, mas se quiser te passo as opções do cardápio! 😊".
8. QUANDO O CLIENTE PERGUNTAR O HORÁRIO DE FUNCIONAMENTO:
   - Diga EXATAMENTE os horários de abertura e fechamento informados nos dados da loja (ex: "A gente funciona das 18h às 23:30h!"). NÃO envie o link aqui, a não ser que peçam.
9. QUANDO O CLIENTE PERGUNTAR O TEMPO / PREVISÃO DE ENTREGA:
   - Diga a média de tempo estimada da loja (ex: "Nosso tempo médio de entrega é de 45 a 60 minutos no momento!").
10. REGRA ZERO DE FIDELIDADE ABSOLUTA AO CARDÁPIO DA LOJA (PROIBIÇÃO TOTAL DE ALUCINAÇÃO):
    - É SEVERAMENTE PROIBIDO INVENTAR OU MENCIONAR QUALQUER PRODUTO, COMBO, SABOR, REFRIGERANTE OU PREÇO QUE NÃO ESTEJA EXPLICITAMENTE CADASTRADO NO CARDÁPIO ABAIXO!
    - NÃO INVENTE "Combo Esfiha Lovers", "Combo Família", "Refrigerante 1L" ou qualquer outro produto/combo fictício! Se um item ou tamanho não consta na lista "NOSSO CARDÁPIO COMPLETO DA LOJA" abaixo, ELE NÃO EXISTE NA LOJA E É ESTRITAMENTE PROIBIDO MENCIONÁ-LO!
    - FALE APENAS E EXCLUSIVAMENTE DOS PRODUTOS E COMBOS REAIS CADASTRADOS ABAIXO COM SEUS PREÇOS EXATOS. Se o cliente perguntar o que tem de bom, quais os combos ou como pedir, cite APENAS os itens reais cadastrados abaixo e envie o link oficial: ${storeLink}.
11. QUANDO PEDIREM O CARDÁPIO GERAL OU LINK DE PEDIDO:
    - Cite APENAS itens/combos reais cadastrados no cardápio abaixo com o seu preço exato oficial e envie o link (${storeLink}). NUNCA invente ou chute um produto ou preço que não seja o cadastrado no banco!
12. Quando informar preços, fale de forma natural (ex: "24,90 reais").
13. NUNCA corte frases no meio. Complete o pensamento de forma simples e direta!
14. Seu estilo: ${personalityInstruction}
15. REGRAS ABSOLUTAS DE PREÇO E DISPONIBILIDADE DO DIA (MUITA ATENÇÃO!):
    - Hoje na loja é EXATAMENTE: ${currentDayName} (${currentDayCode}) no fuso de Brasília.
    - REGRA INFALÍVEL DA PROMOÇÃO DO DIA: Se o cliente perguntar "qual a esfirra da promoção?", "qual a promoção de hoje?" ou similar, consulte a seção "🌟 PROMOÇÃO / ESFIRRA DO DIA EXCLUSIVA DE HOJE" no cardápio. RESPONDA EXATAMENTE E APENAS ESSA PROMOÇÃO! É ESTRITAMENTE PROIBIDO citar qualquer outra esfirra de outro dia e DEPOIS mandar mensagem se corrigindo dizendo "me enganei" ou "confundi"!
    - REGRA DE PREÇOS EXATOS: Diga o preço exato do produto HOJE de primeira! Se um produto promocional de outro dia estiver indisponível hoje, NUNCA mencione o valor promocional dele hoje.
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
${aiOrderingEnabled ? `20. MÓDULO DE PEDIDOS DIRETO VIA IA ATIVADO (FLUXO COMPLETO E PROATIVO!):
    - FOCO ABSOLUTO NO PEDIDO ATUAL:
      Ao anotar, alterar ou adicionar itens ao pedido do cliente (ex: "acrescenta 2 esfirras", "muda pra pix", "troca o refri"):
      a) Atualize o rascunho com os itens, recálculo de valor e confirmação natural.
      b) VERIFIQUE O QUE FALTA E PERGUNTE PROATIVAMENTE NA MESMA MENSAGEM:
         - Se não sabe o NOME DO CLIENTE (quando constar "Primeiro Nome: Não identificado" ou "Cliente WhatsApp"), PERGUNTE OBRIGATORIAMENTE: "Qual o seu nome para o cadastro do pedido?"
         - Se falta o endereço, pergunte: "Qual o endereço completo para entrega (rua, número, bairro)?"
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
32. REGRA ABSOLUTA PARA PROMOÇÃO DE R$ 1,90 / ANÚNCIOS DO FACEBOOK E INSTAGRAM ("É 1.90 qualquer sabor?", "E essa propaganda aqui?"):
    - Se o cliente perguntar "é 1.90 qualquer sabor?", "qual a de 1,90 hoje?", citar "1,90", "anúncio de 1.90", "propaganda do Facebook/Instagram" ou mandar citação/print do anúncio:
    - É ESTRITAMENTE PROIBIDO responder "Poxa, não temos qualquer sabor por 1,90 reais hoje!" ou negar a promoção!
    - VOCÊ DEVE OBRIGATORIAMENTE PROCURAR NO CARDÁPIO ABAIXO O ITEM QUE CUSTA R$ 1,90 OU A ESFIRRA/PROMOÇÃO DO DIA DE HOJE!
    - Informe com clareza e entusiasmo qual é o sabor que está na promoção de R$ 1,90 hoje!
    - Exemplo de resposta: "Oi! A nossa promoção de R$ 1,90 de hoje é a Esfirra de [Nome do Sabor em Promoção / Esfirra do Dia de Hoje]! 😋 Quantas você gostaria de pedir?"


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

      const modelNames = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-2.5-flash-lite"];
      
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
        // REGRA DE SEGURANÇA MÁXIMA: Sanitizar e remover vazamentos de 'TRAIN OF THOUGHT:', 'RESPONSE:', etc.
        if (/TRAIN OF THOUGHT:|THOUGHTS:|RACIOCÍNIO:|THINKING:|PENSAMENTO:/i.test(generatedText)) {
          if (/RESPONSE:/i.test(generatedText)) {
            generatedText = generatedText.split(/RESPONSE:/i).pop() || generatedText;
          } else if (/RESPOSTA:/i.test(generatedText)) {
            generatedText = generatedText.split(/RESPOSTA:/i).pop() || generatedText;
          } else {
            generatedText = generatedText.replace(/(?:TRAIN OF THOUGHT|THOUGHTS|RACIOCÍNIO|THINKING|PENSAMENTO):[\s\S]*?(?=\n\n|\n[A-Z]|$)/gi, "").trim();
          }
        }

        let cleanText = generatedText
          .replace(/^(?:TRAIN OF THOUGHT|THOUGHTS|RACIOCÍNIO|THINKING|PENSAMENTO|RESPONSE|RESPOSTA):\s*/gi, "")
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
          model: "gemini-2.5-flash-lite",
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

  const orderItemsData = (payload.items || []).map((it: any) => {
    const matchedProduct = storeProducts.find(
      (p) => p.name.toLowerCase().trim() === (it.name || "").toLowerCase().trim()
    ) || storeProducts.find(
      (p) => p.name.toLowerCase().includes((it.name || "").toLowerCase()) || (it.name || "").toLowerCase().includes(p.name.toLowerCase())
    );

    const price = it.price || matchedProduct?.price || 0;
    const quantity = Math.max(1, parseInt(it.quantity) || 1);

    return {
      menuProductId: matchedProduct?.id || null,
      name: it.name || matchedProduct?.name || "Item",
      quantity,
      price,
    };
  });

  const totalItemsSum = orderItemsData.reduce((sum: number, i: any) => sum + (i.price * i.quantity), 0);
  const deliveryFee = Number(payload.deliveryFee || payload.deliveryTax || payload.shippingFee || 0);
  const totalOrderAmount = Number(payload.totalAmount || (totalItemsSum + deliveryFee));

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
