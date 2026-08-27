import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendEvolutionMessage, sendEvolutionMediaUrl } from "@/lib/whatsapp-evolution";
import { segredoObrigatorio } from "@/lib/segredos";

export const dynamic = "force-dynamic";

async function processBackgroundCampaign(userId: string, targetFranchiseeId: string, campaignId: string, message: string, imageUrl: string | undefined, allTargetPhones: string[]) {
  try {
    let sentSuccessCount = 0;
    let failedCount = 0;

    for (let i = 0; i < allTargetPhones.length; i++) {
      const phone = allTargetPhones[i];
      const cleanPhone = phone.replace(/\D/g, "");
      const fullPhone = cleanPhone.startsWith("55") ? cleanPhone : `55${cleanPhone}`;

      try {
        let ok = false;
        if (imageUrl) {
          ok = await sendEvolutionMediaUrl(targetFranchiseeId, fullPhone, imageUrl, message);
          if (!ok && userId !== targetFranchiseeId) {
            ok = await sendEvolutionMediaUrl(userId, fullPhone, imageUrl, message);
          }
        } else {
          ok = await sendEvolutionMessage(targetFranchiseeId, fullPhone, message);
          if (!ok && userId !== targetFranchiseeId) {
            ok = await sendEvolutionMessage(userId, fullPhone, message);
          }
        }

        if (ok) {
          sentSuccessCount++;
        } else {
          failedCount++;
        }
      } catch (errSend) {
        failedCount++;
      }

      // Atualiza progresso no banco a cada envio para o lojista acompanhar ao vivo
      try {
        const freshUser = await prisma.user.findUnique({ where: { id: userId }, select: { chatbotConfig: true } });
        if (freshUser) {
          const config = (freshUser.chatbotConfig as any) || {};
          const history = Array.isArray(config.campaignHistory) ? config.campaignHistory : [];
          const isDone = i === allTargetPhones.length - 1;

          const updatedHistory = history.map((c: any) => {
            if (c.id === campaignId) {
              return {
                ...c,
                sentCount: sentSuccessCount,
                failedCount,
                // Leitura de mensagem NÃO é medida (o WhatsApp não devolve
                // isso por aqui). O valor era inventado: 76% fixo dos envios,
                // apresentado como dado real. Sem medição, o campo fica nulo
                // e a tela mostra "—".
                viewedCount: null,
                // Carimbo de progresso: é o que impede o processador do GET
                // de disparar EM PARALELO com este worker (mensagem duplicada
                // para o cliente). O GET só assume se isto ficar parado.
                lastProgressAt: new Date().toISOString(),
                status: isDone ? "COMPLETED" : "DISPARANDO",
              };
            }
            return c;
          });

          await prisma.user.update({
            where: { id: userId },
            data: { chatbotConfig: { ...config, campaignHistory: updatedHistory } },
          });
        }
      } catch (dbErr) {
        console.error("[Background Campaign DB Update Error]:", dbErr);
      }

      // 🛡️ PROTOCOLO RIGOROSO ANTI-BAN DO WHATSAPP
      if (i < allTargetPhones.length - 1) {
        // A cada 10 mensagens enviadas, força uma pausa de descanso em lote de 45 a 75 segundos
        if ((i + 1) % 10 === 0) {
          const batchRest = Math.floor(Math.random() * (75000 - 45000 + 1)) + 45000;
          console.log(`[Anti-Ban Guard] 🛑 Pausa de descanso em lote (${i + 1} msgs enviadas). Aguardando ${(batchRest / 1000).toFixed(0)}s...`);
          await new Promise((r) => setTimeout(r, batchRest));
        } else {
          // Delay humano aleatório entre 12s e 28s por mensagem
          const randomDelay = Math.floor(Math.random() * (28000 - 12000 + 1)) + 12000;
          console.log(`[Anti-Ban Guard] ⏱️ Próxima mensagem em ${(randomDelay / 1000).toFixed(1)}s...`);
          await new Promise((r) => setTimeout(r, randomDelay));
        }
      }
    }
  } catch (err: any) {
    console.error(`[Background Campaign Error] campId=${campaignId}:`, err?.message);
  }
}

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, ownerId: true, chatbotConfig: true },
    });

    if (!user) {
      return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
    }

    const targetFranchiseeId = user.ownerId || user.id;

    // 1. Contatos DESTA loja: clientes com pelo menos um pedido aqui.
    // StoreCustomer é uma tabela global da plataforma (o telefone é único no
    // sistema inteiro) — sem este filtro, a rota devolvia a base de clientes
    // de TODAS as lojas para qualquer lojista logado: vazamento de dados e
    // munição para disparo em cima de cliente alheio.
    const storeCustomers = await prisma.storeCustomer.findMany({
      where: { orders: { some: { franchiseeId: targetFranchiseeId } } },
      select: {
        id: true,
        name: true,
        phone: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 3000,
    });

    // 2. Buscar histórico de pedidos reais (CustomerOrder)
    const orders = await prisma.customerOrder.findMany({
      where: { franchiseeId: targetFranchiseeId },
      select: {
        customerName: true,
        customerPhone: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 3000,
    });

    const customerMap = new Map<string, any>();

    // Processa contatos do WhatsApp / cadastros
    storeCustomers.forEach((sc) => {
      const rawPhone = sc.phone || "";
      const cleanDigits = rawPhone.replace(/\D/g, "");
      if (!cleanDigits || cleanDigits.startsWith("0800") || cleanDigits.startsWith("550800") || cleanDigits.length < 10) {
        return;
      }
      const formattedPhone = cleanDigits.startsWith("55") ? `+${cleanDigits}` : `+55${cleanDigits}`;
      if (!customerMap.has(cleanDigits)) {
        customerMap.set(cleanDigits, {
          id: sc.id || cleanDigits,
          name: sc.name || "Cliente WhatsApp",
          phone: formattedPhone,
          totalOrders: 0,
          updatedAt: sc.updatedAt,
        });
      }
    });

    // Processa contatos dos pedidos
    orders.forEach((o) => {
      const rawPhone = o.customerPhone || "";
      const cleanDigits = rawPhone.replace(/\D/g, "");
      if (!cleanDigits || cleanDigits.startsWith("0800") || cleanDigits.startsWith("550800") || cleanDigits.length < 10) {
        return;
      }
      const formattedPhone = cleanDigits.startsWith("55") ? `+${cleanDigits}` : `+55${cleanDigits}`;
      if (!customerMap.has(cleanDigits)) {
        customerMap.set(cleanDigits, {
          id: cleanDigits,
          name: o.customerName || "Cliente WhatsApp",
          phone: formattedPhone,
          totalOrders: 1,
          updatedAt: o.createdAt,
        });
      } else {
        const existing = customerMap.get(cleanDigits);
        existing.totalOrders += 1;
        if (o.customerName && o.customerName !== "Cliente WhatsApp" && existing.name === "Cliente WhatsApp") {
          existing.name = o.customerName;
        }
      }
    });

    // 3. Processa conversas salvas no atendimento humano e na memória da aplicação
    if (global.__humanSupportChats) {
      for (const chat of (global.__humanSupportChats as Map<string, any>).values()) {
        const cleanDigits = (chat.phone || chat.jid || "").replace(/\D/g, "");
        if (cleanDigits && cleanDigits.length >= 10 && !cleanDigits.startsWith("0800") && !cleanDigits.startsWith("550800")) {
          const formattedPhone = cleanDigits.startsWith("55") ? `+${cleanDigits}` : `+55${cleanDigits}`;
          if (!customerMap.has(cleanDigits)) {
            customerMap.set(cleanDigits, {
              id: cleanDigits,
              name: chat.clientName || "Cliente WhatsApp",
              phone: formattedPhone,
              totalOrders: 0,
              updatedAt: new Date(chat.updatedAt || Date.now()),
            });
          }
        }
      }
    }

    if ((global as any).__whatsappActiveContacts) {
      for (const contact of (global as any).__whatsappActiveContacts.values()) {
        const cleanDigits = (contact.phone || "").replace(/\D/g, "");
        if (cleanDigits && cleanDigits.length >= 10 && !cleanDigits.startsWith("0800") && !cleanDigits.startsWith("550800")) {
          const formattedPhone = cleanDigits.startsWith("55") ? `+${cleanDigits}` : `+55${cleanDigits}`;
          if (!customerMap.has(cleanDigits)) {
            customerMap.set(cleanDigits, {
              id: cleanDigits,
              name: contact.name || "Cliente WhatsApp",
              phone: formattedPhone,
              totalOrders: 0,
              updatedAt: new Date(contact.updatedAt || Date.now()),
            });
          }
        }
      }
    }

    // 4. Buscar chats recentes ao vivo na instância conectada da Evolution API
    try {
      const instanceName = `firehub_${targetFranchiseeId.slice(-10)}`;
      let baseUrl = (process.env.EVOLUTION_API_URL || "https://firehub-whatsapp-gateway-production.up.railway.app").replace(/\/$/, "");
      let apiKey = segredoObrigatorio("EVOLUTION_API_KEY");
      
      const chatbotConfigObj = (user?.chatbotConfig as any) || {};
      if (chatbotConfigObj.evolutionUrl) baseUrl = chatbotConfigObj.evolutionUrl.replace(/\/$/, "");
      if (chatbotConfigObj.evolutionApiKey) apiKey = chatbotConfigObj.evolutionApiKey;

      const chatRes = await fetch(`${baseUrl}/chat/findChats/${instanceName}`, {
        method: "GET",
        headers: { "apikey": apiKey, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(5000),
      }).then(r => r.json()).catch(() => null);

      const evolutionChats = Array.isArray(chatRes) ? chatRes : (chatRes?.chats || []);
      evolutionChats.forEach((c: any) => {
        const jid = c.id || c.remoteJid || c.jid || "";
        const cleanDigits = jid.replace(/\D/g, "");
        if (!cleanDigits || cleanDigits.startsWith("0800") || cleanDigits.startsWith("550800") || cleanDigits.length < 10) return;

        const formattedPhone = cleanDigits.startsWith("55") ? `+${cleanDigits}` : `+55${cleanDigits}`;
        const name = c.name || c.pushName || `Cliente WhatsApp (${cleanDigits.slice(-4)})`;

        if (!customerMap.has(cleanDigits)) {
          customerMap.set(cleanDigits, {
            id: cleanDigits,
            name: name,
            phone: formattedPhone,
            totalOrders: 0,
            updatedAt: new Date(c.updatedAt || Date.now()),
          });
        }
      });
    } catch (e) {
      console.error("[Marketing API] Erro ao buscar chats ao vivo da Evolution API:", e);
    }

    const chatbotConfig = (user.chatbotConfig as any) || {};
    const rawHistory = Array.isArray(chatbotConfig.campaignHistory) ? chatbotConfig.campaignHistory : [];

    // 4.5 Se houver disparo ativo em andamento (DISPARANDO), processa um lote de envios
    //
    // SÓ como resgate: o disparo normal é do worker em background iniciado no
    // POST. Este processador rodava JUNTO com o worker — dois remetentes
    // avançando o mesmo índice, cliente recebendo a campanha duas vezes.
    // Agora ele apenas assume campanha ABANDONADA (worker morto num deploy):
    // sem progresso há mais de 2 minutos.
    const pendingCampIdx = rawHistory.findIndex((c: any) => {
      if (c.status !== "DISPARANDO") return false;
      const ultimo = c.lastProgressAt ? new Date(c.lastProgressAt).getTime() : 0;
      return Date.now() - ultimo > 120_000;
    });
    if (pendingCampIdx !== -1) {
      const activeCamp = rawHistory[pendingCampIdx];
      const targetPhones = activeCamp.targetPhones || [];
      let sentCount = typeof activeCamp.sentCount === "number" ? activeCamp.sentCount : 0;
      let failedCount = typeof activeCamp.failedCount === "number" ? activeCamp.failedCount : 0;

      if (sentCount + failedCount < targetPhones.length) {
        // Pega apenas 1 pessoa por ciclo (agora que o ciclo é a cada 20s) para simular digitação humana
        const batch = targetPhones.slice(sentCount + failedCount, sentCount + failedCount + 1);
        for (const phone of batch) {
          const cleanPhone = String(phone).replace(/\D/g, "");
          const fullPhone = cleanPhone.startsWith("55") ? cleanPhone : `55${cleanPhone}`;
          try {
            let ok = false;
            if (activeCamp.imageUrl) {
              ok = await sendEvolutionMediaUrl(targetFranchiseeId, fullPhone, activeCamp.imageUrl, activeCamp.message);
              if (!ok && user.id !== targetFranchiseeId) {
                ok = await sendEvolutionMediaUrl(user.id, fullPhone, activeCamp.imageUrl, activeCamp.message);
              }
            } else {
              ok = await sendEvolutionMessage(targetFranchiseeId, fullPhone, activeCamp.message);
              if (!ok && user.id !== targetFranchiseeId) {
                ok = await sendEvolutionMessage(user.id, fullPhone, activeCamp.message);
              }
            }
            if (ok) sentCount++;
            else failedCount++;
          } catch {
            failedCount++;
          }
          await new Promise((r) => setTimeout(r, 300));
        }

        const isDone = (sentCount + failedCount) >= targetPhones.length;
        rawHistory[pendingCampIdx] = {
          ...activeCamp,
          sentCount,
          failedCount,
          // Sem medição de leitura — nada de 76% inventado.
          viewedCount: null,
          lastProgressAt: new Date().toISOString(),
          status: isDone ? "COMPLETED" : "DISPARANDO",
        };

        try {
          await prisma.user.update({
            where: { id: user.id },
            data: { chatbotConfig: { ...chatbotConfig, campaignHistory: rawHistory } },
          });
        } catch (dbErr) {
          console.error("[Marketing GET Batch DB Error]:", dbErr);
        }
      }
    }

    // 5. Calcular métricas de conversão e lucro para o histórico de disparos
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const storeOrdersRecent = await prisma.customerOrder.findMany({
      where: {
        franchiseeId: targetFranchiseeId,
        createdAt: { gte: thirtyDaysAgo },
        status: { notIn: ["CANCELADO"] },
      },
      select: {
        totalAmount: true,
        customerPhone: true,
        createdAt: true,
      },
    });

    const campaignHistoryProcessed = rawHistory.map((camp: any) => {
      const campDate = new Date(camp.createdAt).getTime();
      const sevenDaysAfter = campDate + 7 * 24 * 60 * 60 * 1000;
      const targetPhoneSet = new Set<string>((camp.targetPhones || []).map((p: string) => p.replace(/\D/g, "").slice(-8)));

      let convertedOrders = 0;
      let convertedRevenue = 0;

      for (const order of storeOrdersRecent) {
        const orderDate = new Date(order.createdAt).getTime();
        if (orderDate >= campDate && orderDate <= sevenDaysAfter) {
          const orderPhoneDigits = (order.customerPhone || "").replace(/\D/g, "").slice(-8);
          if (orderPhoneDigits && targetPhoneSet.has(orderPhoneDigits)) {
            convertedOrders += 1;
            convertedRevenue += order.totalAmount;
          }
        }
      }

      const estimatedProfit = convertedRevenue * 0.40; // Margem média líquida de 40%

      const sentCount = camp.sentCount != null ? camp.sentCount : (camp.targetCount || 0);
      // null = não medido. O fallback antigo fabricava 76% dos envios.
      const viewedCount = camp.viewedCount != null ? camp.viewedCount : null;

      return {
        ...camp,
        sentCount,
        viewedCount,
        convertedOrders,
        convertedRevenue,
        estimatedProfit,
      };
    });

    // Coletar os códigos de cupons vinculados às campanhas de marketing e cupom instantâneo
    const activeCampaignCoupons = new Set<string>();
    if (chatbotConfig.coupon7d) activeCampaignCoupons.add(chatbotConfig.coupon7d.trim().toLowerCase());
    if (chatbotConfig.coupon15d) activeCampaignCoupons.add(chatbotConfig.coupon15d.trim().toLowerCase());
    if (chatbotConfig.coupon30d) activeCampaignCoupons.add(chatbotConfig.coupon30d.trim().toLowerCase());
    if (chatbotConfig.instantCouponCode) activeCampaignCoupons.add(chatbotConfig.instantCouponCode.trim().toLowerCase());

    // Buscar pedidos reais da loja que utilizaram os cupons das campanhas de marketing
    let recoveredOrdersCount = 0;
    let recoveredRevenue = 0;

    if (activeCampaignCoupons.size > 0) {
      const campaignOrders = await prisma.customerOrder.findMany({
        where: {
          franchiseeId: targetFranchiseeId,
          notes: {
            contains: "Cupom:", // Observação onde os cupons aplicados ficam registrados no pedido
          },
        },
        select: {
          totalAmount: true,
          notes: true,
        },
      });

      campaignOrders.forEach((o) => {
        const notesLower = (o.notes || "").toLowerCase();
        for (const coupon of activeCampaignCoupons) {
          if (notesLower.includes(`cupom: ${coupon}`) || notesLower.includes(`[cupom: ${coupon}]`)) {
            recoveredOrdersCount += 1;
            recoveredRevenue += o.totalAmount;
            break;
          }
        }
      });
    }

    const customers = Array.from(customerMap.values());

    return NextResponse.json({
      success: true,
      totalCustomers: customers.length,
      customers,
      recoveredOrdersCount,
      recoveredRevenue,
      campaignHistory: campaignHistoryProcessed,
      marketingConfig: {
        autoRecuperation7d: chatbotConfig.autoRecuperation7d ?? true,
        autoRecuperation15d: chatbotConfig.autoRecuperation15d ?? true,
        autoRecuperation30d: chatbotConfig.autoRecuperation30d ?? true,
        msg7d: chatbotConfig.msg7d || "Oie, sentimos sua falta! 🍕 Que tal matar a fome hoje com R$ 10 de desconto?",
        msg15d: chatbotConfig.msg15d || "Faz 15 dias que você não pede seu lanche favorito! 🚀 Ganhe 15% OFF hoje no nosso cardápio!",
        msg30d: chatbotConfig.msg30d || "Saudade do nosso tempero especial? ❤️ Liberamos Frete Grátis exclusivo para você pedir hoje!",
        img7d: chatbotConfig.img7d || "",
        img15d: chatbotConfig.img15d || "",
        img30d: chatbotConfig.img30d || "",
      }
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, ownerId: true, chatbotConfig: true, slug: true, name: true },
    });

    if (!user) {
      return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
    }

    const targetFranchiseeId = user.ownerId || user.id;
    const body = await req.json();

    // 1. Disparar teste individual de 7 dias
    if (body.action === "send_test_7d") {
      const { phone } = body;
      if (!phone) {
        return NextResponse.json({ error: "Telefone é obrigatório." }, { status: 400 });
      }

      const cleanPhone = phone.replace(/\D/g, "");
      const fullPhone = cleanPhone.startsWith("55") ? cleanPhone : `55${cleanPhone}`;

      const chatbotConfig = (user.chatbotConfig as any) || {};
      const coupon = chatbotConfig.coupon7d || "VOLTEI10";
      const storeSlug = (user as any).slug || "loja";
      const storeUrl = `https://firehubfood.com.br/loja/${storeSlug}`;

      // Sem nome fixo: o teste vai para o número que o lojista digitou, e a
      // mensagem real usa o nome do cliente — "Rosangela" hardcoded aqui fazia
      // o teste chegar chamando qualquer pessoa de Rosangela.
      const messageText = `Oi, tudo bem? Sentimos sua falta! Tá sumido(a)! 🍕\n\n` +
                          `Trouxemos 10% de desconto para você lanchar com a gente hoje!\n` +
                          `Use o cupom: *${coupon}* no nosso site:\n${storeUrl}`;

      const imgUrl = chatbotConfig.img7d || "";
      if (imgUrl) {
        await sendEvolutionMediaUrl(targetFranchiseeId, fullPhone, imgUrl, messageText);
      }
      const success = imgUrl
        ? true
        : await sendEvolutionMessage(targetFranchiseeId, fullPhone, messageText);

      if (success) {
        return NextResponse.json({ success: true, message: `🚀 Mensagem de teste enviada com sucesso para ${fullPhone}!` });
      } else {
        return NextResponse.json({ error: "Falha ao enviar via WhatsApp." }, { status: 500 });
      }
    }

    // 2. Salvar configurações automáticas de marketing
    if (body.action === "save_config") {
      const currentConfig = (user.chatbotConfig as any) || {};
      const updatedConfig = {
        ...currentConfig,
        autoRecuperation7d: body.autoRecuperation7d,
        autoRecuperation15d: body.autoRecuperation15d,
        autoRecuperation30d: body.autoRecuperation30d,
        msg7d: body.msg7d,
        msg15d: body.msg15d,
        msg30d: body.msg30d,
        img7d: body.img7d,
        img15d: body.img15d,
        img30d: body.img30d,
      };

      await prisma.user.update({
        where: { id: user.id },
        data: { chatbotConfig: updatedConfig },
      });

      return NextResponse.json({ success: true, message: "Configurações salvas com sucesso!" });
    }

    // 3. Disparo em massa 100% INSTANTÂNEO & ASSÍNCRONO EM SEGUNDO PLANO
    if (body.action === "send_campaign" || body.action === "send_broadcast") {
      const { message, imageUrl, targetPhones } = body;
      if (!message || !Array.isArray(targetPhones) || targetPhones.length === 0) {
        return NextResponse.json({ error: "Mensagem e contatos alvo são obrigatórios." }, { status: 400 });
      }

      const allTargetPhones = targetPhones;
      const campaignId = `camp_${Date.now()}`;

      // Registrar o disparo IMEDIATAMENTE no histórico da loja com status "DISPARANDO"
      const currentConfig = (user.chatbotConfig as any) || {};
      const historyList = Array.isArray(currentConfig.campaignHistory) ? currentConfig.campaignHistory : [];

      const newCampaignRecord = {
        id: campaignId,
        createdAt: new Date().toISOString(),
        message,
        imageUrl: imageUrl || null,
        targetCount: allTargetPhones.length,
        sentCount: 0,
        failedCount: 0,
        // null = leitura não medida (nada de % inventado na tela).
        viewedCount: null,
        targetPhones: allTargetPhones.slice(0, 2000), // Guarda os telefones para cálculo de vendas convertidas
        // Nasce carimbada: o processador-resgate do GET só assume depois de
        // 2 min SEM progresso — sem isto ele roubava a campanha do worker
        // logo no primeiro poll e o cliente recebia mensagem duplicada.
        lastProgressAt: new Date().toISOString(),
        status: "DISPARANDO",
        convertedOrders: 0,
        convertedRevenue: 0,
        estimatedProfit: 0,
      };

      const updatedConfig = {
        ...currentConfig,
        campaignHistory: [newCampaignRecord, ...historyList].slice(0, 50),
      };

      await prisma.user.update({
        where: { id: user.id },
        data: { chatbotConfig: updatedConfig },
      });

      // Dispara o worker assíncrono em segundo plano SEM travar a requisição do usuário na tela
      processBackgroundCampaign(user.id, targetFranchiseeId, campaignId, message, imageUrl, allTargetPhones).catch(() => {});

      return NextResponse.json({
        success: true,
        message: `🚀 Disparo iniciado para ${allTargetPhones.length} clientes! O envio está sendo realizado em segundo plano.`,
        campaign: newCampaignRecord,
      });
    }

    return NextResponse.json({ error: "Ação inválida" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
