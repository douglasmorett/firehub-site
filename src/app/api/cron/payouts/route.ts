/**
 * GET /api/cron/payouts
 * Processa os repasses automáticos diários/semanais para as contas Pix dos lojistas.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const franchisees = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        storeName: true,
        email: true,
        repasseConfig: true,
      },
    });

    const results: any[] = [];

    for (const f of franchisees) {
      const config = f.repasseConfig as any;
      if (!config || !config.chavePix || config.status === "INATIVO") continue;

      // Calcular o total de vendas online acumuladas a repassar
      const onlineOrders = await prisma.customerOrder.aggregate({
        where: {
          franchiseeId: f.id,
          status: { notIn: ["CANCELADO"] },
          paymentPaidAt: { not: null },
        },
        _sum: {
          totalAmount: true,
          discountIfood: true,
        },
      });

      const grossRevenue = (onlineOrders._sum.totalAmount || 0) + (onlineOrders._sum.discountIfood || 0);

      results.push({
        franchiseeId: f.id,
        storeName: f.storeName || f.name,
        chavePix: config.chavePix,
        tipoChave: config.tipoChave,
        frequencia: config.frequencia || "DAILY",
        horario: config.horario || "03:00",
        totalOnline: grossRevenue,
        status: "SCHEDULED_PAYOUT",
      });
    }

    return NextResponse.json({
      success: true,
      processedStores: results.length,
      payouts: results,
    });
  } catch (err: any) {
    console.error("[Cron Payouts Error]:", err);
    return NextResponse.json({ error: err.message || "Erro no cron de repasses" }, { status: 500 });
  }
}
