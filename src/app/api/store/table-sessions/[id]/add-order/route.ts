import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateDailyOrderNumber } from "@/lib/order-number";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const dbUser = await prisma.user.findUnique({
      where: { email: session.user.email! },
      select: { id: true, ownerId: true }
    });
    if (!dbUser) return NextResponse.json({ error: "User not found" }, { status: 404 });
    const targetFranchiseeId = dbUser.ownerId || dbUser.id;

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
        pushJobToPrintQueue(targetFranchiseeId, fullOrder, dbUser.ownerId ? "FIREHUB" : "HAKIM RIO DAS OSTRAS");
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
