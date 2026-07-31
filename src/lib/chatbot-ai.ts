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

  // Separar catálogo entre Combos, Produtos Avulsos Disponíveis Hoje e Indisponíveis
  const todayPromotions: string[] = [];
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
    const isPromoItem = /promo|promoção|promocao|esfirra do dia|oferta do dia/i.test(p.name) || /promo|promoção|promocao/i.test(p.category || "");

    if (isToday) {
      const line = `- ${p.name} (${p.category}): PREÇO = R$ ${p.price.toFixed(2)}${tagsNotice}${p.description ? ` — ${p.description}` : ""}`;
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

  const catalogSummary = `=== 🌟 PROMOÇÃO / ESFIRRA DO DIA EXCLUSIVA DE HOJE (${currentDayName}) 🌟 ===
${todayPromotions.length > 0 ? todayPromotions.join("\n") : "Nenhuma esfirra de promoção avulsa cadastrada para hoje."}
(SE O CLIENTE PERGUNTAR QUAL A PROMOÇÃO DE HOJE OU QUAL A ESFIRRA DA PROMOÇÃO, RESPONDA EXATAMENTE A OPÇÃO ACIMA! É PROIBIDO MENCIONAR QUALQUER OUTRA ESFIRRA COMO SE FOSSE A PROMOÇÃO DE HOJE!)

=== COMBOS E OFERTAS COMPLETAS DISPONÍVEIS HOJE (${currentDayName}) — PRIORIDADE MÁXIMA DE SUGESTÃO! ===
${availableCombos.length > 0 ? availableCombos.join("\n") : "Nenhum combo específico cadastrado."}

=== PRODUTOS E ITENS AVULSOS DISPONÍVEIS HOJE (${currentDayName}) ===
${availableSingleProducts.length > 0 ? availableSingleProducts.join("\n") : "Nenhum item avulso cadastrado."}

=== PRODUTOS/PROMOÇÕES INDISPONÍVEIS HOJE (${currentDayName}) - PROIBIDO OFERECER E PROIBIDO DAR O DESCONTO HOJE! ===
${unavailableTodayProducts.length > 0 ? unavailableTodayProducts.join("\n") : "Nenhum produto indisponível."}`;

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
10. REGRA DE OURO DE SUGESTÃO DE COMBOS E OFERTAS (PRIORIDADE MÁXIMA!):
    - Ao sugerir opções, recomendar mais vendidos ou responder "o que você tem de bom/promoção hoje?", SUGIRA SEMPRE OS COMBOS E OFERTAS COMPLETAS (Ex: Combo 10 Esfirras, Oferta HK 5 itens, Combo Imperial) em vez de esfirras/itens avulsos!
    - Só fale de itens avulsos se o cliente fizer uma pergunta ESPECÍFICA sobre um item individual (ex: "quanto é a esfirra de carne?", "tem de queijo?").
11. QUANDO PEDIREM O CARDÁPIO GERAL OU LINK DE PEDIDO:
    - Cite 1 ou 2 COMBOS em destaque com o preço e envie o link (${storeLink}).
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
18. QUANDO O CLIENTE PERGUNTAR SOBRE TAXA DE ENTREGA / FRETE OU MENCIONAR SEU BAIRRO/RUA:
    - VOCÊ DEVE OBRIGATORIAMENTE INFORMAR O VALOR EM REAIS DA TAXA DE ENTREGA!
    - Consulte a seção "TAXAS DE ENTREGA POR BAIRRO/REGIÃO" abaixo.
    - Se o cliente perguntar se entrega no bairro dele (ex: "Vocês entregam em Nova Esperança?") ou disser o nome da rua:
      a) Responda confirmando a entrega E JÁ INFORME O VALOR DA TAXA imediatamente (ex: "Entregamos em Nova Esperança sim! A taxa de entrega pra aí é R$ 5,00! 🛵").
      b) NUNCA diga respostas evasivas como "é calculada automaticamente pelo sistema no final" sem dar o valor. Informe a taxa exata em reais!
19. DISCRIMINAÇÃO OBRIGATÓRIA DA TAXA DE ENTREGA NO RESUMO DO PEDIDO:
    - Ao apresentar o resumo do pedido para o cliente (ou ao finalizar):
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
      a) VOCÊ DEVE FINALIZAR O PEDIDO NA HORA! Responda agradecendo com entusiasmo e informando que o pedido já foi para a cozinha.
      b) É OBRIGATÓRIO mudar "status" para "NOVO" (ou "ACEITO") e "finalized" para true na tag:
         [[PEDIDO_IA: {"status": "NOVO", "items": [...], "customerName": "Nome Do Cliente", "address": "...", "paymentMethod": "...", "deliveryFee": 5.00, "totalAmount": 16.40, "finalized": true}]]
      c) NUNCA, sob hipótese alguma, responda fazendo novas perguntas de confirmação ou perguntando se é um novo pedido após o cliente ter dito "Certo" ou "Sim"!
    - INSTRUÇÃO OBRIGATÓRIA DE RASCUNHO EM TEMPO REAL:
      Se estiver criando ou atualizando o rascunho em andamento, coloque no FINAL da sua resposta:
      [[PEDIDO_IA: {"status": "CRIANDO_IA", "items": [{"name": "Nome do Produto", "quantity": 1, "price": 25.00}], "customerName": "Nome do Cliente (se souber)", "address": "Rua X", "paymentMethod": "PIX", "deliveryFee": 5.00, "totalAmount": 30.00, "finalized": false}]]
    - REGRA ABSOLUTA DE CANCELAMENTO / DESISTÊNCIA NO WHATSAPP (ATENÇÃO SUPREMA!):
      Se o cliente solicitar o cancelamento ou desistência do pedido (ex: "cancela", "não vou querer mais não", "desisto", "cancela por favor"):
      a) SE O PEDIDO ESTIVER EM MONTAGEM/RASCUNHO OU EM PREPARAÇÃO NA COZINHA (Status: 'CRIANDO_IA', 'NOVO', 'ACEITO', 'EM_PREPARO'):
         - O cancelamento direto via chat É PERMITIDO.
         - Responda gentilmente confirmando o cancelamento do pedido.
         - Anexe obrigatoriamente a tag no final:
           [[PEDIDO_IA: {"status": "CANCELADO", "canceled": true, "items": []}]]
      b) SE O PEDIDO JÁ SAIU PARA ENTREGA COM O MOTOBOY (Status: 'SAIU_PARA_ENTREGA' em pedidos recentes):
         - O CLIENTE NÃO PODE CANCELAR DIRETO PELO CHAT DA IA!
         - NUNCA cancele automaticamente nem anexe status CANCELADO quando o pedido já saiu para entrega!
         - Na primeira solicitação de cancelamento com o pedido na rua, pergunte EXATAMENTE neste tom:
           "Poxa, seu pedido já saiu para entrega com nosso motoboy! 🛵💨 Tem certeza que deseja cancelar?"
         - Se o cliente responder CONFIRMANDO que deseja cancelar mesmo (ex: "sim", "tenho certeza", "quero cancelar mesmo", "sim, cancela"):
           Responda EXATAMENTE:
           "Entendido! Vou chamar um atendente da nossa equipe agora mesmo para te ajudar com isso, por favor aguarde um momento! 😊"
           E anexe obrigatoriamente no final da resposta a tag:
           [[CHAMAR_ATENDENTE: true]]
    - AVISO TRANSPARÊNCIA IA: Se o cliente perguntar se é uma IA ou se pode errar, responda com simpatia: "Sou a atendente virtual por IA da loja! 😊 Faço o máximo pra anotar tudo certinho e nossa equipe humana acompanha cada detalhe no painel!"` : `20. QUANDO O CLIENTE PEDIR UM PRODUTO ESPECÍFICO (ex: "quero essa esfera de 1,90", "quero um X-Burger"):
    - NUNCA faça o pedido diretamente pelo chat! O pedido DEVE ser feito pelo site/cardápio.
    - Responda reconhecendo o produto e DIRECIONE para finalizar pelo site: "Boa escolha! 😋 Pra finalizar seu pedido certinho com endereço e pagamento, é só clicar aqui: ${storeLink}"`}
21. REGRA ANTI-RESPOSTA GENÉRICA (IMPORTANTÍSSIMO):
    - NUNCA responda com uma frase genérica + link quando o cliente fez uma PERGUNTA ESPECÍFICA.
    - Se o cliente perguntou algo concreto (endereço, taxa, horário, tempo de entrega, se aceita áudio, se é de Rio das Ostras), RESPONDA EXATAMENTE AQUILO que ele perguntou.
22. QUANDO A MENSAGEM RECEBIDA FOR UMA CONFIRMAÇÃO / RESUMO DE PEDIDO (ex: Jotajá, iFood, etc):
    - O CLIENTE JÁ REALIZOU O PEDIDO COM SUCESSO!
    - É ABSOLUTAMENTE PROIBIDO oferecer mais produtos ou enviar o link do cardápio!
    - Apenas agradeça pela compra com muita alegria, confirmação do pedido e simpatia.
23. TRATAMENTO E USO DO NOME DO CLIENTE:
${customerFirstName ? `    - O primeiro nome do cliente é "${customerFirstName}".
    - REGRAS DE USO DO NOME: Use o nome "${customerFirstName}" APENAS na saudação inicial (ex: "E aí, ${customerFirstName}!") ou na finalização do pedido.
    - É ESTRITAMENTE PROIBIDO repetir o nome do cliente em mensagens seguidas ou em frases como "E aí, ${customerFirstName}! Claro, te mando sim!". Fale de forma fluida e natural!` : `    - Se o cliente se apresentar, você pode usar o nome dele na saudação ou na finalização, sem repetições excessivas.`}
24. QUANDO O CLIENTE PERGUNTAR SE PODE MANDAR ÁUDIO ("posso mandar áudio?", "posso falar em áudio?", etc):
    - Responda de forma ultra simpática e receptiva: "Pode sim! Pode mandar áudio por aqui que eu escuto e te respondo! 🎙️😊" (SEM MANDAR NENHUM LINK!).
25. QUANDO O CLIENTE PERGUNTAR SE A LOJA É DE RIO DAS OSTRAS OU ONDE FICA:
    - Responda diretamente: "Somos de ${user.city || "Rio das Ostras"} sim! 😊" (SEM MANDAR NENHUM LINK!).
26. QUANDO O CLIENTE DISSER QUE A INTERNET ESTÁ LENTA OU QUE NÃO CONSEGUE ABRIR O SITE:
    - Responda com empatia: "Poxa, sem problemas! Pode ir me mandando por texto mesmo por aqui o que você quer que eu te ajudo a montar! 😊" (SEM MANDAR NENHUM LINK!).
27. QUANDO O CLIENTE PEDIR MAIS INFORMAÇÕES ("posso ter mais informações sobre isso?", "como funciona?", etc):
    - Responda de forma simpática: "Oii! 😊 Te ajudo sim! O que você gostaria de saber? Posso te falar sobre nossos lanches, entregas, valores ou horários!"
28. REGRA DE VERIFICAÇÃO DE PEDIDOS ANTERIORES E ANTI-DUPLICIDADE:
    - Esta regra se aplica APENAS se o cliente JÁ tiver um pedido que JÁ ESTÁ NA COZINHA OU EM ENTREGA (status "Em Preparação", "Aceito", "Saiu para Entrega") cadastrado no campo "PEDIDOS RECENTES DO CLIENTE".
    - Se o cliente mandar uma nova mensagem solicitando itens DO ZERO enquanto já tem um pedido em preparação na cozinha, informe com gentileza que o pedido anterior já está em preparo e pergunte se ele quer fazer um SEGUNDO pedido separado.
    - ATENÇÃO SUPREMA: NUNCA acione esta regra nem pergunte sobre "pedido novo vs pedido anterior" durante o atendimento de um pedido que está sendo montado ou alterado nesta conversa! Se o cliente está informando itens, endereço, pagamento, fazendo alterações ou confirmando ("Certo!", "Sim!"), MANTENHA O FLUXO NORMAL DO PEDIDO ATUAL E FINALIZE SEM PERGUNTAR SOBRE PEDIDO NOVO OU ANTIGO!
29. REGRA ABSOLUTA DE ERRO DE IA, RECALCULO DE PREÇO E PROIBIÇÃO DE DAR DESCONTOS CUSTOMIZADOS:
    - A IA É ABSOLUTAMENTE PROIBIDA DE DAR DESCONTOS CUSTOMIZADOS OU DIZER "A GENTE VAI HONRAR O VALOR QUE TE PASSEI PRIMEIRO"!
    - Se o cliente pedir para pagar um valor mais barato porque a IA errou o cálculo inicialmente ou recalculou o valor correto depois:
    - Você DEVE OBRIGATORIAMENTE responder usando EXATAMENTE a seguinte estrutura de justificativa e postura:
      "Desculpa, como sou uma IA posso cometer algum engano no cálculo inicial, por isso logo me corrigi com você! 😊 Só estou autorizada a te vender no preço oficial do nosso cardápio. Deseja continuar com o pedido no valor correto?"
    - NUNCA honre ou aceite um valor inferior incorreto, NUNCA altere o preço oficial dos produtos e NUNCA invente descontos!


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
  const fixedFee = dc.fixedFee ?? dc.defaultFee ?? dc.deliveryFee ?? dc.fixedDeliveryFee ?? dc.fee ?? null;
  const freeMin = dc.freeShippingMinValue || dc.freeDeliveryMinValue || 0;
  let taxaText = "";
  if (zones.length > 0 && zoneType === "NEIGHBORHOOD") {
    taxaText = zones.map((z: any) => `- ${z.name}: R$ ${Number(z.fee || 0).toFixed(2)}`).join("\n");
  } else if (zones.length > 0 && zoneType === "RADIUS") {
    taxaText = zones.map((z: any) => `- Até ${z.radius || z.maxKm || "?"}km: R$ ${Number(z.fee || 0).toFixed(2)}`).join("\n");
  } else if (fixedFee !== null) {
    taxaText = `- Taxa Padrão de Entrega da Loja: R$ ${Number(fixedFee).toFixed(2)}`;
  } else {
    taxaText = "- Taxa Padrão de Entrega da Loja: R$ 5,00 (ou conforme bairro informado pelo cliente).";
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
        let cleanText = generatedText
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
  const isLid = phoneClean.length > 13 || phoneClean.startsWith("22010");
  let formattedCustomerPhone = phoneClean;
  if (!isLid) {
    formattedCustomerPhone = phoneClean.length === 13 && phoneClean.startsWith("55")
      ? `+55 (${phoneClean.slice(2, 4)}) ${phoneClean.slice(4, 9)}-${phoneClean.slice(9)}`
      : phoneClean.length === 11
      ? `(${phoneClean.slice(0, 2)}) ${phoneClean.slice(2, 7)}-${phoneClean.slice(7)}`
      : phoneClean;
  } else {
    formattedCustomerPhone = `WhatsApp (ID: ${phoneClean.slice(-4)})`;
  }

  // Extrai nome real do cliente se o robô capturou no payload da IA
  const payloadName = (payload.customerName || payload.name || "").trim();
  const finalCustomerName = (payloadName && !payloadName.includes("Cliente WhatsApp"))
    ? payloadName
    : (customerName && !customerName.includes("Cliente WhatsApp") ? customerName : (existingDraft?.customerName || "Cliente WhatsApp"));

  // Salva/Atualiza na base de clientes (StoreCustomer) se o nome for válido e tiver número limpo
  if (finalCustomerName !== "Cliente WhatsApp" && phoneClean && !isLid) {
    prisma.storeCustomer.upsert({
      where: { phone: phoneClean },
      update: { name: finalCustomerName, updatedAt: new Date() },
      create: { phone: phoneClean, name: finalCustomerName, password: "" },
    }).catch((e) => console.error("[Chatbot AI] Erro ao salvar StoreCustomer:", e));
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
}
