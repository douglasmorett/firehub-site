import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStartOfDayUTC, toLocalISODate } from "@/lib/timezone";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const motoboyId = searchParams.get("motoboyId");
    const storeId = searchParams.get("storeId");

    if (!motoboyId || !storeId) {
      return NextResponse.json({ error: "motoboyId e storeId são obrigatórios" }, { status: 400 });
    }

    const storeOwner = await prisma.user.findUnique({
      where: { id: storeId },
      select: { storeTimezone: true, printerConfig: true }
    });
    const tz = storeOwner?.storeTimezone || "America/Sao_Paulo";

    // As palavras de bebida PERSONALIZADAS da loja ("guaravita", marca local…)
    // valem para o aviso do motoboy tanto quanto para a etiqueta da impressora.
    // Sem elas, a bebida que só a loja conhece passava sem o "você entregou?".
    const customBeverageKeywords = (storeOwner?.printerConfig as any)?.customBeverageKeywords || "";

    const localTodayStr = toLocalISODate(new Date(), tz);
    const todayStart = getStartOfDayUTC(localTodayStr, tz);
    // Busca apenas os pedidos desta loja atribuídos a ESTE MOTOBOY E ESPECÍFICOS DE HOJE para concluídos
    const orders = await prisma.customerOrder.findMany({
      where: {
        franchiseeId: storeId,
        motoboyId: motoboyId,
        status: { notIn: ["CANCELLED", "CANCELED"] },
        OR: [
          // 1. Pedidos ativos pendentes de entrega
          { status: { notIn: ["ENTREGUE", "ENCERRADO"] } },
          // 2. Pedidos entregues HOJE por este motoboy
          {
            status: { in: ["ENTREGUE", "ENCERRADO"] },
            updatedAt: { gte: todayStart }
          }
        ]
      },
      include: {
        items: {
          include: {
            menuProduct: true
          }
        },
        // Nome e cor da rota, para o app dizer DE QUAL rota cada parada é.
        // Antes o app tentava ler isso do localStorage do próprio celular —
        // dados que só existiam no navegador da LOJA, nunca no do motoboy.
        routeSchedule: {
          select: { id: true, routeNumber: true, color: true }
        }
      },
      orderBy: { createdAt: "desc" },
      take: 100
    });

    // A sequência da parada (1º, 2º, 3º…) mora numa coluna fora do schema
    // (ver /api/admin/coluna-sequencia-rota), então vem por SQL cru e é
    // mesclada aqui. Sem a coluna, todo mundo fica sem sequência e o app
    // ordena como sempre ordenou — nada quebra.
    let sequencias: Record<string, number> = {};
    try {
      const ids = orders.map((o) => o.id);
      if (ids.length > 0) {
        const rows = await prisma.$queryRaw<{ id: string; routeSequence: number | null }[]>`
          SELECT "id", "routeSequence" FROM "CustomerOrder"
          WHERE "id" = ANY(${ids}) AND "routeSequence" IS NOT NULL
        `;
        rows.forEach((r) => { if (r.routeSequence != null) sequencias[r.id] = Number(r.routeSequence); });
      }
    } catch {}

    const ordersComSequencia = orders.map((o) => ({
      ...o,
      routeSequence: sequencias[o.id] ?? null,
    }));

    return NextResponse.json({ success: true, orders: ordersComSequencia, customBeverageKeywords });

  } catch (err: any) {
    console.error("[Motoboy Orders API Error]", err);
    return NextResponse.json({ error: "Erro ao carregar pedidos" }, { status: 500 });
  }
}

/**
 * PATCH /api/motoboys/orders  { orderId, motoboyId, storeId }
 *
 * O motoboy confirma a entrega — e a confirmação passa a EXISTIR.
 *
 * ── O botão nunca funcionou ─────────────────────────────────────────────────
 *
 * O app do motoboy chamava `PATCH /api/customer-order/status`, que só exporta
 * GET e PUT: todo toque devolvia 405. E mesmo que fosse PUT, aquela rota exige
 * sessão do painel (next-auth), que o motoboy não tem — o login dele é outro.
 * Como o app só tratava `res.ok` sem `else`, o entregador via o spinner rodar e
 * NADA acontecia, sem nenhuma mensagem. O pedido ficava pendente até alguém da
 * loja dar baixa à mão.
 *
 * ── Quem pode dar baixa em quê ──────────────────────────────────────────────
 *
 * A credencial aqui é a amarração: só se entrega pedido que está ATRIBUÍDO a
 * este motoboy NESTA loja. Um orderId de outra loja, ou de outro entregador,
 * não passa — é o mesmo vínculo que decide para quem o pedido aparece no app.
 *
 * ── Entregar não é só mudar status ──────────────────────────────────────────
 *
 * A rota do painel avisa o parceiro (iFood conclude, Jotajá delivered, 99Food
 * delivered), dispara o WhatsApp do cliente e conta a venda no faturamento.
 * Dar baixa por aqui sem esses efeitos deixaria o pedido "entregue" no FireHub
 * e aberto no parceiro — no 99Food, pedido aberto é cancelado por eles. Então
 * os mesmos efeitos rodam aqui, e nenhum deles pode derrubar a baixa em si:
 * falha de sync vira log, não erro para o entregador na rua.
 */
export async function PATCH(req: NextRequest) {
  try {
    const { orderId, motoboyId, storeId } = await req.json().catch(() => ({} as any));
    if (!orderId || !motoboyId || !storeId) {
      return NextResponse.json({ error: "orderId, motoboyId e storeId são obrigatórios" }, { status: 400 });
    }

    const order = await prisma.customerOrder.findFirst({
      where: { id: String(orderId), franchiseeId: String(storeId), motoboyId: String(motoboyId) },
    });
    if (!order) {
      return NextResponse.json(
        { error: "Pedido não encontrado para este entregador nesta loja." },
        { status: 404 }
      );
    }

    if (order.status === "ENTREGUE" || order.status === "ENCERRADO") {
      return NextResponse.json({ success: true, jaEntregue: true });
    }
    if (order.status === "CANCELADO" || order.status === "CANCELED") {
      return NextResponse.json({ error: "Este pedido foi CANCELADO — não entregue. Confirme com a loja." }, { status: 409 });
    }

    await prisma.customerOrder.update({
      where: { id: order.id },
      data: { status: "ENTREGUE", kdsStage: "FINISHED", kdsStationId: null },
    });

    // ── Efeitos da entrega, em segundo plano ────────────────────────────────
    // O entregador está na porta do cliente com o celular na mão: a resposta
    // não espera parceiro nenhum. Cada efeito falha sozinho e vira log.
    (async () => {
      // iFood: conclude fecha o pedido (dispatch antes, se for entrega).
      if ((order as any).ifoodOrderId) {
        try {
          const { getIfoodToken } = await import("@/lib/ifood-api");
          const token = await getIfoodToken();
          const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
          const baseUrl = `https://merchant-api.ifood.com.br/order/v1.0/orders/${(order as any).ifoodOrderId}`;
          if (order.deliveryType === "DELIVERY") {
            await fetch(`${baseUrl}/dispatch`, { method: "POST", headers }).catch(() => {});
          }
          const r = await fetch(`${baseUrl}/conclude`, { method: "POST", headers, body: JSON.stringify({}) });
          console.log(`[Motoboy Entrega → iFood] conclude ${(order as any).ifoodOrderId}: ${r.status}`);
        } catch (e: any) {
          console.warn("[Motoboy Entrega → iFood] erro:", e?.message);
        }
      }

      // 99Food e Jotajá dividem o campo openDeliveryOrderId; o canal separa.
      if ((order as any).openDeliveryOrderId) {
        try {
          const { ehPedido99Food, sincronizar99Food } = await import("@/lib/food99-status");
          if (ehPedido99Food(order as any)) {
            await sincronizar99Food(
              {
                openDeliveryOrderId: (order as any).openDeliveryOrderId,
                franchiseeId: order.franchiseeId,
                status: order.status,
                deliveryBy: (order as any).deliveryBy,
              },
              "ENTREGUE"
            );
          } else {
            const { jotajaMutate } = await import("@/lib/jotaja-api");
            const r = await jotajaMutate(`/v1/orders/${(order as any).openDeliveryOrderId}/delivered`, { method: "POST" }, order.franchiseeId);
            console.log(`[Motoboy Entrega → Jotajá] delivered ${(order as any).openDeliveryOrderId}: ${r.status}`);
          }
        } catch (e: any) {
          console.warn("[Motoboy Entrega → parceiro] erro:", e?.message);
        }
      }

      // Cliente fica sabendo que chegou; venda entra no ciclo do faturamento.
      try {
        const { sendOrderNotification } = await import("@/lib/order-notifications");
        sendOrderNotification(order.id, "ENTREGUE").catch(() => {});
      } catch {}
      try {
        const { trackSaleForBilling } = await import("@/lib/billing");
        trackSaleForBilling(order.franchiseeId).catch(() => {});
      } catch {}
    })();

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("[Motoboy Orders PATCH Error]", err);
    return NextResponse.json({ error: "Erro ao confirmar a entrega" }, { status: 500 });
  }
}
