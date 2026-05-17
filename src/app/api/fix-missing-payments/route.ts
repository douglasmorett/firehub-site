import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createAsaasPayment } from "@/lib/asaas";

/**
 * POST /api/fix-missing-payments
 * Gera links de pagamento Asaas para pedidos PENDING_PAYMENT sem boletoUrl.
 * Apenas ADMIN pode executar.
 */
export async function POST() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    const role = (session.user as any)?.role;
    if (role !== "ADMIN") {
      return NextResponse.json({ error: "Apenas admin" }, { status: 403 });
    }

    const orders = await prisma.order.findMany({
      where: {
        status: "PENDING_PAYMENT",
        boletoUrl: null,
      },
      include: { user: { select: { cpfCnpj: true, name: true, email: true } } },
    });

    const results: any[] = [];

    for (const order of orders) {
      const shortId = order.id.slice(-6).toUpperCase();
      
      const asaasResult = await createAsaasPayment({
        userName: order.user.name || order.user.email || "",
        userEmail: order.user.email || "",
        cpfCnpj: order.user.cpfCnpj || "",
        totalAmount: order.totalAmount,
        orderId: order.id,
        description: `Pedido #${shortId} — Icebox Congelados`,
      });

      if (asaasResult) {
        await prisma.order.update({
          where: { id: order.id },
          data: {
            boletoUrl: asaasResult.boletoUrl,
            asaasPaymentId: asaasResult.paymentId,
          },
        });
        results.push({ orderId: shortId, status: "OK", url: asaasResult.boletoUrl });
      } else {
        results.push({ orderId: shortId, status: "FAILED" });
      }
    }

    return NextResponse.json({ fixed: results.length, results });
  } catch (error: any) {
    console.error("Erro fix-missing-payments:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
