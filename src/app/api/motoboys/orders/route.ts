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

    // Busca apenas os pedidos pertencentes estritamente a esta loja e atribuídos a este motoboy
    const orders = await prisma.customerOrder.findMany({
      where: {
        franchiseeId: storeId,
        motoboyId: motoboyId,
        status: { notIn: ["CANCELLED", "CANCELED"] }
      },
      orderBy: { createdAt: "desc" },
      take: 50
    });

    return NextResponse.json({ success: true, orders });

  } catch (err: any) {
    console.error("[Motoboy Orders API Error]", err);
    return NextResponse.json({ error: "Erro ao carregar pedidos" }, { status: 500 });
  }
}
