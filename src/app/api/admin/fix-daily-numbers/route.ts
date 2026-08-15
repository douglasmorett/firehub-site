import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateDailyOrderNumber } from "@/lib/order-number";

export async function GET() {
  try {
    const now = new Date();
    const spDateStr = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric", month: "2-digit", day: "2-digit"
    }).format(now);
    const startOfDay = new Date(`${spDateStr}T00:00:00-03:00`);

    const missingOrders = await prisma.customerOrder.findMany({
      where: {
        createdAt: { gte: startOfDay },
        dailyOrderNumber: null,
        status: { notIn: ["CRIANDO_IA", "AGUARDANDO_PAGAMENTO", "CANCELADO"] }
      },
      orderBy: { createdAt: "asc" }
    });

    const fixed = [];

    for (const order of missingOrders) {
      const nextNum = await generateDailyOrderNumber(order.franchiseeId);
      await prisma.customerOrder.update({
        where: { id: order.id },
        data: { dailyOrderNumber: nextNum }
      });
      fixed.push({ id: order.id, customer: order.customerName, assignedNumber: nextNum });
    }

    return NextResponse.json({
      message: `Consertados ${fixed.length} pedidos de hoje que estavam sem numeração.`,
      fixed
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
