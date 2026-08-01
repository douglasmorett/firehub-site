import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const motoboyId = searchParams.get("motoboyId");
    const storeId = searchParams.get("storeId");

    if (!motoboyId || !storeId) {
      return NextResponse.json({ error: "motoboyId e storeId são obrigatórios" }, { status: 400 });
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

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
      orderBy: { createdAt: "desc" },
      take: 100
    });

    return NextResponse.json({ success: true, orders });

  } catch (err: any) {
    console.error("[Motoboy Orders API Error]", err);
    return NextResponse.json({ error: "Erro ao carregar pedidos" }, { status: 500 });
  }
}
