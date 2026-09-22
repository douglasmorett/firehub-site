import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { faltaTelaDarBaixa, lerTelasProntas, type TelaDoKds } from "@/lib/kds-telas";

/**
 * GET /api/kds?stage=production|finishing
 * Returns orders relevant for the specified KDS stage.
 * 
 * PUT /api/kds
 * Updates KDS stage for an order (production → finishing → done).
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

async function withRetry<T>(fn: () => Promise<T>, retries = 4, delayMs = 600): Promise<T> {
  let lastErr: any;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < retries) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

export async function GET(req: NextRequest) {
  try {
    let email: string | null = null;
    try {
      const session = await getServerSession(authOptions);
      email = session?.user?.email || null;
    } catch {}

    let userStoreIds: string[] = [];
    let user: any = null;

    if (email) {
      user = await withRetry(() =>
        prisma.user.findUnique({
          where: { email },
          select: { id: true, ownerId: true, isFranqueadoHakim: true, storeTimezone: true },
        })
      ).catch(() => null);

      if (user) {
        if (user.id) userStoreIds.push(user.id);
        if (user.ownerId) userStoreIds.push(user.ownerId);
      }
    }

    userStoreIds = Array.from(new Set(userStoreIds.filter(Boolean)));

    const stage = req.nextUrl.searchParams.get("stage") || "production";

    // Buscar data de abertura do caixa ativo (ou últimas 24h) para ignorar pedidos antigos esquecidos
    const activeSession = await withRetry(() =>
      prisma.cashSession.findFirst({
        where: { franchiseeId: { in: userStoreIds }, status: "OPEN" },
        orderBy: { openedAt: "desc" },
        select: { openedAt: true },
      })
    ).catch(() => null);

    // Usar corte amplo de 48 horas para NUNCA ocultar pedidos criados antes da abertura do caixa ativo!
    const safeCutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);

    let storeCondition: any[] = [];
    if (userStoreIds.length > 0) {
      storeCondition = [
        { franchiseeId: { in: userStoreIds } },
        { franchisee: { ownerId: { in: userStoreIds } } },
        { franchiseeId: null }
      ];
    }

    let where: any = {
      franchiseeId: { in: userStoreIds },
      status: { notIn: ["CANCELADO", "ENTREGUE", "ENCERRADO", "CRIANDO_IA", "AGUARDANDO_PAGAMENTO"] },
      createdAt: { gte: safeCutoff },
    };

    if (stage === "finishing") {
      where.kdsStage = "FINISHING";
    } else if (stage === "production") {
      where.OR = [
        { kdsStage: "PRODUCTION" },
        { kdsStage: "PENDING" },
        { kdsStage: null },
      ];
    } else if (stage !== "all") {
      where.kdsStage = { not: "FINISHED" };
    }

    const orders = await withRetry(() =>
      prisma.customerOrder.findMany({
        where,
        select: {
          id: true,
          // De qual loja é o pedido: é por ele que o item de plataforma casa
          // com o cardápio real DA LOJA CERTA (lib/categoria-do-item.ts). Uma
          // conta com duas lojas casaria a esfiha de uma com o cardápio da
          // outra sem isto.
          franchiseeId: true,
          dailyOrderNumber: true,
          customerName: true,
          customerPhone: true,
          customerAddress: true,
          deliveryType: true,
          paymentMethod: true,
          totalAmount: true,
          deliveryFee: true,
          status: true,
          source: true,
          notes: true,
          ifoodReference: true,
          ifoodStoreName: true,
          openDeliveryReference: true,
          isRoutePriority: true,
          routeId: true,
          routeSchedule: {
            select: {
              routeNumber: true,
            },
          },
          kdsStage: true,
          kdsStationId: true,
          kdsProductionAt: true,
          kdsFinishingAt: true,
          // Quais telas ja deram baixa: e o que permite esconder o pedido de
          // quem ja terminou sem tira-lo das outras (lib/kds-telas.ts).
          kdsTelasProntas: true,
          createdAt: true,
          updatedAt: true,
          items: {
            select: {
              id: true,
              quantity: true,
              price: true,
              notes: true, // observacao por item ("sem cebola") — precisa chegar na cozinha
              // Nome do item como a plataforma mandou. Sem ele no select, a
              // cozinha lê o nome do cadastro, que pode estar desatualizado.
              productName: true,
              comboSelections: true,
              menuProduct: {
                select: {
                  name: true,
                  category: true,
                },
              },
            },
          },
        },
        orderBy: [
          { isRoutePriority: "desc" },
          { createdAt: "asc" },
        ],
        take: 100,
      })
    ).catch(() => []);

    // ── A CATEGORIA REAL DO ITEM DE PLATAFORMA ───────────────────────────
    //
    // O item do iFood aponta para o espelho `ifood-*`, cuja categoria é
    // literalmente "iFood". A tela filtra por categoria ("Pizzas
    // Tradicionais"), "iFood" não casa, e o item some da cozinha. Na NIK
    // (16/09/2026) a tela de pizza mostrava "Nenhum pedido na fila" com a
    // pizza do iFood #8073 aparecendo só na tela das esfihas, que estava sem
    // filtro. Aqui o item de espelho herda a categoria do produto REAL da
    // loja, casado pelo nome; quem não casa fica sem categoria — e sem
    // categoria a tela mostra em todo lugar (lib/categoria-do-item.ts).
    const { resolverCategoriasDosPedidos } = await import("@/lib/categoria-do-item");
    const ordersWithDailyNum = await resolverCategoriasDosPedidos(
      orders.map((o) => ({ ...o, franchiseeId: (o as any).franchiseeId ?? userStoreIds[0] })),
    ).catch(() => orders);

    // ── O PEDIDO SOME DA TELA QUE JA DEU BAIXA ──────────────────────────
    //
    // Nao do KDS inteiro: as outras telas continuam com ele ate a ultima
    // terminar. Sem `tela` na URL (link antigo, loja de uma tela so) nada muda.
    const daTela = String(req.nextUrl.searchParams.get("tela") || "").trim();
    const visiveis = daTela
      ? (ordersWithDailyNum as any[]).filter(
          (o) => !lerTelasProntas((o as any)?.kdsTelasProntas).includes(daTela),
        )
      : ordersWithDailyNum;

    return NextResponse.json(visiveis, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
      },
    });
  } catch (err: any) {
    console.error("[KDS GET Error]:", err?.message || err);
    return NextResponse.json({ error: err?.message || String(err), stack: err?.stack }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const body = await req.json();
  // `tela` é a chave da tela que está dando baixa (ver lib/kds-telas.ts).
  // Ausente = tela aberta por link antigo ou loja de uma tela só: a baixa
  // continua valendo para o pedido inteiro, como sempre valeu.
  const { orderId, action, stationId, tela } = body;
  const chaveDaTelaQueDeuBaixa = String(tela ?? "").trim();

  if (!orderId || !action) {
    return NextResponse.json({ error: "orderId e action obrigatórios" }, { status: 400 });
  }

  const email = session.user?.email;
  if (!email) return NextResponse.json({ error: "Email não encontrado" }, { status: 400 });

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, role: true, ownerId: true } });
  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const targetFranchiseeId = user.ownerId || user.id;

  const order = await prisma.customerOrder.findUnique({
    where: { id: orderId },
    // `openDeliveryChannel`/`source`/`deliveryBy` entram porque o id do 99Food
    // mora no mesmo campo do JotaJá: sem o canal aqui, não há como saber para
    // qual parceiro mandar o "pronto".
    select: {
      id: true, kdsStage: true, status: true, deliveryType: true, franchiseeId: true,
      ifoodOrderId: true, ifoodStoreMerchant: true, openDeliveryOrderId: true,
      openDeliveryChannel: true, source: true, deliveryBy: true, openDeliveryReference: true,
      // A baixa por tela precisa saber QUAIS telas já terminaram e QUAIS itens
      // o pedido tem — é o cruzamento com `User.kdsScreens` que diz se ainda
      // falta alguém (ver lib/kds-telas.ts).
      kdsTelasProntas: true,
      // `CustomerOrderItem` não tem coluna de categoria: ela vem do produto.
      // `productName` entra porque o item de plataforma aponta para o espelho
      // (categoria literal "iFood") e a categoria real é resolvida pelo nome —
      // a mesma regra do GET, em lib/categoria-do-item.ts.
      items: { select: { productName: true, menuProduct: { select: { name: true, category: true } } } },
      // De qual loja do 99Food é o pedido: o "pronto" sai com o token DELA
      // primeiro (lib/food99-status.ts), em vez de tentar o da conta e só
      // depois os das outras — que numa conta com três lojas estourava o
      // orçamento de 12 s antes do `ready` (Frangoso, 17/09/2026).
      food99AppShopId: true,
    },
  });

  if (!order) {
    return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
  }

  // Security check: only ADMIN or the order owner (franchiseeId) can update KDS
  if (user.role !== "ADMIN" && order.franchiseeId !== targetFranchiseeId) {
    return NextResponse.json({ error: "Sem permissão para este pedido." }, { status: 403 });
  }


  // ── A BAIXA QUANDO O PEDIDO ESTÁ EM MAIS DE UMA TELA ────────────────────
  //
  // Cozinha separada por categoria: o mesmo pedido aparece na tela de esfirra
  // e na de pizza, cada uma com os itens dela. `kdsStage` é um campo só, então
  // a baixa de uma finalizava o pedido INTEIRO e ele sumia da outra, que nem
  // tinha começado (NIK, 21/09/2026).
  //
  // Aqui a baixa vira "esta TELA terminou". O estágio só avança quando a
  // última tela que tem item no pedido terminar; até lá o pedido some só da
  // tela de quem deu baixa e NÃO entra na finalização.
  //
  // A categoria dos itens passa pelo MESMO resolvedor que o GET usa, senão o
  // item de plataforma (categoria literal "iFood") contaria numa tela na hora
  // de mostrar e noutra na hora de dar baixa.
  const baixaDaTela = async (estagio: "production" | "finishing") => {
    if (!chaveDaTelaQueDeuBaixa) return { falta: false, prontas: null as string[] | null };
    const dono = await prisma.user
      .findUnique({ where: { id: order.franchiseeId! }, select: { kdsScreens: true } })
      .catch(() => null);
    const telas = (Array.isArray(dono?.kdsScreens) ? dono!.kdsScreens : []) as TelaDoKds[];
    const prontas = [...new Set([...lerTelasProntas(order.kdsTelasProntas), chaveDaTelaQueDeuBaixa])];
    let itens: any[] = (order as any).items || [];
    try {
      const { resolverCategoriasDosPedidos } = await import("@/lib/categoria-do-item");
      const [resolvido] = await resolverCategoriasDosPedidos([order as any]);
      if (resolvido?.items) itens = resolvido.items;
    } catch {
      // Sem o resolvedor, vale a categoria crua do produto: pior filtro, nunca
      // pedido preso. Comida parada na cozinha é mais caro que baixa adiantada.
    }
    return { falta: faltaTelaDarBaixa(telas, itens, estagio, prontas), prontas };
  };

  if (action === "start_production") {
    // Mark order as being worked on in production
    await prisma.customerOrder.update({
      where: { id: orderId },
      data: {
        kdsStage: "PRODUCTION",
        kdsStationId: stationId || null,
        kdsProductionAt: new Date(),
        status: "PREPARANDO",
      },
    });
    return NextResponse.json({ success: true, stage: "PRODUCTION" });
  }

  if (action === "finish_production") {
    const { falta, prontas } = await baixaDaTela("production");
    if (falta) {
      // Outra tela de produção ainda tem item deste pedido. Grava só a baixa
      // desta: ela para de ver o pedido, a outra continua vendo, e o estágio
      // fica onde está — nada de mandar para a finalização pela metade.
      await prisma.customerOrder.update({
        where: { id: orderId },
        data: { kdsTelasProntas: prontas as any },
      });
      return NextResponse.json({ success: true, stage: order.kdsStage, aguardandoOutraTela: true });
    }
    // Production done → move to finishing stage
    await prisma.customerOrder.update({
      where: { id: orderId },
      data: {
        kdsStage: "FINISHING",
        kdsFinishingAt: new Date(),
        kdsStationId: null, // Reset station for finishing team to pick up
        status: order.status === "ACEITO" ? "PREPARANDO" : undefined,
        ...(prontas ? { kdsTelasProntas: prontas as any } : {}),
      },
    });
    return NextResponse.json({ success: true, stage: "FINISHING" });
  }

  if (action === "finish_order") {
    const { falta, prontas } = await baixaDaTela("finishing");
    if (falta) {
      // Mesma regra da produção: o pedido sai da tela de quem deu baixa e
      // continua nas outras. Sem `kdsFinishedAt` e sem `readyAt`, porque o
      // pedido NÃO está pronto — ainda tem item em outra tela.
      await prisma.customerOrder.update({
        where: { id: orderId },
        data: { kdsTelasProntas: prontas as any },
      });
      return NextResponse.json({ success: true, stage: order.kdsStage, aguardandoOutraTela: true });
    }
    const isPickup = order.deliveryType !== "DELIVERY";
    const updateData: any = {
      ...(prontas ? { kdsTelasProntas: prontas } : {}),
      kdsStage: "FINISHED",
      kdsFinishingAt: new Date(),
      // A HORA EM QUE A COZINHA DEU O PEDIDO POR PRONTO.
      //
      // `kdsFinishingAt` logo acima não serve para isso: ele também é carimbado
      // em `finish_production`, ao ENTRAR na etapa de finalização, então não
      // distingue "está finalizando" de "acabou".
      //
      // É o relógio da opção `imprimirSoNoFimDoKds`: a fila de impressão só
      // enxerga as últimas horas, e sem esta data o pedido que demorou na
      // cozinha já teria saído da janela quando fosse finalizado — a comanda
      // nunca sairia, justamente nos pedidos que mais demoram.
      kdsFinishedAt: new Date(),
      // O MARCO "PRONTO" DO PEDIDO.
      //
      // Quem carimba readyAt é a extensão do Prisma, e ela só age quando a
      // escrita traz `status: "PRONTO"`. Este update não traz status nenhum
      // (delivery) ou traz SAIU_ENTREGA (retirada) — então a cozinha dava o
      // pedido por pronto e o pedido nunca ganhava a hora disso. Medido no
      // Frangoso em 17/09/2026: readyAt nulo em 49 de 49 pedidos, todos
      // finalizados no KDS. O relatório de tempo de cozinha ficava cego e o
      // lojista via "dei pronto e não aparece". A extensão respeita o campo
      // quando ele já vem na escrita, então basta mandá-lo.
      readyAt: new Date(),
      kdsStationId: null,
    };

    // Para pedidos de RETIRADA, avança o status automaticamente para SAIU_ENTREGA (Pronto)
    if (isPickup) {
      updateData.status = "SAIU_ENTREGA";
    }

    await prisma.customerOrder.update({
      where: { id: orderId },
      data: updateData,
    });

    // 🚀 Sincronizar com iFood, Jotajá e WhatsApp de forma assíncrona (não-bloqueante para resposta instantânea no KDS)
    (async () => {
      // Com a credencial do dono do pedido — o token central só alcança a
      // Hakim, e nas outras lojas o "pronto" era um 403 engolido pelo log.
      if (order.ifoodOrderId) {
        const { acaoNoPedidoIfood } = await import("@/lib/ifood-pedido");
        await acaoNoPedidoIfood(order, "readyToPickup", { rotulo: "KDS → iFood" });
      }

      // O "pronto" do KDS vale para os dois parceiros que usam este campo, mas
      // a chamada é de cada um. Mandar pedido do 99Food para a API do JotaJá
      // era avisar o parceiro errado e deixar o entregador do 99 sem chamado.
      const { ehPedido99Food, sincronizar99Food } = await import("@/lib/food99-status");
      const { ehPedidoWabiz, sincronizarWabiz } = await import("@/lib/wabiz-status");
      const { ehPedidoBrendi, sincronizarBrendi } = await import("@/lib/brendi-status");

      if (ehPedidoWabiz(order)) {
        await sincronizarWabiz(
          {
            openDeliveryOrderId: order.openDeliveryOrderId!,
            openDeliveryReference: order.openDeliveryReference,
            franchiseeId: order.franchiseeId,
            deliveryType: order.deliveryType,
          },
          "PRONTO"
        ).catch((e) => console.warn("[KDS Wabiz Sync Error]:", e?.message));
      } else if (ehPedidoBrendi(order)) {
        // ESTE RAMO ERA VAZIO, com um comentário dizendo que a rota de status
        // cuidava da Brendi. Não cuidava: o KDS escreve o pedido direto no
        // banco (o update logo acima) e nunca passa por /api/customer-order/
        // status. Resultado: marcar Pronto na cozinha avisava iFood, 99Food,
        // Wabiz e JotaJá — e a Brendi não ficava sabendo, então o entregador
        // parceiro só era chamado quando alguém repetia o Pronto pelo painel.
        await sincronizarBrendi(
          {
            // O resgate manual grava o id com sufixo `_recovered`; a API da
            // Brendi só conhece o UUID limpo (mesma normalização da rota de
            // status).
            openDeliveryOrderId: order.openDeliveryOrderId!.replace(/_recovered$/, ""),
            franchiseeId: order.franchiseeId,
            status: order.status,
            deliveryBy: order.deliveryBy,
          },
          "PRONTO"
        ).catch((e) => console.warn("[KDS Brendi Sync Error]:", e?.message));
      } else if (ehPedido99Food(order)) {
        await sincronizar99Food(
          {
            openDeliveryOrderId: order.openDeliveryOrderId!,
            franchiseeId: order.franchiseeId,
            status: order.status,
            deliveryBy: order.deliveryBy,
            appShopId: (order as any).food99AppShopId ?? null,
          },
          "PRONTO"
        ).catch((e) => console.warn("[KDS 99Food Sync Error]:", e?.message));
      } else if (order.openDeliveryOrderId) {
        try {
          const { jotajaFetch } = await import("@/lib/jotaja-api");
          await jotajaFetch(`/v1/orders/${order.openDeliveryOrderId}/readyToPickup`, { method: "POST" }, order.franchiseeId);
        } catch (errOd) {
          console.warn("[KDS Jotajá Sync Error]:", errOd);
        }
      }

      if (isPickup) {
        try {
          const { sendOrderNotification } = await import("@/lib/order-notifications");
          sendOrderNotification(orderId, "PRONTO_RETIRADA").catch(() => {});
        } catch (errWp) {
          console.warn("[KDS API] Erro ao disparar notificação WhatsApp:", errWp);
        }
      }
    })();

    return NextResponse.json({ success: true, stage: "FINISHED" });
  }

  if (action === "revert_production" || action === "undo_production") {
    await prisma.customerOrder.update({
      where: { id: orderId },
      data: {
        kdsStage: "PRODUCTION",
        kdsFinishingAt: null,
        // Voltar atrás apaga as baixas por tela: sem isto, a tela que já
        // tinha terminado nunca mais veria o pedido que voltou para ela.
        kdsTelasProntas: [] as any,
      },
    });
    return NextResponse.json({ success: true, stage: "PRODUCTION" });
  }

  if (action === "revert_finishing" || action === "undo_finishing") {
    const isPickup = order.deliveryType !== "DELIVERY";
    const updateData: any = {
      kdsStage: "FINISHING",
      // Mesma razão do revert de produção: quem já deu baixa precisa
      // voltar a enxergar o pedido.
      kdsTelasProntas: [] as any,
    };
    if (isPickup && order.status === "SAIU_ENTREGA") {
      updateData.status = "PREPARANDO";
    }
    await prisma.customerOrder.update({
      where: { id: orderId },
      data: updateData,
    });
    return NextResponse.json({ success: true, stage: "FINISHING" });
  }

  return NextResponse.json({ error: "Action inválida" }, { status: 400 });
}
