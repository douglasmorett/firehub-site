import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolverOperadorDaMesa } from "@/lib/garcom-auth";
import { generateDailyOrderNumber } from "@/lib/order-number";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Sessão do painel OU cookie do garçom pelo link (src/lib/garcom-auth.ts).
    const operador = await resolverOperadorDaMesa();
    if (!operador) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const targetFranchiseeId = operador.franchiseeId;

    const { id } = await params;
    if (!id) return NextResponse.json({ error: "Session ID is required" }, { status: 400 });

    const data = await req.json();
    const { items, notes, customerName } = data;

    if (!items || items.length === 0) {
      return NextResponse.json({ error: "Items are required" }, { status: 400 });
    }

    const tableSession = await prisma.tableSession.findUnique({
      where: { id },
      include: {
        table: true
      }
    });

    if (!tableSession || tableSession.table.franchiseeId !== targetFranchiseeId) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    if (tableSession.status !== "OPEN") {
      return NextResponse.json({ error: "Session is not open" }, { status: 400 });
    }

    // Só aceita vincular a item quem realmente está NESTA mesa. Sem esta
    // conferência, um id qualquer no corpo da requisição jogaria o consumo na
    // conta de uma pessoa de outra mesa.
    const pedidos = items.map((i: any) => i?.tableGuestId).filter(Boolean);
    const idsValidos = new Set<string>();
    if (pedidos.length > 0) {
      const daMesa = await prisma.tableGuest.findMany({
        where: { id: { in: pedidos }, tableSessionId: id },
        select: { id: true },
      });
      daMesa.forEach((g: any) => idsValidos.add(g.id));
    }

    const dailyOrderNumber = await generateDailyOrderNumber(targetFranchiseeId);
    
    // Calculate total amount for this specific order
    const totalAmount = items.reduce((sum: number, item: any) => sum + (item.price * item.quantity), 0);

    const defaultName = customerName || tableSession.customerName || `Mesa ${tableSession.table.number}`;

    const order = await prisma.customerOrder.create({
      data: {
        franchiseeId: targetFranchiseeId,
        dailyOrderNumber,
        customerName: defaultName,
        customerPhone: "00000000000",
        customerAddress: `Mesa ${tableSession.table.number}`,
        deliveryType: "MESA",
        paymentMethod: "N/A", // Payment happens at session close
        notes: notes || "",
        totalAmount,
        deliveryFee: 0,
        status: "ACEITO",
        source: "PRESENCIAL",
        tableSessionId: id,
        items: {
          create: items.map((item: any) => ({
            menuProductId: item.menuProductId,
            quantity: item.quantity,
            price: item.price,
            // De quem é este item. Nulo = da mesa inteira (couvert, entrada
            // para dividir), e nesse caso entra no rateio geral no fechamento.
            // É o que permite rachar a conta pelo consumo real de cada um em
            // vez de dividir por igual — que é onde alguém sempre paga a
            // bebida do outro.
            tableGuestId: idsValidos.has(item.tableGuestId) ? item.tableGuestId : null,
            comboSelections: item.comboSelections ? (typeof item.comboSelections === "string" ? item.comboSelections : JSON.stringify(item.comboSelections)) : null,
          })),
        },
      },
    });

    // Realiza a baixa imediata no estoque do pedido
    const { deductStockForOrder } = await import("@/lib/stock");
    deductStockForOrder(order.id).catch(err =>
      console.error("[Stock] Erro ao deduzir estoque de pedido de mesa:", err)
    );

    // Enfileira impressão automática
    try {
      const fullOrder = await prisma.customerOrder.findUnique({
        where: { id: order.id },
        include: {
          items: {
            include: {
              menuProduct: { select: { id: true, name: true, isBeverage: true } }
            }
          }
        }
      });

      if (fullOrder) {
        const { pushJobToPrintQueue } = await import("@/app/api/store/print-queue/route");
        pushJobToPrintQueue(targetFranchiseeId, fullOrder, operador.tipo === "loja" && operador.ownerId ? "FIREHUB" : "HAKIM RIO DAS OSTRAS");
      }
    } catch (printErr) {
      console.error("[Mesa] Erro ao enfileirar impressão automática:", printErr);
    }

    return NextResponse.json({ success: true, order });
  } catch (error: any) {
    console.error("[Table Sessions Add Order POST]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
