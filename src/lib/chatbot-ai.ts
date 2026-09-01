import { prisma } from "@/lib/prisma";
import fs from "fs";

import { generateDailyOrderNumber } from "@/lib/order-number";
import { GoogleGenAI } from "@google/genai";
import { trackGeminiUsage } from "@/lib/usage-tracker";
import { normalizeStoreHours } from "@/lib/store-hours";
import { precoMinimoDoProduto, precoVariaPorEscolha, minimoExigidoDoGrupo } from "./preco-combo";
import { SEM_PRODUTO_DE_INTEGRACAO, idsSoDeOpcaoDeCombo } from "./cardapio-interno";
import { aplicarPrecoNoCardapio } from "./preco-por-canal";
import { mesmoTelefone, telefoneCanonico } from "./telefone";
import { inicioDoExpedienteDaLoja } from "./fuso";

/**
 * Chave do Gemini que o robô vai usar, na ordem: loja → ambiente → conta matriz.
 *
 * O terceiro nível existe porque sem ele o robô só atende nas lojas em que
 * alguém configurou uma chave à mão, uma a uma. Era exatamente o que acontecia
 * em 23/08/2026: a Hakim Centro tinha chave própria e respondia; a Brasa
 * Burguer não tinha e devolvia "instabilidade técnica" para qualquer mensagem,
 * porque GEMINI_API_KEY também não estava no ambiente de produção.
 *
 * Com a chave guardada uma única vez na conta matriz (isFireHubSystem), toda
 * loja passa a atender assim que o lojista conecta o QR — inclusive as que
 * forem cadastradas depois, sem ninguém precisar lembrar de configurar nada.
 *
 * A variável de ambiente continua tendo precedência sobre a matriz: quem
 * preferir manter o segredo só no painel de deploy não é afetado.
 */
let cacheChaveMatriz: { valor: string | null; expiraEm: number } | null = null;

async function resolverChaveGemini(chatbotConfig: any): Promise<string | null> {
  const daLoja = chatbotConfig?.geminiApiKey;
  if (daLoja) return daLoja;

  const doAmbiente =
    process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || process.env.VITE_GEMINI_API_KEY;
  if (doAmbiente) return doAmbiente;

  // Cache curto: sem ele seria uma consulta a mais por mensagem recebida.
  if (cacheChaveMatriz && cacheChaveMatriz.expiraEm > Date.now()) return cacheChaveMatriz.valor;

  try {
    const matriz = await prisma.user.findFirst({
      where: { isFireHubSystem: true },
      select: { chatbotConfig: true },
    });
    const valor = ((matriz?.chatbotConfig as any)?.geminiApiKey as string) || null;
    // So guarda em cache quando ACHOU. Cachear a ausencia deixaria o robo mudo
    // por mais 5 minutos depois de alguem cadastrar a chave — justamente no
    // momento em que a pessoa vai testar se funcionou.
    if (valor) cacheChaveMatriz = { valor, expiraEm: Date.now() + 5 * 60 * 1000 };
    return valor;
  } catch (err) {
    console.error("[Chatbot AI] Falha ao ler a chave da conta matriz:", (err as Error)?.message);
    return null;
  }
}

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
      email: true,
      isFranqueadoHakim: true,
      storeName: true,
      storePhone: true,
      storeAddress: true,
      storeLatLng: true,
      storeTimezone: true,
      city: true,
      slug: true,
      storeHours: true,
      deliveryConfig: true,
      deliveryZones: true,
      deliveryZoneType: true,
      chatbotConfig: true,
      storeCoupons: true,
      notificationPhone: true,
      cashOpen: true,
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

  // Começo do dia NO FUSO DA LOJA, não no do processo.
  //
  // Aqui havia `new Date()` + `setHours(0,0,0,0)`, e o comentário dizia
  // "(UTC/Brasília)" como se fossem a mesma coisa. Não são: `setHours` usa o
  // fuso do PROCESSO, e o container de produção é `node:20-alpine` sem `tzdata`
  // e sem `TZ` — ou seja, UTC. Em Brasília o "dia" começava às 21:00 da véspera.
  //
  // O estrago, medido em 28/08/2026: cliente pediu às 20:36, recebeu o aviso de
  // "saiu para entrega", perguntou do pedido às 21:06 e o robô respondeu que não
  // havia pedido nenhum — e começou a montar outro. Entre 21:00 e a meia-noite,
  // TODO o jantar sumia da busca. Todo dia, no pico.
  //
  // Não dá para usar `user.storeTimezone` aqui: o `user` só chega no
  // `Promise.all` abaixo. Brasília é o padrão do schema e o fuso de todas as
  // lojas hoje; se um dia houver loja em outro fuso, este é o ponto a ajustar.
  const startOfToday = inicioDoExpedienteDaLoja();

  const orderOrConditions: any[] = [];
  if (clientPhoneDigits && clientPhoneDigits.length >= 8) {
    // O funil por telefone usa os últimos QUATRO dígitos, não oito.
    //
    // `customerPhone` é gravado FORMATADO — "(22) 98112-8512" — e o hífen cai
    // exatamente no meio dos últimos oito dígitos: `contains("1128512")` nunca
    // casa com "112-8512". Era por isso que o robô jurava "não encontrei nenhum
    // pedido registrado com este número hoje" para pedidos que EXISTIAM no
    // painel — e recomeçava o pedido do zero. Os últimos quatro ficam depois do
    // hífen, contíguos, e casam em qualquer formato. Quem decide de verdade é o
    // filtro em memória logo abaixo, que compara dígito a dígito.
    orderOrConditions.push({ customerPhone: { contains: clientPhoneDigits.slice(-4) } });
  }

  for (const numStr of extractedNumbers) {
    orderOrConditions.push({ openDeliveryReference: numStr });
    orderOrConditions.push({ ifoodReference: numStr });
    orderOrConditions.push({ openDeliveryOrderId: { contains: numStr } });
    orderOrConditions.push({ ifoodOrderId: { contains: numStr } });
    orderOrConditions.push({ id: { contains: numStr } });
  }

  // Buscar cardápio ao vivo da loja, pedidos por código/telefone e nome do cliente
  const [produtosCrus, categories, searchedOrders, customerCandidates] = await Promise.all([
    prisma.menuProduct.findMany({
      // O espelho do iFood/Jotajá/99Food fica de FORA do que o robô oferece.
      // São cópias do mesmo prato criadas pela sincronização, muitas vezes com
      // preço de canal (que embute a comissão da plataforma). Sem este filtro o
      // robô listava o mesmo item duas vezes com valores diferentes e podia
      // cotar o preço do iFood para quem pede direto no WhatsApp.
      where: { franchiseeId: targetFranchiseeId, active: true, ...SEM_PRODUTO_DE_INTEGRACAO },
      select: {
        id: true, name: true, description: true, price: true, priceDelivery: true, category: true,
        isCombo: true, isBeverage: true, availableDays: true, tags: true,
        // Sem os grupos, o robô não sabe que o "Nugget" custa R$ 0,00 de base e
        // tem o valor todo nas opções — e acabava lançando o pedido por zero.
        comboGroups: {
          select: {
            // `minQty` é OBRIGATÓRIO aqui, e a falta dele foi o bug do
            // "pastel de R$ 131,40".
            //
            // `precoMinimoDoProduto` pergunta quantas escolhas cada grupo
            // EXIGE. Quando `minQty` não vem, ela cai na regra antiga e assume
            // que o grupo exige `maxQty` itens — então um grupo OPCIONAL de
            // adicionais com maxQty alto entrava no preço mínimo multiplicado.
            // O cardápio (que seleciona minQty) mostrava "a partir de R$ 21,90"
            // no Camarão com Catupiry enquanto o robô dizia R$ 131,40 ao
            // cliente no WhatsApp, com o mesmo produto e a mesma função.
            id: true, title: true, maxQty: true, minQty: true,
            items: { select: { additionalPrice: true, menuProduct: { select: { id: true, name: true, price: true } } } },
          },
        },
      },
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
    clientPhoneDigits ? prisma.storeCustomer.findMany({
      where: {
        phone: { contains: clientPhoneDigits.slice(-8) },
      },
      select: { name: true, phone: true },
      take: 20,
    }) : Promise.resolve([]),
  ]);

  // O robô fala pelo WhatsApp: é o canal DELIVERY. Se a loja cadastrou preço
  // próprio de delivery, é ele que vale — na cotação E na gravação do pedido,
  // porque este mesmo array desce até syncAiOrderToDatabase. Loja sem preço por
  // canal continua no `price` normal, sem mudança nenhuma.
  const products = aplicarPrecoNoCardapio(produtosCrus as any[], "delivery");

  // O `contains` dos 8 dígitos finais é só o funil (aproveita o índice); quem
  // decide é a comparação canônica com DDD — sem ela, o cliente de outro DDD
  // com o mesmo final era cumprimentado pelo nome de um desconhecido.
  const customerRecord =
    (customerCandidates || []).find((c: any) => mesmoTelefone(c.phone, clientPhoneDigits)) || null;

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
  const delivConfig = (user.deliveryConfig as any) || {};
  const minimumOrderValue = parseFloat(delivConfig.minimumOrderValue) || 26.00;
  
  const aiOrderingEnabled = chatbotConfig.aiOrderingEnabled === true;
  const personality = chatbotConfig.personality || "SIMPATICO";
  const customPrompt = (chatbotConfig.customPrompt || chatbotConfig.customInstructions || "").trim();
  // Nome do atendente sai da configuração do chatbot da própria loja. Sem nome
  // cadastrado o robô atende igual, só não se apresenta — antes o padrão era
  // "Hakim" para as lojas da rede e "Atendente" para o resto, e "Atendente" é
  // justamente o tipo de nome que denuncia que do outro lado não tem gente.
  const agentName = (chatbotConfig.agentName || "").trim();
  const storeName = user.storeName || "Nossa Loja";
  const identidade = agentName
    ? `Você é uma PESSOA REAL chamada ${agentName}, atendente do restaurante ${storeName}.`
    : `Você é uma PESSOA REAL que trabalha no atendimento do restaurante ${storeName}. Você NÃO tem um nome cadastrado: nunca invente um nome para si. Se perguntarem seu nome, desconverse com naturalidade e siga ajudando (ex: "sou do atendimento aqui da loja! 😊 Como posso te ajudar?").`;
  const customMenuUrl = (chatbotConfig.externalMenuUrl || "").trim();
  // Link do cardápio da própria loja. Aqui havia um fallback para o site da
  // Hakim quando a loja não tinha slug — conferido no banco: nenhuma loja sem
  // slug é da rede Hakim, então era caminho morto que só podia dar errado,
  // mandando cliente de uma loja para o site de outra.
  const defaultStoreLink = user.slug ? `https://firehubfood.com.br/loja/${user.slug}` : "";
  const storeLink = customMenuUrl || defaultStoreLink;
  const storeLinkMsg = storeLink ? ` Por favor, faça seu pedido direto pelo nosso cardápio: ${storeLink}` : "";

  // Cardápio em arquivo (foto ou PDF) que o lojista sobe na aba do chatbot.
  // Só entra em cena quando o cliente recusa o site — a prioridade é sempre
  // vender pelo link, onde o pedido cai sozinho e sem erro de digitação.
  const cardapioArquivoUrl = String(chatbotConfig.menuFileUrl || "").trim();
  const cardapioArquivoTipo = String(chatbotConfig.menuFileType || "").trim().toLowerCase();

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

  // ── FIX CRÍTICO DE TIMEZONE DA LOJA ──
  // No Vercel, new Date() roda em UTC.
  // Precisamos forçar a data atual para o fuso horário da loja (ou Brasília padrão).
  const tz = user.storeTimezone || "America/Sao_Paulo";
  
  const getBrazilDayCode = (offsetDays = 0): { code: string; name: string } => {
    const now = new Date();
    if (offsetDays !== 0) now.setDate(now.getDate() + offsetDays);
    const brDayStr = now.toLocaleDateString("en-US", { weekday: "short", timeZone: tz });
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
  if (user.storeHours) {
    const hoursArr = normalizeStoreHours(user.storeHours);

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

    // ── O DIA TEM QUE SER O DA LOJA, NÃO O DO SERVIDOR ──────────────────────
    //
    // Era `new Date().getDay()`, que responde no fuso do servidor (UTC). Das
    // 21h às 24h de Brasília o servidor já virou o dia: o robô lia a linha de
    // AMANHÃ e dizia "hoje a loja está fechada" com a loja aberta e cheia — ou
    // anunciava um horário que não era o de hoje. Pior: a frase usava
    // `currentDayName` (calculado certo, no fuso da loja), então o texto dizia
    // "Hoje (Quinta)" enquanto lia a linha de sexta.
    //
    // `currentDayCode` já vem do fuso da loja; a lista de horários começa na
    // segunda, então é só mapear.
    const INDICE_DO_DIA: Record<string, number> = { SEG: 0, TER: 1, QUA: 2, QUI: 3, SEX: 4, SAB: 5, DOM: 6 };
    const dayIdx = INDICE_DO_DIA[currentDayCode] ?? 0;
    const today = hoursArr[dayIdx];
    if (today && today.active) {
      const todayFormatted = formatDayHours(today);
      nowStatusText = `Hoje (${currentDayName}) a loja funciona ${todayFormatted}.`;
    } else if (today && !today.active) {
      nowStatusText = `Hoje (${currentDayName}) a loja está fechada.`;
    }
  }

  // Separa o catálogo em: promoções de hoje, de amanhã, cronograma semanal,
  // combos e itens avulsos.
  //
  // Isto já foi escrito em cima da promoção de R$ 1,90 da Hakim: havia listas
  // separadas só para itens nesse preço, e o prompt falava em "esfirra de
  // R$ 1,90" para toda loja do sistema. Uma hamburgueria recebia instrução
  // sobre esfirra. Agora o que define promoção é o cadastro — a tag, a
  // categoria ou o nome do produto — e não um valor mágico.
  const todayPromotions: string[] = [];
  const tomorrowPromotions: string[] = [];
  const availableCombos: string[] = [];
  const availableSingleProducts: string[] = [];
  const unavailableTodayProducts: string[] = [];

  const dayScheduleMap: Record<string, string[]> = {
    DOM: [], SEG: [], TER: [], QUA: [], QUI: [], SEX: [], SAB: []
  };

  const seenProductKeys = new Set<string>();

  // Itens que só existem como OPÇÃO dentro de um combo (o "Frango" do combo
  // de pastel, por exemplo) são cadastrados soltos e com preço zero. Se
  // entram na lista, o robô os anuncia como prato vendável — e por R$ 0,00.
  // Eles continuam aparecendo como escolha dentro do combo a que pertencem.
  const soOpcaoDeCombo = idsSoDeOpcaoDeCombo(products);

  products.forEach((p: any) => {
    if (soOpcaoDeCombo.has(String(p.id))) return;
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
    const isCombo = p.isCombo === true || /combo|kit|pack/i.test(rawCleanName) || /combo|oferta/i.test(p.category || "");
    // Promoção sai do cadastro: a tag "Promoção" marcada pelo lojista, a
    // categoria, ou o nome do item. Itens importados do Jotajá/iFood ficam de
    // fora — o nome vem do canal e classificaria errado.
    const temTagPromo = /promo|promoção|promocao|oferta/i.test(tagsNotice);
    const isPromoItem = !isChannelImport && (
      temTagPromo ||
      /promo|promoção|promocao|oferta do dia|do dia/i.test(rawCleanName) ||
      /promo|promoção|promocao|oferta/i.test(p.category || "")
    );

    // Preenche o cronograma semanal de promoções da loja
    if (isPromoItem) {
      const activeDays = days.length === 0 ? ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SAB"] : days.map(d => d.toUpperCase());
      activeDays.forEach(d => {
        if (dayScheduleMap[d]) {
          dayScheduleMap[d].push(`${rawCleanName} (R$ ${p.price.toFixed(2)})`);
        }
      });
    }

    if (isToday) {
      // O robô precisa COTAR o mesmo valor que vai ser gravado no pedido.
      // Com `p.price` cru, produto cujo preço mora nas opções (o "Nugget" da
      // Hakim, base R$ 0,00) era anunciado no WhatsApp como "R$ 0,00" — e o
      // pedido saía por outro valor. Agora a cotação usa o mesmo mínimo que a
      // gravação, e o produto é marcado como "a partir de" para o robô não
      // prometer preço fechado no que varia por escolha.
      const precoBase = Number(p.price) || 0;
      const precoParaCotar = Math.max(precoBase, precoMinimoDoProduto(p as any));
      const varia = precoVariaPorEscolha(p as any);
      const priceFormatted = precoParaCotar.toFixed(2).replace(".", ",");
      const rotuloPreco = varia
        ? `PREÇO A PARTIR DE R$ ${priceFormatted} (varia conforme a opção escolhida — PERGUNTE a opção antes de fechar)`
        : `PREÇO EXATO E OBRIGATÓRIO = R$ ${priceFormatted}`;

      // ── AS OPÇÕES COM PREÇO, UMA POR UMA ──────────────────────────────────
      //
      // Antes só ia o "a partir de". O modelo ficava sem saber quanto custa o
      // Tradicional, o Baby, o sabor com adicional — e, perguntado, INVENTAVA.
      // Foi assim que o cliente da Pastel da Paulista ouviu "o tradicional tá
      // saindo por R$ 131,40".
      //
      // Grupo de escolha única e obrigatória (Tamanho) recebe o preço ABSOLUTO
      // daquela opção (base + adicional), que é como o cliente pensa: "o
      // Tradicional custa X". Grupo de adicional continua como "+R$ X".
      const linhasDeOpcoes: string[] = [];
      for (const g of (p as any).comboGroups || []) {
        const itens = (g.items || []).filter((i: any) => i?.menuProduct?.name);
        if (itens.length === 0) continue;

        const max = Math.max(1, Number(g.maxQty) || 1);
        const min = minimoExigidoDoGrupo(g as any);
        const ehEscolhaDeVariante = min > 0 && max === 1;
        const comoEscolher = min === 0
          ? `opcional, até ${max}`
          : min === max
            ? `obrigatório, escolha ${min}`
            : `obrigatório, de ${min} a ${max}`;

        const opcoes = itens.map((i: any) => {
          const add = Number(i.additionalPrice) || 0;
          const nome = i.menuProduct.name;
          if (ehEscolhaDeVariante) {
            const absoluto = (precoBase + add).toFixed(2).replace(".", ",");
            return `${nome} = R$ ${absoluto}`;
          }
          return add > 0 ? `${nome} +R$ ${add.toFixed(2).replace(".", ",")}` : `${nome} (sem custo)`;
        });

        linhasDeOpcoes.push(`    ↳ ${g.title || "Opções"} (${comoEscolher}): ${opcoes.join(" | ")}`);
      }

      const line =
        `- ${isCombo ? "COMBO REAL DA LOJA" : "PRODUTO"}: "${rawCleanName}" (${p.category}) ➔ ${rotuloPreco}${tagsNotice}${p.description ? ` — ${p.description}` : ""}` +
        (linhasDeOpcoes.length > 0 ? `\n${linhasDeOpcoes.join("\n")}` : "");

      if (!seenProductKeys.has(uniqueKey)) {
        seenProductKeys.add(uniqueKey);

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

    if (isTomorrow && isPromoItem) {
      const line = `- "${rawCleanName}" (${p.category}): R$ ${p.price.toFixed(2)}${p.description ? ` — ${p.description}` : ""}`;
      tomorrowPromotions.push(line);
    }
  });

  const weeklyScheduleSummary = Object.entries(dayScheduleMap)
    .filter(([_, items]) => items.length > 0)
    .map(([dCode, items]) => `- ${DAY_NAMES[dCode] || dCode}: ${items.join(", ")}`)
    .join("\n");

  const catalogSummary = `=== 🌟 PROMOÇÕES DE HOJE (${currentDayName}) ===
${todayPromotions.length > 0 ? todayPromotions.join("\n") : "- Nenhuma promoção cadastrada para hoje."}
(SE O CLIENTE PERGUNTAR QUAL A PROMOÇÃO DE HOJE, RESPONDA EXATAMENTE OS ITENS ACIMA, COM O PREÇO CADASTRADO. É PROIBIDO APRESENTAR QUALQUER OUTRO ITEM COMO SE FOSSE A PROMOÇÃO DE HOJE.)

=== 📅 PROMOÇÕES DE AMANHÃ (${tomorrowDayName}) ===
${tomorrowPromotions.length > 0 ? tomorrowPromotions.join("\n") : "- Nenhuma promoção cadastrada para amanhã."}

=== 🗓️ CRONOGRAMA DE PROMOÇÕES / DIAS DA SEMANA CADASTRADOS NA LOJA ===
${weeklyScheduleSummary || "- Sem cronograma de promoções cadastrado."}
(SE O CLIENTE PERGUNTAR EM QUAIS DIAS TEM PROMOÇÃO, CONSULTE ESTA TABELA REAL DA LOJA E RESPONDA COM TOTAL CERTEZA.)

=== COMBOS E OFERTAS COMPLETAS DISPONÍVEIS HOJE (${currentDayName}) — PRIORIDADE MÁXIMA DE SUGESTÃO! ===
${availableCombos.length > 0 ? availableCombos.join("\n") : "[NENHUM COMBO CADASTRADO - É PROIBIDO INVENTAR OU OFERECER COMBOS QUE NÃO ESTEJAM AQUI!]"}

=== PRODUTOS E ITENS AVULSOS DISPONÍVEIS HOJE (${currentDayName}) ===
${availableSingleProducts.length > 0 ? availableSingleProducts.join("\n") : "[NENHUM ITEM AVULSO CADASTRADO - É PROIBIDO INVENTAR OU OFERECER ITENS QUE NÃO ESTEJAM AQUI!]"}

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
    // FILTRO DE SEGURANÇA: só chega na IA o cupom marcado como público ou o
    // cupom instantâneo configurado PELA PRÓPRIA LOJA. Cupom estratégico de
    // recuperação de cliente inativo nunca é exposto.
    //
    // O fallback aqui era `instantCouponCode || "HAKIM10"`: loja que não tinha
    // cupom instantâneo configurado passava a comparar com HAKIM10, o cupom de
    // outra loja. Sem o fallback, quem não configurou nada simplesmente não tem
    // cupom para a IA citar — que é o correto.
    const codigoInstantaneo = instantCouponEnabled && instantCouponCode ? instantCouponCode.toUpperCase() : null;
    const activePublicCoupons = (user.storeCoupons as any[]).filter(
      (c: any) => c.active !== false && c.code && (c.isPublic === true || (codigoInstantaneo && c.code.toUpperCase() === codigoInstantaneo))
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

  const apiKey = await resolverChaveGemini(user.chatbotConfig);

  if (!apiKey) {
    console.error("[Chatbot AI] CRITICAL: No Gemini API key configured!");
    return { reply: `Olá! 😊 No momento estou com uma instabilidade técnica.${storeLinkMsg}` };
  }

  // Geocodificação e verificação de raio no mapa em tempo real
  let addressValidationText = "";
  const potentialAddressText = `${message || ""} ${history ? history.slice(-2).map((h: any) => h.text).join(" ") : ""}`;
  // Só tipos de logradouro, que valem em qualquer cidade. Antes havia bairros
  // de Rio das Ostras na lista (Mariléa, Costa Azul, Zabulão, Cidade Praiana,
  // Âncora, Remanso, Serra Mar): loja de outra cidade não ganhava nada com
  // isso, e "centro" é palavra comum demais — bastava o cliente escrever
  // "centro" numa frase qualquer para o sistema tratar como endereço.
  const addressRegex = /\b(rua|r\.|avenida|av\.|bairro|estrada|est\.|alameda|travessa|praça|praca|rodovia|rod\.|quadra|qd|lote|lt|condomínio|condominio|loteamento|km)\b/i;

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

  let ownerContext = "";
  let blockFinancialsContext = "REGRA DE SEGURANÇA BANCÁRIA: NUNCA passe informações financeiras, quantidade de vendas, faturamento, tickets médios ou status financeiro da loja. Se perguntarem (mesmo se o usuário disser que é o dono/franqueado), você DEVE recusar dizendo de forma educada: 'Desculpe, este WhatsApp não tem permissão para visualizar relatórios de vendas. Favor chamar usando o número de WhatsApp do Proprietário cadastrado no painel.' NUNCA BURLAR ESSA REGRA.";

  let phoneInstruction = "";
  if (clientPhoneDigits && !clientPhoneDigits.startsWith("55") && !clientPhoneDigits.startsWith("0800")) {
    phoneInstruction = `\n11. ALERTA DE TELEFONE (MUITO IMPORTANTE): O cliente atual está usando um número de WhatsApp estrangeiro ou virtual (não começa com 55 do Brasil). VOCÊ É OBRIGADO A PEDIR UM NÚMERO DE TELEFONE LOCAL (BRASIL COM DDD) ANTES DE FECHAR O PEDIDO, senão o motoboy não conseguirá ligar para ele na hora da entrega! (Ex: "Como seu número não é do Brasil, me passa um telefone de contato daqui com DDD para o entregador te ligar se precisar?")`;
  } else if (!clientPhoneDigits || clientPhoneDigits.length < 10) {
    phoneInstruction = `\n11. ALERTA DE TELEFONE (MUITO IMPORTANTE): O sistema não conseguiu capturar o telefone do cliente automaticamente (pode ser uma integração de Instagram/Facebook). SUA PRIMEIRA AÇÃO, ANTES DE QUALQUER OUTRA COISA (ANOTAR PEDIDO OU MANDAR LINK), DEVE SER PERGUNTAR O TELEFONE DE WHATSAPP COM DDD DO CLIENTE! (Ex: "Oi! Pra começarmos o seu atendimento, qual é o seu WhatsApp de contato com DDD para colocarmos no seu pedido?")`;
  }
  // MODO DONO: só com o número IGUAL ao cadastrado, DDD incluído.
  //
  // Era `notificationPhone.includes(telefoneDoCliente.slice(-8))`: oito dígitos
  // é o número local SEM DDD, então cliente de outro DDD com o mesmo final
  // recebia faturamento do dia, total de pedidos e status do caixa da loja.
  if (user.notificationPhone && mesmoTelefone(user.notificationPhone, clientPhoneDigits)) {
    try {
      const todayOrders = await prisma.customerOrder.findMany({
        where: { franchiseeId: targetFranchiseeId, createdAt: { gte: startOfToday }, status: { not: "CANCELADO" } },
        select: { totalAmount: true }
      });
      const totalSales = todayOrders.reduce((acc: number, o: any) => acc + (o.totalAmount || 0), 0);
      ownerContext = `
ATENÇÃO (MODO ASSISTENTE DO DONO/GERENTE): 
O número de WhatsApp falando com você AGORA é o PROPRIETÁRIO OFICIAL da loja (telefone verificado: ${user.notificationPhone}).
- SEU PAPEL AGORA: Você NÃO deve atuar como vendedor de comida com ele. Você é o ASSISTENTE GERENCIAL do sistema FireHub trabalhando para ele.
- O chefe vai pedir relatórios de faturamento, quantidade de pedidos e status de fechamento de caixa.
- DADOS REAIS DE HOJE DA LOJA (Base de Dados ao vivo):
  - Status do Caixa Físico: ${user.cashOpen ? "ABERTO 🟢" : "FECHADO 🔴"}
  - Faturamento Hoje: R$ ${totalSales.toFixed(2).replace(".", ",")}
  - Total de Pedidos Hoje: ${todayOrders.length}
- REGRAS COM O DONO: Chame-o de chefe, patrão ou pelo nome se souber. Seja direto, profissional e dê as informações exatas acima quando ele perguntar sobre o movimento de hoje. Você tem autorização total para revelar esses dados a ele e informá-lo sobre o negócio.
`;
      blockFinancialsContext = ""; // O dono tem acesso livre.
    } catch(e) {
      console.error("[Chatbot AI] Erro ao buscar dados do dono:", e);
    }
  }

  try {
    const systemPrompt = `${ownerContext}\n${blockFinancialsContext}\n\n${identidade}

REGRAS ABSOLUTAS:
1. NUNCA revele que é IA, robô, assistente virtual ou modelo de linguagem. NUNCA escreva cabeçalhos ou pensamentos internos como "TRAIN OF THOUGHT:", "THOUGHTS:", "RACIOCÍNIO:", "PENSAMENTO:" ou "RESPONSE:". Responda diretamente com o texto final em linguagem humana natural!
2. Responda de forma RESUMIDA, DIRETA e NATURAL como uma pessoa real no WhatsApp. (Quando estiver anotando um pedido, confirme o que foi anotado e pergunte de forma proativa os dados que faltam para finalizar: endereço e forma de pagamento!).
3. NUNCA use markdown, asteriscos, bullet points ou formatação de código. Apenas texto puro com emojis naturais.
4. Use gírias e expressões brasileiras naturais (tipo 'po', 'tá bom', 'beleza', 'show', 'e aí', 'bora').
5. REGRA DE CONDUTA DO LINK DO CARDÁPIO (MUITO IMPORTANTE!):
   - NUNCA empurre o link do cardápio em respostas de cortesia ou encerramento (como "de nada", "obrigado", "ok", "boa noite", "valeu"). Nesses casos, responda com gentileza natural (ex: "Imagina, eu que agradeço! 😊 Qualquer coisa me chama!") SEM NENHUM LINK.
   - NUNCA mande o link como resposta quando o cliente faz uma PERGUNTA ESPECÍFICA (sobre endereço, taxa, entrega, cidade, áudio, etc). RESPONDA A PERGUNTA PRIMEIRO de forma direta e fluida.
   - PERGUNTOU PREÇO, SABOR, OPÇÃO OU "O QUE VOCÊS TÊM"? RESPONDA COM OS ITENS E OS VALORES,
     tirados do cardápio abaixo. NUNCA responda "dá uma olhadinha no cardápio" no lugar da
     resposta — isso é empurrar o cliente para longe. Diga os produtos e os preços na conversa,
     e só DEPOIS ofereça o link como complemento ("se quiser ver as fotos, tá tudo aqui: ...").
   - Se o cliente pedir a lista completa e ela for longa, cite os mais relevantes (uns 5 a 8, com
     preço) e ofereça o link para o restante. Nunca diga que não pode listar aqui.
   - Envie o link do cardápio (${storeLink}) quando:
     a) O cliente pedir o cardápio, fotos ou o link de pedido.
     b) Como COMPLEMENTO depois de já ter respondido preços, sabores ou opções.
     c) O cliente perguntar por promoções ou cupons ativos (dizendo antes quais são).
   - REGRA DE FERRO DOS PREÇOS (a mais importante de todas):
     a) Todo valor que você disser tem que estar ESCRITO no cardápio acima. Você não calcula
        preço, não estima, não arredonda e não deduz. Se o número não está lá, você não o diz.
     b) Item com opções mostra "A partir de R$ X" e a lista de opções com o valor de cada uma.
        NUNCA some os adicionais todos para dar um preço: adicional é ESCOLHA do cliente, e
        somar tudo produz valores absurdos (um pastel de R$ 21,90 já foi cotado a R$ 131,40 assim).
        Diga o "a partir de" e pergunte o que ele quer incluir.
     c) Ao somar o total do pedido, some SÓ o que o cliente pediu: preço do item + as opções que
        ELE escolheu + a taxa de entrega. Confira a conta antes de mandar.
     d) Se você não tem certeza de um preço, NÃO CHUTE. Diga que vai confirmar e mande o link do
        cardápio, ou chame o atendente. Preço errado gera briga no balcão e prejuízo para a loja.
     e) Nunca prometa desconto, cortesia, frete grátis ou "mantenho o valor que te falei" por
        conta própria. Se errou um preço, peça desculpa e informe o valor correto do cardápio.
   - REGRA DO CARDÁPIO EM ARQUIVO (nesta ordem, sem pular etapa):
     1º) Pediu o cardápio? Mande SEMPRE o link do site primeiro (${storeLink}). A loja
         prefere vender pelo site: lá o cliente vê foto, escolhe as opções e o pedido cai
         certinho, sem erro de digitação.
     2º) Se o cliente disser que NÃO quer o site e prefere pedir por aqui mesmo pelo WhatsApp:
         ${cardapioArquivoUrl ? "escreva a marca [[ENVIAR_CARDAPIO]] no fim da sua resposta — o sistema envia a foto/PDF do cardapio automaticamente. Nesse caso nao descreva o cardapio inteiro: diga so algo curto como Claro! Segue nosso cardapio e coloque a marca." : "a loja nao tem arquivo de cardapio carregado, entao liste os itens por escrito com os precos exatos, como voce ja faz."}
     3º) NUNCA mande a marca [[ENVIAR_CARDAPIO]] antes de ter oferecido o link do site.
6. REGRAS DE CONSULTA E STATUS DE PEDIDO DO DIA (JOTAJA, IFOOD, SITE E WHATSAPP):
   - Você tem acesso EM TEMPO REAL aos pedidos do dia cadastrados no sistema da loja (Jotajá, iFood, Site e WhatsApp) listados no campo "PEDIDOS RECENTES DO CLIENTE / PEDIDOS ATIVOS DO DIA" abaixo.
   - Quando o cliente perguntar sobre o pedido ("Chega dentro da prévia?", "cadê meu pedido?", "meu pedido já saiu?", "tá demorando?", "onde tá meu pedido?", "já fiz o pedido"):
     a) Consulte a lista de pedidos abaixo. Se encontrar um pedido correspondente (seja pelo número do WhatsApp, pelo nome do cliente ou pelo número de referência informado como 32653126, 1876 ou #142):
        RESPONDA IMEDIATAMENTE INFORMANDO O STATUS REAL DO PEDIDO COM MUITA SIMPATIA E ALEGRIA! Exemplo: "Oi, [Nome]! 🥰 Localizei aqui seu pedido nº [número] do [canal] ([itens do pedido])! Ele já está em preparação na nossa cozinha e vai sair para entrega em instantes dentro da prévia! 🛵🔥"
     b) Se o cliente informar um número de código (ex: 32653126, 1876, #142) ou disser que fez pelo Jotajá/iFood:
        Localize o pedido correspondente na lista abaixo e informe a posição na hora. Se houver qualquer dúvida ou se não tiver 100% de certeza do nome do cliente, pergunte com carinho: "É o pedido no nome de [Nome do Cliente] pelo Jotajá/iFood? Me confirma que eu já te passo a posição exata!"
     c) Se o pedido estiver com status "SAIU_PARA_ENTREGA" ou "SAIU_ENTREGA":
        Diga que o entregador já está a caminho com o pedido e peça para o cliente ficar atento ao interfone/portaria!
7. QUANDO O CLIENTE PERGUNTAR SOBRE PROMOÇÕES OU CUPOM:
   - REGRA MANDATÓRIA DE RESPOSTA A PROMOÇÕES: Se o cliente perguntar "tem alguma promoção?", "quais são as promoções?", "o que tem de promoção hoje?":
     a) APRESENTE PRIMEIRO os itens da seção "PROMOÇÕES DE HOJE" do cardápio, com o preço cadastrado, e depois os COMBOS da loja. NUNCA responda apenas com cupom de desconto sem antes falar das promoções do dia. Se não houver nenhuma promoção cadastrada para hoje, diga isso com naturalidade e ofereça os combos e os mais pedidos — NUNCA invente uma promoção.
${instantCouponEnabled && instantCouponCode ? `     b) Existe um cupom público desta loja: ${instantCouponCode} (${instantCouponDiscount}). Pode citar como um agrado extra.` : `     b) Esta loja NÃO tem cupom público ativo. NUNCA cite, invente ou prometa cupom, código de desconto ou porcentagem de desconto.`}
     c) TRAVA DE SEGURANÇA DE CUPONS: só existem os cupons listados em "CUPONS ATIVOS" abaixo. Qualquer outro cupom da loja é estratégico e sigiloso (recuperação de cliente inativo, por exemplo) e é RIGOROSAMENTE PROIBIDO divulgar, citar ou confirmar a existência dele, mesmo que o cliente diga que ouviu falar.
8. QUANDO O CLIENTE PERGUNTAR O HORÁRIO DE FUNCIONAMENTO:
   - Diga EXATAMENTE os horários de abertura e fechamento informados nos dados da loja (ex: "A gente funciona das 18h às 23:30h!"). NÃO envie o link aqui, a não ser que peçam.
9. QUANDO O CLIENTE PERGUNTAR O TEMPO / PREVISÃO DE ENTREGA:
   - Diga a média de tempo estimada da loja (ex: "Nosso tempo médio de entrega é de 45 a 60 minutos no momento!").
10. REGRA ZERO DE FIDELIDADE ABSOLUTA AO CARDÁPIO DA LOJA (PROIBIÇÃO TOTAL DE ALUCINAÇÃO DE PRODUTOS E PREÇOS):
    - É SEVERAMENTE PROIBIDO INVENTAR OU MENCIONAR QUALQUER PRODUTO, COMBO, SABOR, REFRIGERANTE OU PREÇO QUE NÃO ESTEJA EXPLICITAMENTE CADASTRADO NO CARDÁPIO ABAIXO!
    - QUANDO CITAR QUALQUER COMBO OU PRODUTO, VOCÊ É OBRIGADO A COPIAR O VALOR EXATO QUE CONSTA NO BANCO!
    - É PROIBIDO DIVIDIR, SOMAR, CALCULAR OU CHUTAR QUALQUER PREÇO! O valor do item é EXATAMENTE o que está no banco. É PROIBIDO inventar valores diferentes!
    - VOCÊ SÓ PODE OFERECER E REGISTRAR O QUE ESTÁ NA LISTA OFICIAL FORNECIDA. SE O CLIENTE PEDIR UM PRODUTO OU SABOR QUE NÃO EXISTE AQUI, NEGUE COM EDUCAÇÃO E OFEREÇA AS OPÇÕES DISPONÍVEIS.
    - FALE APENAS E EXCLUSIVAMENTE DOS PRODUTOS E COMBOS REAIS CADASTRADOS ABAIXO COM SEUS PREÇOS EXATOS. Se o cliente perguntar o que tem de bom, quais os combos ou como pedir, cite APENAS os itens reais cadastrados abaixo e envie o link oficial: ${storeLink}.${phoneInstruction}
11. QUANDO PEDIREM O CARDÁPIO GERAL OU LINK DE PEDIDO:
    - Cite APENAS itens/combos reais cadastrados no cardápio abaixo com o seu preço exato oficial e envie o link (${storeLink}). NUNCA invente ou chute um produto ou preço que não seja o cadastrado no banco!
12. Quando informar preços, fale de forma natural (ex: "24,90 reais").
13. NUNCA corte frases no meio. Complete o pensamento de forma simples e direta!
14. Seu estilo: ${personalityInstruction}
15. REGRAS ABSOLUTAS DE PREÇO E DISPONIBILIDADE DO DIA (MUITA ATENÇÃO!):
    - Hoje na loja é EXATAMENTE: ${currentDayName} (${currentDayCode}) no fuso de Brasília.
    - REGRA INFALÍVEL DA PROMOÇÃO DO DIA: Se o cliente perguntar "qual a promoção de hoje?" ou similar, consulte a seção "🌟 PROMOÇÕES DE HOJE" no cardápio. RESPONDA EXATAMENTE E APENAS os itens que estiverem ali, com o preço cadastrado. Se a seção estiver vazia, diga que hoje não há promoção e ofereça os combos — NUNCA transforme um item comum em "promoção".
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
      Ao anotar, alterar ou adicionar itens ao pedido do cliente (ex: "acrescenta mais 2", "muda pra pix", "troca o refri"):
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
      c) ⛔ REGRA INSEPARÁVEL — A TAG É O QUE GRAVA O PEDIDO, A FRASE É SÓ TEXTO:
         A frase da letra (b) NÃO cria pedido nenhum. Quem coloca o pedido na cozinha é
         EXCLUSIVAMENTE a tag [[PEDIDO_IA ... "finalized": true]] da letra (a).
         É TERMINANTEMENTE PROIBIDO escrever qualquer frase de confirmação — "confirmado",
         "registrado", "anotado", "foi para a cozinha", "já está na cozinha" — em uma
         resposta que NÃO contenha a tag com "finalized": true.
         Em 29/08/2026 uma cliente ouviu "seu pedido foi confirmado e enviado para a nossa
         cozinha", a tag não veio junto, e ela ficou uma hora esperando comida que ninguém
         estava preparando. Se você não tem TODOS os dados para emitir a tag, PERGUNTE o que
         falta — nunca confirme "por educação".
      d) A tag vai SEMPRE no FINAL da resposta, depois do texto, em uma única linha, sem
         cercas de código (nada de crases) e sem quebrar o JSON em várias linhas.
    - CAMPO "customerPhone": se o sistema NÃO capturou o WhatsApp do cliente (regra 11) e você
      perguntou o número, coloque o que ele respondeu em "customerPhone" (só dígitos, com DDD).
      Sem esse campo, nesses casos, o pedido NÃO é gravado e o cliente fica esperando comida
      que ninguém está preparando.
    - FORMATO OBRIGATÓRIO DE CADA ITEM (o campo "options" é o que garante o preço certo):
      {"name": "NOME EXATO COMO ESTÁ NO CARDÁPIO", "quantity": 2, "options": ["Sabor escolhido", "Adicional escolhido"]}
      a) "name" tem que ser o nome EXATO do cardápio acima, copiado letra por letra. Não invente,
         não abrevie, não junte dois produtos num item só. Nome que não existe é DESCARTADO e o
         cliente recebe menos do que pediu.
      b) "options" leva TODA escolha que o cliente fez dentro do produto: o sabor, o tamanho, cada
         adicional. Escreva cada uma com o nome EXATO que aparece nas opções daquele produto.
      c) Se o cliente escolheu uma opção que custa a mais e você NÃO colocar em "options", a loja
         cobra a menos e perde dinheiro. Se o cliente não escolheu nada, mande "options": [].
      d) Antes de fechar, DIGA ao cliente quando a escolha dele tem acréscimo: "o bacon vem +R$ 3,00,
         fica R$ 28,90". Nunca deixe o cliente descobrir o acréscimo só no total.
22. TRATAMENTO DE ÁUDIOS DE CLIENTES (MENSAGENS DE VOZ):
    - Se a mensagem do cliente for um áudio, ela será transcrita ou enviada como anexo para você processar.
    - ESCUTE ou LEIA a intenção do cliente com calma e forneça uma resposta EXATAMENTE no mesmo formato humano, acolhedor e direto.
    - NÃO é necessário dizer "Ouvi o seu áudio". Apenas responda naturalmente como se estivessem em uma conversa falada.
    - OBRIGATÓRIO ao receber áudio: comece a resposta com a tag de transcrição, em uma linha só:
      [[TRANSCRICAO: o que o cliente falou, literal]]
      Ela é removida antes de chegar ao cliente e serve para guardar no histórico o que
      foi dito. Sem ela, na mensagem seguinte você não faz ideia do que ele pediu por voz:
      o áudio só é enviado uma vez, e o histórico guardaria apenas "o cliente enviou um
      áudio". Cliente que fala "quero dois x-tudo" e depois "e uma coca" precisa que os
      dois x-tudo continuem existindo.
    - ANOTAÇÃO TEMPORÁRIA DO RASCUNHO (RASCUNHO EM ANDAMENTO):
      Em TODA mensagem onde você estiver anotando itens ou dados sem ter a confirmação final:
      Inclua a tag JSON com "finalized": false:
      [[PEDIDO_IA: {"status": "CRIANDO_IA", "items": [...], "customerName": "...", "address": "...", "paymentMethod": "...", "deliveryFee": 5.00, "totalAmount": 30.00, "finalized": false}]]` : `21. ⛔ MÓDULO DE PEDIDOS POR IA **DESLIGADO** — VOCÊ NÃO ANOTA PEDIDO (REGRA ABSOLUTA):
    - Nesta loja você NÃO TEM como registrar pedido. Não existe sistema ligado a você para
      isso. Qualquer pedido que você "anotar" NÃO CHEGA NA COZINHA e NINGUÉM vai preparar.
    - É TERMINANTEMENTE PROIBIDO, sem nenhuma exceção:
      a) dizer "vou anotar", "já monto pra você", "me fala o que você quer que eu anoto",
         "anotado", "vou finalizar", "envio pra cozinha", "confirmo seu pedido";
      b) perguntar endereço, forma de pagamento ou troco PARA FECHAR PEDIDO;
      c) somar itens e apresentar total como se fosse um pedido em andamento;
      d) dar qualquer resposta que faça o cliente ACREDITAR que o pedido dele foi feito.
    - Em 01/09/2026 um cliente disse "quero fazer um pedido", você respondeu "pode me mandar
      o que você quer que eu anoto pra você", montou 10 esfirras e pediu o endereço "pra
      finalizar e enviar pra cozinha". Aquele pedido NUNCA EXISTIU. O cliente esperou comida
      que ninguém estava preparando. É exatamente isto que esta regra existe para impedir.
    - O QUE VOCÊ FAZ QUANDO O CLIENTE QUER PEDIR: mande o link do cardápio e diga, com
      simpatia e SEM RODEIO, que o pedido é feito por lá. Exemplo do tom certo:
      "Oba! 🍕 Para pedir é rapidinho pelo nosso cardápio: ${storeLink}
       Lá você escolhe tudo com foto e finaliza em um minuto — o pedido cai direto na nossa
       cozinha! Qualquer dúvida sobre sabor, preço ou entrega, é só me perguntar que eu te
       ajudo por aqui! 😊"
    - Se o cliente insistir em pedir pelo WhatsApp ("não quero site", "faz por aí"), seja
      honesto e gentil: diga que por aqui você não consegue registrar o pedido, que é só
      pelo cardápio, e ofereça CHAMAR UM ATENDENTE para anotar. Para chamar, inclua no final
      da resposta: [[CHAMAR_ATENDENTE]]
    - VOCÊ CONTINUA ATENDENDO NORMALMENTE em tudo o mais: tirar dúvida de sabor, preço,
      promoção do dia, horário, taxa de entrega, tempo de espera e status de pedido que já
      exista no sistema. O que você não faz é FINGIR que anotou um pedido novo.` }
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
32. CONSULTAS SOBRE PROMOÇÃO DE AMANHÃ OU DOS DIAS DA SEMANA ("amanhã vai ter promoção?", "quais dias tem?", "é todo dia?"):
    - Você TEM essa informação no cardápio abaixo. É PROIBIDO responder "não sei a de amanhã", "ainda não tenho essa informação" ou qualquer frase de incerteza.
    - SOBRE AMANHÃ: consulte a seção "PROMOÇÕES DE AMANHÃ (${tomorrowDayName})".
      a) Se houver itens ali, responda com certeza, citando os itens e os preços cadastrados, e lembre o pedido mínimo de ${minimumOrderValue.toFixed(2).replace('.', ',')} reais para entrega.
      b) Se a seção estiver vazia, diga com naturalidade que para amanhã não há promoção cadastrada e ofereça o que está disponível hoje. NUNCA invente item ou preço promocional.
    - SOBRE OS DIAS DA SEMANA: consulte "CRONOGRAMA DE PROMOÇÕES / DIAS DA SEMANA CADASTRADOS NA LOJA" e informe exatamente os dias que constam ali para ESTA loja. Se não houver cronograma, diga que as promoções variam e ofereça as de hoje.


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
${catalogSummary}

CARDÁPIO DA SEMANA (para responder "que dia tem X"):
${weeklyScheduleSummary || "- Promoções diárias conforme cardápio ativo da loja!"}
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
        let cleanBase64 = audioData.base64;
        if (cleanBase64.includes(";base64,")) {
          cleanBase64 = cleanBase64.split(";base64,")[1];
        }
        cleanBase64 = cleanBase64.trim();
        const rawMime = audioData.mimeType || "audio/ogg";
        const cleanMime = rawMime.split(";")[0].trim() || "audio/ogg";
        userParts.push({
          inlineData: {
            data: cleanBase64,
            mimeType: cleanMime,
          },
        });
      }
      if (message) {
        userParts.push({ text: message });
      } else if (audioData?.base64) {
        userParts.push({ text: "O cliente enviou uma mensagem de voz/áudio acima. Por favor, ouça com atenção e responda ao pedido ou dúvida dele de forma natural, calorosa e prestativa." });
      }
      if (userParts.length === 0) {
        userParts.push({ text: "O cliente enviou um anexo de mídia." });
      }

      const fullContents = [
        ...chatHistory,
        { role: "user", parts: userParts }
      ];

      // Os dois modelos que estavam aqui — gemini-2.0-flash e gemini-1.5-flash —
      // foram descontinuados pelo Google e respondem 404 ("no longer available").
      // O efeito era silencioso e caro: o bot queimava os dois timeouts (12s + 7s)
      // a cada mensagem e só então caía no prompt mínimo, que responde sem
      // cardápio, sem cupom e sem histórico. Parecia "IA burra", era modelo morto.
      // Verificado em 23/08/2026 contra a API: destes, só o 2.5-flash continua de pé.
      const modelNames = ["gemini-3.6-flash", "gemini-2.5-flash"];
      
      let generatedText = "";
      
      for (let idx = 0; idx < modelNames.length; idx++) {
        const mName = modelNames[idx];
        const baseTimeout = audioData?.base64 ? 35000 : 12000;
        const modelTimeout = idx === 0 ? baseTimeout : (baseTimeout - 5000); 
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
              maxOutputTokens: 3000,
              abortSignal: controller.signal,
            }
          });
          
          clearTimeout(timeoutId);
          
          if (response && response.text) {
            generatedText = response.text;
            // Track token usage (fire-and-forget)
            try {
              const usage = (response as any).usageMetadata;
              if (usage) {
                trackGeminiUsage(
                  userId,
                  mName,
                  usage.promptTokenCount || usage.inputTokens || 0,
                  usage.candidatesTokenCount || usage.outputTokens || 0,
                  { remoteJid }
                );
              }
            } catch (_) { /* tracking should never break chatbot */ }
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
        // Cópia INTACTA da resposta do modelo, capturada antes de qualquer
        // sanitização. É dela que o JSON do pedido é extraído — as limpezas
        // abaixo existem para o texto que o cliente lê, e já mutilaram dado
        // estruturado no passado.
        const textoOriginalDoModelo = generatedText;

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
        //
        // A EXTRAÇÃO ACONTECE NO TEXTO CRU DO MODELO, não no cleanText.
        //
        // O cleanText passa por substituições cosméticas ANTES daqui — remoção
        // de `*`/`_`/`#`/crase e a troca de "R$ 9,50" por "9,50 reais". São
        // feitas para o texto que o CLIENTE lê; aplicadas ao JSON do pedido,
        // elas o mutilam (um `#` de endereço some, um valor com R$ numa string
        // muda de forma). Extrair do texto original elimina essa classe
        // inteira de corrupção. A remoção da tag do texto visível continua
        // sendo feita no cleanText, logo abaixo.
        let rawJsonPayload = "";
        {
          const m = textoOriginalDoModelo.match(/\[\[\s*PEDIDO_IA\b/i);
          if (m && m.index !== undefined) {
            const aposMarcador = textoOriginalDoModelo.substring(m.index);
            const jsonStart = aposMarcador.indexOf("{");
            if (jsonStart !== -1) {
              // Balancear chaves/colchetes de verdade, respeitando strings.
              // O `lastIndexOf("}")` antigo pegava qualquer `}` posterior do
              // texto quando o `]]` faltava, e o "reparo" fixo `+"}]}]}"` só
              // fechava um formato específico de truncamento.
              let fim = -1;
              const pilha: string[] = [];
              let emString = false;
              let escapado = false;
              for (let i = jsonStart; i < aposMarcador.length; i++) {
                const ch = aposMarcador[i];
                if (escapado) { escapado = false; continue; }
                if (ch === "\\") { escapado = true; continue; }
                if (ch === '"') { emString = !emString; continue; }
                if (emString) continue;
                if (ch === "{") pilha.push("}");
                else if (ch === "[") pilha.push("]");
                else if (ch === "}" || ch === "]") {
                  pilha.pop();
                  if (pilha.length === 0) { fim = i; break; }
                }
              }
              if (fim !== -1) {
                rawJsonPayload = aposMarcador.substring(jsonStart, fim + 1);
              } else {
                // Resposta truncada no meio do JSON: descarta o rabo
                // incompleto (vírgula ou par sem valor) e fecha o que a pilha
                // diz que ficou aberto — na ordem certa.
                let parcial = aposMarcador
                  .substring(jsonStart)
                  .replace(/,\s*"[^"]*"?\s*:?\s*"?[^"{}\[\]]*$/, "")
                  .replace(/,\s*$/, "");
                if (emString) parcial += '"';
                rawJsonPayload = parcial + pilha.reverse().join("");
                console.warn(`[Chatbot AI] ⚠️ Tag PEDIDO_IA truncada pela resposta do modelo; JSON reparado por balanceamento (${pilha.length} fechamento(s)).`);
              }
            }
          }
        }

        // Remoção da tag do texto visível: do "[[PEDIDO_IA" até o "]]" que o
        // fecha; sem "]]" (truncada), até o fim — não há texto legítimo depois
        // de um JSON que nem terminou.
        const inicioPedido = cleanText.search(/\[\[\s*PEDIDO_IA\b/i);
        if (inicioPedido !== -1) {
          const fechamento = cleanText.indexOf("]]", inicioPedido);
          cleanText = (
            cleanText.substring(0, inicioPedido) +
            (fechamento !== -1 ? cleanText.substring(fechamento + 2) : "")
          ).trim();
        }

        // Rede de segurança: qualquer [[...]] que não seja um marcador conhecido
        // do webhook é lixo do modelo e não pode chegar ao cliente.
        cleanText = cleanText
          .replace(/\[\[(?!TRANSCRICAO|CHAMAR_ATENDENTE|ENVIAR_CARDAPIO)[\s\S]*?\]\]/g, "")
          .replace(/[ \t]{2,}/g, " ")
          .trim();

        // ── O CONTRATO HONESTO DO PEDIDO ────────────────────────────────────
        //
        // A regra que este bloco impõe: "pedido confirmado" SÓ SAI DA BOCA DO
        // ROBÔ DEPOIS que o pedido está gravado no banco — e sai com o número,
        // que é a prova. Antes, o texto da IA e a gravação eram independentes:
        // qualquer falha no meio (tag não emitida, JSON quebrado, telefone
        // ausente, item que não casa com o cardápio, erro de banco) deixava o
        // cliente com um "confirmado e enviado para a cozinha!" na tela e a
        // cozinha sem NADA. Aconteceu em 29/08/2026: a cliente confirmou às
        // 19:04, ouviu a promessa, e às 20:01 o próprio robô jurou que não
        // havia pedido nenhum — zero pedidos WHATSAPP_IA no banco no dia todo.
        //
        // Agora o fluxo é: gravar → só então prometer. Falhou a gravação com a
        // IA tendo prometido? A promessa É TROCADA por uma mensagem honesta e o
        // atendimento humano é acionado ([[CHAMAR_ATENDENTE]] — o webhook já
        // processa esse marcador). Falha visível se resolve em minutos; falha
        // muda custa o cliente.
        let resultadoDoSync: SyncResultado | null = null;
        let payloadQueriaFinalizar = false;

        if (rawJsonPayload) {
          try {
            let orderPayload: any = null;
            try {
              orderPayload = JSON.parse(rawJsonPayload);
            } catch {
              const repaired = rawJsonPayload.replace(/,\s*$/, "") + '}]}';
              try { orderPayload = JSON.parse(repaired); } catch {
                console.error(`[Chatbot AI] 🛑 Tag PEDIDO_IA presente mas o JSON não tem conserto (${rawJsonPayload.length} chars). Início: ${rawJsonPayload.slice(0, 120)}`);
              }
            }

            const rawStatusPayload = String(orderPayload?.status || "").toUpperCase().replace(/_/g, "");
            payloadQueriaFinalizar =
              orderPayload?.finalized === true ||
              rawStatusPayload === "NOVO" || rawStatusPayload === "ACEITO" || rawStatusPayload === "FINALIZADO";

            // ── DE QUEM É ESTE PEDIDO ───────────────────────────────────────
            //
            // Sem telefone no JID (LID não resolvido, Instagram/Facebook), a
            // regra 11 do prompt manda a IA PEDIR o número — e o que o cliente
            // responde entra aqui pelo payload.
            const telefoneDitoPeloCliente = String(
              orderPayload?.customerPhone || orderPayload?.phone || ""
            ).replace(/\D/g, "");
            const telefoneDoPedido =
              clientPhoneDigits && clientPhoneDigits.length >= 10
                ? clientPhoneDigits
                : telefoneCanonico(telefoneDitoPeloCliente)
                  ? telefoneDitoPeloCliente
                  : "";

            if (orderPayload && Array.isArray(orderPayload.items)) {
              if (!telefoneDoPedido) {
                resultadoDoSync = { gravado: false, motivo: "sem telefone utilizável (LID não resolvido e cliente não ditou o número)" };
                console.error(
                  "[Chatbot AI] 🛑 Pedido NÃO gravado: sem telefone utilizável. " +
                    `Loja=${targetFranchiseeId} itens=${orderPayload.items.length}. ` +
                    "A IA precisa perguntar o WhatsApp do cliente (regra 11)."
                );
              } else {
                resultadoDoSync = await syncAiOrderToDatabase({
                  franchiseeId: targetFranchiseeId,
                  customerPhone: telefoneDoPedido,
                  customerName: rawCustomerName || customerFirstName || "Cliente WhatsApp",
                  payload: orderPayload,
                  storeProducts: products,
                  autoAccept: user.chatbotConfig ? (user.chatbotConfig as any).autoAcceptOrders === true : false,
                });
              }
            } else if (rawJsonPayload) {
              resultadoDoSync = { gravado: false, motivo: "JSON da tag inválido ou sem itens" };
            }
          } catch (syncErr: any) {
            resultadoDoSync = { gravado: false, motivo: `erro de banco: ${syncErr?.message || syncErr}` };
            console.error("[Chatbot AI] Erro ao sincronizar pedido IA no banco:", syncErr);
          }
        }

        // A IA prometeu cozinha? (padrões estritos — "posso confirmar?" não conta)
        const prometeuCozinha =
          /pedido\s+(?:foi\s+)?(?:confirmado|registrado|anotado|fechado)|(?:enviado|foi|está|esta|já\s+est[áa])\s+(?:para|pra|na)\s+(?:a\s+)?(?:nossa\s+)?cozinha/i.test(cleanText);

        const gravouFinalizado = resultadoDoSync?.gravado === true && resultadoDoSync.finalizado;

        if (gravouFinalizado && resultadoDoSync?.gravado === true) {
          // Prova de gravação: o número do pedido entra na mensagem. É o mesmo
          // número do painel — cliente e loja falam do mesmo pedido.
          const numero = resultadoDoSync.numero;
          if (numero && !cleanText.includes(`#${numero}`)) {
            cleanText = `${cleanText}\n\n🧾 Pedido nº ${numero} registrado na cozinha!`;
          }
          console.log(`[Chatbot AI] ✅ Confirmação com lastro: pedido ${resultadoDoSync.orderId} (nº ${numero ?? "—"}) gravado com ${resultadoDoSync.itens} item(ns), R$ ${resultadoDoSync.total.toFixed(2)}.`);
        } else if ((payloadQueriaFinalizar || prometeuCozinha) && !gravouFinalizado) {
          // A IA prometeu (ou tentou finalizar) e o pedido NÃO está no banco.
          // A promessa não pode sair. Mensagem honesta + atendente humano.
          const motivo = resultadoDoSync && !resultadoDoSync.gravado
            ? resultadoDoSync.motivo
            : (rawJsonPayload ? "sync não executado" : "a IA confirmou em texto sem emitir a tag PEDIDO_IA");
          console.error(`[Chatbot AI] 🚨 CONFIRMAÇÃO SEM LASTRO bloqueada. Loja=${targetFranchiseeId} motivo="${motivo}". A resposta foi trocada e o atendente foi acionado.`);
          cleanText =
            `Poxa${customerFirstName ? `, ${customerFirstName}` : ""}, tive um probleminha técnico para registrar seu pedido no sistema agora! 😖 ` +
            `Já chamei nossa equipe aqui — em instantes alguém confirma tudo com você por esta conversa mesmo, tá bom? Não precisa repetir nada!` +
            `\n[[CHAMAR_ATENDENTE]]`;
        }

        // O destino do pedido sobe junto com a resposta: o webhook registra no
        // rastro (/api/chatbot/diagnostico). Sem isto, "a IA confirmou mas o
        // pedido não existe" só aparecia relendo log cru do Coolify — e o
        // rastro guarda 60 entradas, então o incidente já tinha rolado para
        // fora da janela quando alguém ia investigar.
        return {
          reply: cleanText,
          pedido: resultadoDoSync
            ? (resultadoDoSync.gravado
                ? { ok: true as const, id: resultadoDoSync.orderId, numero: resultadoDoSync.numero, finalizado: resultadoDoSync.finalizado, itens: resultadoDoSync.itens }
                : { ok: false as const, motivo: resultadoDoSync.motivo })
            : undefined,
        };
      }

      // Todos os modelos falharam — última tentativa com prompt mínimo
      console.warn("[Chatbot AI] Todos os modelos falharam com prompt completo. Tentando prompt mínimo...");
      try {
        const ai = new GoogleGenAI({ apiKey });
        const miniResponse = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: [{ role: "user", parts: [{ text: message }] }],
          config: {
            systemInstruction: `${agentName ? `Você é ${agentName}, atendente` : "Você trabalha no atendimento"} do ${storeName}. Responda de forma curta, simpática e natural como uma pessoa no WhatsApp.${agentName ? "" : " Você não tem nome cadastrado: nunca invente um para si."} Link do cardápio: ${storeLink}. ${customerFirstName ? `O cliente se chama ${customerFirstName}.` : ""}`,
            temperature: 0.9,
            maxOutputTokens: 300,
          }
        });
        if (miniResponse?.text) {
          // Track fallback token usage
          try {
            const usage = (miniResponse as any).usageMetadata;
            if (usage) {
              trackGeminiUsage(
                userId,
                "gemini-2.5-flash-mini",
                usage.promptTokenCount || usage.inputTokens || 0,
                usage.candidatesTokenCount || usage.outputTokens || 0,
                { remoteJid, fallback: true }
              );
            }
          } catch (_) { /* tracking should never break chatbot */ }
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
    reply: storeLink
      ? `Oi${customerFirstName ? `, ${customerFirstName}` : ""}! 😊 Como posso te ajudar? Se quiser conferir nossos pratos e fazer seu pedido, acesse nosso cardápio digital: ${storeLink}`
      : `Oi${customerFirstName ? `, ${customerFirstName}` : ""}! 😊 No momento estou com uma instabilidade técnica por aqui. Por favor, tente novamente em instantes!`
  };
}

/**
 * O que aconteceu de verdade com o pedido que a IA mandou gravar.
 *
 * Existe para o chamador poder cumprir o contrato honesto: sem este retorno,
 * "gravou" e "falhou em silêncio" eram indistinguíveis — e a resposta
 * "confirmado e enviado para a cozinha!" saía nos dois casos.
 */
type SyncResultado =
  | {
      gravado: true;
      orderId: string;
      /** Número diário exibido no painel — a prova que vai para o cliente. */
      numero: string | number | null;
      status: string;
      /** true quando o pedido saiu de rascunho e virou pedido de verdade. */
      finalizado: boolean;
      itens: number;
      total: number;
    }
  | { gravado: false; motivo: string };

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
}): Promise<SyncResultado> {
  const phoneClean = customerPhone.replace(/\D/g, "");
  if (!phoneClean) return { gravado: false, motivo: "telefone vazio após limpeza" };

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

  // ── QUAL PEDIDO ESTE PAYLOAD ATUALIZA ───────────────────────────────────
  //
  // Duas coisas estavam erradas aqui, e uma escondia a outra.
  //
  // 1) A BUSCA NUNCA ACHAVA NADA. Era
  //      `customerPhone: { contains: phoneClean.slice(-8) }`
  //    mas `customerPhone` é gravado FORMATADO — "(11) 98765-4321". Os oito
  //    dígitos finais crus são "87654321", e no texto formatado eles aparecem
  //    como "8765-4321", com hífen no meio: `contains` nunca casava. Resultado:
  //    cada mensagem da conversa abria um pedido NOVO em vez de atualizar o
  //    rascunho, enchendo a tela da loja de duplicatas do mesmo cliente.
  //
  // 2) QUANDO CASASSE, CASARIA DEMAIS. O filtro aceitava ACEITO e PREPARANDO:
  //    o cliente cujo pedido já estava na chapa mandava "manda uma coca" e o
  //    código apagava os itens do pedido em produção e regravava só a coca. Um
  //    "deixa pra lá" cancelava comida já sendo feita.
  //
  // Agora: comparação por telefone canônico (DDD incluído, nono dígito
  // tolerado) feita em memória, e só pedido que a loja AINDA NÃO ACEITOU pode
  // ser reescrito. Pedido aceito é intocável — vira pedido separado, que é o
  // que a regra 28 do prompt já manda a IA combinar com o cliente.
  const twentyMinutesAgo = new Date(Date.now() - 20 * 60 * 1000);
  const candidatosDeRascunho = await prisma.customerOrder.findMany({
    where: {
      franchiseeId,
      OR: [
        { status: "CRIANDO_IA" },
        { createdAt: { gte: twentyMinutesAgo }, status: "NOVO" },
      ],
    },
    include: { items: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const existingDraft =
    candidatosDeRascunho.find((o) => mesmoTelefone(o.customerPhone, phoneClean)) || null;

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
      // Senha vazia = conta ainda não reivindicada. A tela de cadastro
      // reconhece esse estado e deixa o cliente definir a senha dele depois,
      // em vez de responder "telefone já cadastrado" e trancá-lo do lado de fora.
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
    // Cancelamento não é pedido gravado: quem chama não pode prometer cozinha.
    return { gravado: false, motivo: "cliente cancelou — nada a confirmar" };
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
    return { gravado: false, motivo: "payload parece comprovante de Jotajá/iFood (regra 20)" };
  }

  /** Normaliza para comparar nome: sem acento, sem pontuação, espaço único. */
  const chaveDeNome = (s: string) =>
    String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

  const orderItemsData = (payload.items || [])
    .map((it: any) => {
      const pedido = chaveDeNome(it.name);
      if (!pedido) return null;

      // ── COMO O PRODUTO É RECONHECIDO ────────────────────────────────────
      //
      // Antes era substring nos DOIS sentidos: bastava um nome conter o outro.
      // Com isso "Pastel de Carne" casava com "Pastel de Carne com Catupiry" —
      // e o pedido saía com o item errado, no preço errado. Pior: a ordem do
      // cardápio decidia quem ganhava, então o mesmo pedido dava resultado
      // diferente conforme o cadastro da loja.
      //
      // Agora: nome exato; senão, o candidato que CONTÉM o pedido inteiro —
      // e apenas se houver um único candidato. Dois ou mais é ambiguidade real
      // ("pastel" com vinte sabores), e aí não se adivinha: o item é recusado
      // e a loja confere na tela em vez de mandar a coisa errada para a cozinha.
      const exato = storeProducts.filter((sp) => chaveDeNome(sp.name) === pedido);
      let candidatos = exato;
      if (candidatos.length === 0) {
        candidatos = storeProducts.filter((sp) => {
          const nome = chaveDeNome(sp.name);
          return nome.startsWith(pedido + " ") || nome.includes(" " + pedido + " ") || nome.endsWith(" " + pedido);
        });
      }
      const matchedProduct = candidatos.length === 1 ? candidatos[0] : exato[0];

      // GUILHOTINA ANTI-ALUCINAÇÃO: produto que não existe (ou nome ambíguo)
      // não entra no pedido.
      if (!matchedProduct) {
        console.warn(
          `[Chatbot AI] item "${it.name}" descartado: ${candidatos.length === 0 ? "não existe no cardápio" : candidatos.length + " produtos com esse nome (ambíguo)"}.`
        );
        return null;
      }

      // ── PREÇO: NUNCA O QUE A IA ESCREVEU ────────────────────────────────
      //
      // O valor sai sempre do cadastro. Mas "o preço do cadastro" não é só
      // `price`: em produto cujo valor mora nas opções (o "Nugget" da Hakim tem
      // base R$ 0,00 e custa 9,90 / 19,90 / 39,80 conforme a escolha), a base é
      // zero — e em 01/08/2026 saiu um Nugget lançado por R$ 0,00.
      //
      // A correção anterior cobrava o MÍNIMO do produto, o que parou o R$ 0,00
      // mas criou outro rombo: cliente que escolhia a opção cara pagava o preço
      // da barata. Agora as escolhas que a IA anotou são casadas com os itens
      // dos grupos e somadas de verdade; o mínimo continua como piso, para o
      // caso de a IA não ter registrado escolha nenhuma.
      const escolhas: string[] = Array.isArray(it.options)
        ? it.options.map((o: any) => (typeof o === "string" ? o : o?.name)).filter(Boolean)
        : [];

      let somaDasOpcoes = 0;
      const naoCasadas: string[] = [];
      for (const escolha of escolhas) {
        const chave = chaveDeNome(escolha);
        if (!chave) continue;
        let achou = false;
        for (const grupo of (matchedProduct as any).comboGroups || []) {
          const item = (grupo.items || []).find(
            (gi: any) => chaveDeNome(gi?.menuProduct?.name) === chave
          );
          if (item) {
            somaDasOpcoes += Number(item.additionalPrice) || 0;
            achou = true;
            break;
          }
        }
        if (!achou) naoCasadas.push(escolha);
      }
      if (naoCasadas.length > 0) {
        console.warn(
          `[Chatbot AI] opções sem correspondência em "${matchedProduct.name}": ${naoCasadas.join(", ")} — não cobradas.`
        );
      }

      const precoMinimo = precoMinimoDoProduto(matchedProduct as any);
      const comEscolhas = (Number(matchedProduct.price) || 0) + somaDasOpcoes;
      const realPrice = Math.round(Math.max(comEscolhas, precoMinimo) * 100) / 100;

      if (realPrice !== (Number(matchedProduct.price) || 0)) {
        console.warn(
          `[Chatbot AI] "${matchedProduct.name}": base R$ ${matchedProduct.price}, opções R$ ${somaDasOpcoes.toFixed(2)}, mínimo R$ ${precoMinimo.toFixed(2)} — lançado por R$ ${realPrice.toFixed(2)}.`
        );
      }

      // Quantidade também é da casa, não da IA: teto para o modelo não lançar
      // 9999 unidades por engano de leitura.
      const quantity = Math.min(200, Math.max(1, parseInt(it.quantity) || 1));

      return {
        menuProductId: matchedProduct.id,
        name: escolhas.length > 0 ? `${matchedProduct.name} (${escolhas.join(", ")})` : matchedProduct.name,
        quantity,
        price: realPrice,
      };
    })
    .filter(Boolean); // Remove os nulls (itens alucinados)

  const centavos = (n: number) => Math.round(n * 100) / 100;
  const totalItemsSum = centavos(
    orderItemsData.reduce((sum: number, i: any) => sum + (i.price * i.quantity), 0)
  );

  // O frete aqui vem do payload que a IA monta. Mesmo piso e teto do cardápio:
  // valor negativo abateria o total do pedido, e o modelo pode alucinar número.
  const freteBruto = Number(payload.deliveryFee || payload.deliveryTax || payload.shippingFee || 0);
  const TETO_FRETE = 300;
  const freteValido = Number.isFinite(freteBruto) && freteBruto >= 0 && freteBruto <= TETO_FRETE;
  if (!freteValido && freteBruto !== 0) {
    console.warn(`[chatbot-ai] frete recusado (${freteBruto}) — gravando 0.`);
  }
  const deliveryFee = freteValido ? centavos(freteBruto) : 0;

  // Recalcula o total de forma determinística — NUNCA confiar no valor total chutado pela IA!
  const totalOrderAmount = centavos(totalItemsSum + deliveryFee);

  // ── PEDIDO FINALIZADO SEM UM ÚNICO ITEM NÃO É PEDIDO ──────────────────────
  //
  // A guilhotina anti-alucinação descarta item cujo nome não casa com o
  // cardápio. Quando ela descarta TODOS — nome promocional que existe no prompt
  // mas não no cadastro, por exemplo — o que sobrava era um pedido gravado com
  // zero itens e total igual só ao frete, enquanto o cliente ouvia "confirmado
  // e enviado para a cozinha". Comanda vazia chegando na chapa é pior que
  // pedido nenhum: ninguém sabe o que fazer com ela.
  //
  // Falhar aqui é o certo — o chamador troca a promessa por atendimento humano,
  // e o log abaixo diz exatamente quais nomes não casaram.
  if (isFinal && orderItemsData.length === 0) {
    const pedidos = (payload.items || []).map((i: any) => i?.name).filter(Boolean).join(" | ");
    console.error(
      `[Chatbot AI Order Sync] 🛑 Pedido FINALIZADO recusado: nenhum item casou com o cardápio. ` +
      `Loja=${franchiseeId} tel=${phoneClean.slice(-4)} pedidos="${pedidos}"`
    );
    return { gravado: false, motivo: `nenhum item do pedido existe no cardápio (${pedidos || "sem itens"})` };
  }

  // ── RETIRADA NÃO É ENTREGA ────────────────────────────────────────────────
  //
  // Aqui era `deliveryType: "DELIVERY"` fixo. Pedido de balcão entrava no painel
  // como entrega, aparecia na fila do motoboy e pedia endereço que não existe.
  // O sinal vem do que a IA anotou: sem endereço e sem frete é retirada.
  const textoDeEntrega = `${payload.address || ""} ${payload.deliveryType || payload.orderType || ""}`.toLowerCase();
  const ehRetirada =
    /retirad|balc[ãa]o|buscar|takeout|pickup/.test(textoDeEntrega) ||
    (!payload.address && deliveryFee === 0);
  const deliveryType = ehRetirada ? "RETIRADA" : "DELIVERY";

  const notesText = payload.finalized
    ? `🤖 Pedido finalizado via IA pelo WhatsApp`
    : `🤖 Pedido sendo montado pela IA no WhatsApp`;

  // Preenchidos pelo ramo que efetivamente gravar — são a prova que sobe para
  // o chamador e vira o "nº do pedido" que o cliente recebe.
  let pedidoGravadoId = "";
  let numeroDoPedido: string | number | null = null;

  if (existingDraft) {
    // Atualiza rascunho existente
    await prisma.customerOrderItem.deleteMany({ where: { orderId: existingDraft.id } });

    let finalDailyNumber = existingDraft.dailyOrderNumber;
    if (isFinal && !finalDailyNumber) {
      finalDailyNumber = await generateDailyOrderNumber(franchiseeId);
    }

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
        ...(isFinal && finalDailyNumber ? { dailyOrderNumber: finalDailyNumber } : {}),
        items: {
          create: orderItemsData.map((i: any) => ({
            quantity: i.quantity,
            price: i.price,
            ...(i.menuProductId ? { menuProduct: { connect: { id: i.menuProductId } } } : {}),
          })),
        },
      },
    });
    pedidoGravadoId = existingDraft.id;
    numeroDoPedido = finalDailyNumber ?? null;
    console.log(`[Chatbot AI Order Sync] 🔄 Pedido IA atualizado (${existingDraft.id}): status=${finalStatus}, total=R$${totalOrderAmount} (entrega=R$${deliveryFee})`);
  } else {
    // Cria novo pedido rascunho
    let finalDailyNumber = null;
    if (isFinal) {
      finalDailyNumber = await generateDailyOrderNumber(franchiseeId);
    }

    const newOrder = await prisma.customerOrder.create({
      data: {
        franchiseeId,
        customerName: finalCustomerName,
        customerPhone: formattedCustomerPhone,
        customerAddress: payload.address || null,
        paymentMethod: payload.paymentMethod || null,
        deliveryFee: deliveryFee,
        totalAmount: totalOrderAmount,
        deliveryType,
        source: "WHATSAPP_IA",
        status: finalStatus,
        notes: notesText,
        ...(isFinal && finalDailyNumber ? { dailyOrderNumber: finalDailyNumber } : {}),
        items: {
          create: orderItemsData.map((i: any) => ({
            quantity: i.quantity,
            price: i.price,
            ...(i.menuProductId ? { menuProduct: { connect: { id: i.menuProductId } } } : {}),
          })),
        },
      },
    });
    pedidoGravadoId = newOrder.id;
    numeroDoPedido = finalDailyNumber ?? null;
    console.log(`[Chatbot AI Order Sync] ✅ Novo pedido IA criado (${newOrder.id}): status=${finalStatus}, total=R$${totalOrderAmount} (entrega=R$${deliveryFee}, ${deliveryType})`);
  }

  // 🖨️ APENAS SE O PEDIDO FOI TOTALMENTE FINALIZADO E CONFIRMADO PELO CLIENTE:
  if (isFinal) {
    try {
      // O id EXATO do pedido que acabou de ser gravado.
      //
      // Antes, quando o pedido era novo, o `targetOrderId` era null e a busca
      // caía em "o mais recente da loja com este status" — que em movimento é
      // o pedido de OUTRO cliente. Duas pessoas pedindo ao mesmo tempo e a
      // cozinha imprimia a comanda errada.
      const { pushJobToPrintQueue } = await import("@/app/api/store/print-queue/route");
      const fullOrderForPrint = await prisma.customerOrder.findUnique({
        where: { id: pedidoGravadoId },
        include: { items: { include: { menuProduct: true } } },
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

  return {
    gravado: true,
    orderId: pedidoGravadoId,
    numero: numeroDoPedido,
    status: finalStatus,
    finalizado: isFinal,
    itens: orderItemsData.length,
    total: totalOrderAmount,
  };
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
