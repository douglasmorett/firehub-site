import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import {
  chaveDaTela,
  faltaFinalizacao,
  itemPronto,
  itensDaTela,
  telaTemPendencia,
  lerTelasProntas,
  temAlgoPronto,
  type TelaDoKds,
} from "@/lib/kds-telas";

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
              // O carimbo de pronto do item: é ele que vira o ✓ na tela de
              // finalização e que decide se a tela de produção ainda tem o que
              // fazer neste pedido (lib/kds-telas.ts).
              prontoEm: true,
              menuProduct: {
                select: {
                  // O `id` é o que prova que o item é espelho de plataforma
                  // quando a categoria não entrega (o da Wabiz vem "Esfihas",
                  // "Bebidas"). Sem ele, resolverCategoriasDosPedidos deixa a
                  // categoria da Wabiz passar direto para o filtro da tela e o
                  // pedido não aparece em cozinha nenhuma — lib/categoria-do-item.ts.
                  //
                  // `active` vem junto porque o id sozinho acusa demais: numa
                  // loja cujo cardápio foi IMPORTADO, o produto de verdade
                  // carrega id `ifood-` e continua sendo cardápio. Ativo não é
                  // espelho (lib/cardapio-interno.ts).
                  id: true,
                  active: true,
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

    // ── O QUE CADA TELA ENXERGA ───────────────────────────────────────────
    //
    // PRODUÇÃO: enxerga enquanto tiver item SEU sem carimbo. A tela de esfirra
    // sai de cena quando as esfirras estão prontas; a de pizza continua com o
    // mesmo pedido até a pizza sair. E o item carimbado some das duas telas
    // que o mostravam — "se alguém fez, não é pra fazer de novo".
    //
    // FINALIZAÇÃO: enxerga assim que a PRIMEIRA baixa acontece, com visto no
    // que já ficou pronto e sinal no que falta chegar (decisão do dono,
    // 22/09/2026) — é isso que deixa a expedição saber o que já veio e o que
    // ainda vem. E some só da tela que deu a baixa DELA: duas telas de
    // finalização são estações diferentes e cada uma fecha a sua.
    const daTela = String(req.nextUrl.searchParams.get("tela") || "").trim();
    let visiveis: any[] = ordersWithDailyNum as any[];

    if (daTela) {
      const donoDasTelas = await prisma.user
        .findUnique({ where: { id: userStoreIds[0] }, select: { kdsScreens: true } })
        .catch(() => null);
      const telas = (Array.isArray(donoDasTelas?.kdsScreens) ? donoDasTelas!.kdsScreens : []) as any[];
      const minha = telas.find((t) => chaveDaTela(t) === daTela);

      if (stage === "finishing") {
        visiveis = visiveis.filter((o) => {
          if (lerTelasProntas(o?.kdsTelasProntas).includes(daTela)) return false;
          return temAlgoPronto(o?.items);
        });
      } else if (stage === "production" && minha) {
        visiveis = visiveis.filter((o) => telaTemPendencia(minha, o?.items || []));
      }
    }

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
      // Para nao reescrever a hora de entrada na finalizacao a cada baixa.
      kdsFinishingAt: true,
      // O numero do pedido: e o que o filtro de par/impar da tela usa.
      dailyOrderNumber: true,
      // `CustomerOrderItem` não tem coluna de categoria: ela vem do produto.
      // `productName` entra porque o item de plataforma aponta para o espelho
      // (categoria literal "iFood") e a categoria real é resolvida pelo nome —
      // a mesma regra do GET, em lib/categoria-do-item.ts.
      items: { select: { id: true, prontoEm: true, productName: true, menuProduct: { select: { id: true, name: true, category: true } } } },
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


  // ── A BAIXA NO KDS, EM DOIS MODELOS ─────────────────────────────────────
  //
  // PRODUÇÃO: o pronto é do ITEM. A tela carimba os itens que ELA mostra. A
  // pizza sem carimbo continua na tela de pizza, e o item que aparece nas duas
  // telas sai das duas ao ser carimbado uma vez — "se alguém fez, não é pra
  // fazer de novo".
  //
  // FINALIZAÇÃO: o pronto é da TELA. Duas telas de finalização são estações
  // diferentes: a baixa de uma não é a da outra, mesmo sendo o mesmo pedido.
  // E só conta a tela que MOSTRA o pedido — com uma em ímpar e outra em par,
  // exigir as duas travaria tudo.
  //
  // (decisões do dono, 21 e 22/09/2026)
  const telasDaLoja = async (): Promise<TelaDoKds[]> => {
    const dono = await prisma.user
      .findUnique({ where: { id: order.franchiseeId! }, select: { kdsScreens: true } })
      .catch(() => null);
    return (Array.isArray(dono?.kdsScreens) ? dono!.kdsScreens : []) as TelaDoKds[];
  };

  // A categoria do item passa pelo MESMO resolvedor que o GET usa, senão o
  // item de plataforma (categoria literal "iFood") cairia numa tela para
  // desenhar e noutra para carimbar.
  const itensResolvidos = async (): Promise<any[]> => {
    const crus: any[] = (order as any).items || [];
    try {
      const { resolverCategoriasDosPedidos } = await import("@/lib/categoria-do-item");
      const [resolvido] = await resolverCategoriasDosPedidos([order as any]);
      return resolvido?.items || crus;
    } catch {
      // Sem o resolvedor vale a categoria crua: pior filtro, nunca pedido
      // preso. Comida parada é mais cara que carimbo adiantado.
      return crus;
    }
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
    // ── O CARIMBO É NOS ITENS QUE ESTA TELA MOSTRA ────────────────────────
    //
    // Marcar na tela de esfirra carimba as esfirras. A pizza continua sem
    // carimbo e a tela de pizza continua com ela. E o item que aparece nas
    // DUAS telas sai das duas ao ser carimbado uma vez, que é o "se alguém
    // fez não é pra fazer de novo".
    const telas = await telasDaLoja();
    const itens = await itensResolvidos();
    const minhaTela = telas.find((t) => chaveDaTela(t) === chaveDaTelaQueDeuBaixa);

    // Sem identidade de tela (link antigo, loja de uma tela só) carimba tudo:
    // é como o KDS sempre funcionou, e vale mais que travar o pedido.
    const aCarimbar = minhaTela ? itensDaTela(minhaTela, itens) : itens;
    const ids = aCarimbar.map((i: any) => i?.id).filter(Boolean);
    if (ids.length) {
      await prisma.customerOrderItem.updateMany({
        where: { id: { in: ids }, orderId, prontoEm: null },
        data: { prontoEm: new Date() },
      }).catch(() => null);
    }

    // Reflete o carimbo na lista em memória para decidir o estágio sem uma
    // segunda ida ao banco.
    const depois = itens.map((i: any) =>
      ids.includes(i?.id) ? { ...i, prontoEm: i?.prontoEm || new Date() } : i,
    );

    // ── QUANDO O PEDIDO CHEGA NA FINALIZAÇÃO ──────────────────────────────
    //
    // Na PRIMEIRA baixa, e não na última (decisão do dono, 22/09/2026): a
    // expedição precisa ver o pedido com visto no que já foi feito e sinal no
    // que falta chegar. Esperar tudo ficar pronto esconderia dela justamente
    // a informação de que ela precisa para se organizar.
    const jaTemAlgoPronto = temAlgoPronto(depois);
    const aindaFalta = (depois as any[]).some((i) => !itemPronto(i));

    await prisma.customerOrder.update({
      where: { id: orderId },
      data: {
        ...(jaTemAlgoPronto && order.kdsStage !== "FINISHED"
          ? { kdsStage: "FINISHING", kdsFinishingAt: order.kdsFinishingAt || new Date() }
          : {}),
        kdsStationId: null,
        status: order.status === "ACEITO" ? "PREPARANDO" : undefined,
      },
    });

    return NextResponse.json({
      success: true,
      stage: "FINISHING",
      itensCarimbados: ids.length,
      // O que ainda falta ficar pronto, para a tela avisar em vez de deixar o
      // pedido sumir calado.
      aindaFalta,
    });
  }

  if (action === "finish_order") {
    // ── NA FINALIZAÇÃO O PRONTO É DA TELA, NÃO DO ITEM ────────────────────
    //
    // Duas telas de finalização são estações DIFERENTES: a baixa de uma não
    // é a da outra, mesmo sendo o mesmo pedido e o mesmo item. É o contrário
    // da produção, onde o carimbo é do item e sai de todas as telas de uma
    // vez. (decisão do dono, 22/09/2026)
    //
    // E só conta a tela que MOSTRA este pedido — pelo filtro de número E pelo
    // de categoria. A NIK tem "Finalização Esfihas" e "Finalização Pizza"
    // separadas: um pedido só de esfiha nem aparece na tela de pizza, e cobrar
    // a baixa dela deixaria o pedido preso entre a produção e o finalizado.
    const telasFim = await telasDaLoja();
    const prontas = chaveDaTelaQueDeuBaixa
      ? [...new Set([...lerTelasProntas(order.kdsTelasProntas), chaveDaTelaQueDeuBaixa])]
      : null;
    const pedidoParaFiltro = { numero: (order as any).dailyOrderNumber, deliveryType: order.deliveryType };
    const itensParaFiltro = await itensResolvidos();
    if (prontas && faltaFinalizacao(telasFim, prontas, pedidoParaFiltro, itensParaFiltro)) {
      // Outra tela de finalização ainda tem que fazer a parte dela. O pedido
      // sai DESTA e continua lá; nada de FINISHED, de readyAt nem de avisar
      // a plataforma, porque a expedição ainda não acabou.
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
