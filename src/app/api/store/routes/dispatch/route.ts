import { NextRequest, NextResponse, after } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { efeitosDoDespacho } from "@/lib/despacho-da-rota";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    // ── A ROTA, O MOTOBOY E OS PEDIDOS TÊM DE SER DESTA LOJA ────────────────
    //
    // Esta rota nem carregava o usuário: qualquer sessão mandava o `routeId`
    // de OUTRA loja e a despachava — pedidos dela em "Saiu para entrega",
    // WhatsApp para os clientes dela, despacho no iFood/99 dela e a NFC-e
    // dela emitida. Agora, antes de qualquer escrita: a rota é da loja de quem
    // pede, o motoboy também, e só os pedidos da loja andam.
    //
    // "Da loja" é a loja ou um usuário dela: a rota nasce com o PRIMEIRO id de
    // `getValidFranchiseeIds` (api/store/routes), que pode ser o de um
    // funcionário da própria loja — exigir só `franchiseeId === loja`
    // recusaria rota legítima.
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, ownerId: true },
    });
    if (!user) {
      return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
    }
    const lojaId = user.ownerId || user.id;
    const daLoja = { OR: [{ franchiseeId: lojaId }, { franchisee: { ownerId: lojaId } }] };

    const body = await req.json();
    const { routeId, motoboyId } = body;

    if (!routeId) {
      return NextResponse.json({ error: "ID da rota não informado" }, { status: 400 });
    }

    // Rota de outra loja responde como rota inexistente: a resposta não conta
    // que o id existe.
    const route = await prisma.routeSchedule.findFirst({
      where: { id: String(routeId), ...daLoja },
      select: { id: true, routeNumber: true, motoboyId: true, franchiseeId: true },
    });

    if (!route) {
      return NextResponse.json({ error: "Rota não encontrada" }, { status: 404 });
    }

    const finalMotoboyId = motoboyId || route.motoboyId;
    if (!finalMotoboyId) {
      return NextResponse.json({ error: "Selecione um motoboy para poder despachar a rota!" }, { status: 400 });
    }

    const motoboy = await prisma.motoboy.findFirst({
      where: { id: String(finalMotoboyId), ...daLoja },
    });

    if (!motoboy) {
      return NextResponse.json({ error: "Motoboy não encontrado" }, { status: 404 });
    }

    // Os pedidos da rota que são DESTA loja. A montagem da rota
    // (api/store/routes) grava o `routeId` nos ids que o corpo mandou; um
    // pedido de outra loja pendurado aqui não sai, não recebe aviso nem nota.
    const pedidosDaRota = await prisma.customerOrder.findMany({
      where: { routeId: route.id, ...daLoja },
      select: {
        id: true, franchiseeId: true, status: true, source: true, deliveryType: true, deliveryBy: true,
        customerName: true, customerPhone: true, customerAddress: true, dailyOrderNumber: true,
        ifoodOrderId: true, ifoodReference: true, ifoodStoreMerchant: true,
        openDeliveryOrderId: true, openDeliveryChannel: true, openDeliveryReference: true,
        motoboyId: true,
      },
    });
    const idsDaRota = pedidosDaRota.map((o) => o.id);

    const { STATUS_CANCELADOS, STATUS_FINALIZADOS } = await import("@/lib/status-pedido");

    // ── A ROTA E OS PEDIDOS SAEM JUNTOS, OU NÃO SAEM ──────────────────────
    //
    // As duas gravações do despacho numa transação: se a dos pedidos falhar,
    // a rota volta a "aguardando" e o lojista despacha de novo. Separadas, a
    // rota ficava DISPATCHED com os pedidos ainda na cozinha.
    //
    // E a mesma rota duas vezes: dois cliques (ou duas abas) despachando com o
    // mesmo entregador chegavam aqui juntos, os dois liam a rota PENDING e o
    // motoboy recebia duas vezes o WhatsApp das paradas. A troca de estado
    // agora é condicional — só quem de fato a fez segue para os efeitos.
    // Despachar de novo com OUTRO entregador continua passando, como sempre.
    const saiuAgora = await prisma.$transaction(async (tx) => {
      // 1. Atualiza status da rota no banco
      const virou = await tx.routeSchedule.updateMany({
        where: {
          id: route.id,
          OR: [{ status: { not: "DISPATCHED" } }, { motoboyId: null }, { motoboyId: { not: motoboy.id } }],
        },
        data: {
          status: "DISPATCHED",
          motoboyId: motoboy.id,
          dispatchedAt: new Date(),
        },
      });
      if (virou.count === 0) return false;

      // 2. Atualiza todos os pedidos para SAIU_ENTREGA e vincula ao motoboy
      // ── REDE DE SEGURANÇA NO BANCO ────────────────────────────────────
      //
      // Sem o filtro de status, despachar uma rota reescrevia QUALQUER pedido
      // ligado a ela — inclusive um que já foi entregue ou que já está na rua
      // com outro entregador. O pedido voltava para a rota, trocava de motoboy,
      // e quem estava com a comida na mão levava 404 ao dar baixa. A tela já
      // impede selecionar esses pedidos; isto impede o resto.
      if (idsDaRota.length > 0) {
        await tx.customerOrder.updateMany({
          where: {
            id: { in: idsDaRota },
            routeId: route.id,
            status: { notIn: [...STATUS_FINALIZADOS, ...STATUS_CANCELADOS, "SAIU_ENTREGA"] },
          },
          data: {
            status: "SAIU_ENTREGA",
            motoboyId: motoboy.id,
            isRoutePriority: false, // Pedido saiu da cozinha!
            // O carimbo que lib/prisma.ts põe em todo SAIU_ENTREGA, escrito
            // aqui para não depender da extensão dentro da transação (o
            // acerto do motoboy conta a saída por ele).
            dispatchedAt: new Date(),
          },
        });
      }
      return true;
    });

    if (!saiuAgora) {
      return NextResponse.json({
        success: true,
        jaDespachada: true,
        message: `A rota ${route.routeNumber} já tinha saído com o motoboy ${motoboy.name}.`,
      });
    }

    // 3. O resto é consequência e roda DEPOIS da resposta ──────────────────
    //
    // Aviso ao cliente, NFC-e, aviso no app do entregador, o "saiu" no
    // iFood/99Food/Brendi/Wabiz/Keeta/JotaJá e o WhatsApp das paradas para o
    // motoboy (lib/despacho-da-rota.ts). Nenhum deles desfaz o despacho se
    // falhar. Já não eram esperados, mas nasciam soltos no meio desta rota, e
    // uma exceção do laço das plataformas deixava os pedidos seguintes sem
    // aviso ao parceiro. O `after()` do Next roda depois que a resposta sai
    // — e só é agendado aqui, com tudo gravado: um erro acima não dispara
    // efeito nenhum.
    //
    // `pedidosDaRota` é o retrato de ANTES das gravações: é ele que diz quem
    // saiu agora (aviso ao cliente) e quem chegou ao celular do entregador.
    after(() =>
      efeitosDoDespacho({
        lojaId,
        rota: { id: route.id, routeNumber: route.routeNumber },
        motoboy: { id: motoboy.id, name: motoboy.name, phone: motoboy.phone },
        pedidos: pedidosDaRota,
      }),
    );

    return NextResponse.json({
      success: true,
      message: `🚀 Rota ${route.routeNumber} despachada com sucesso com o motoboy ${motoboy.name}!`,
    });
  } catch (err: any) {
    console.error("[POST /api/store/routes/dispatch Error]:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
