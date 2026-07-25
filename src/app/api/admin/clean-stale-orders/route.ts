import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000);

    // Encontrar pedidos criados há mais de 12h que ainda estão em NOVO, ACEITO ou PREPARANDO
    const staleOrders = await prisma.customerOrder.updateMany({
      where: {
        createdAt: { lt: twelveHoursAgo },
        status: { in: ["NOVO", "ACEITO", "PREPARANDO"] }
      },
      data: {
        status: "ENCERRADO"
      }
    });

    return NextResponse.json({
      ok: true,
      message: `Encerrados ${staleOrders.count} pedidos antigos criados há mais de 12 horas.`,
      count: staleOrders.count
    });
  } catch (err: any) {
    console.error("[Clean Stale Orders] Erro:", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
