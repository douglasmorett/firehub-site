import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * ENDPOINT TEMPORÁRIO — Atualiza pedidos cujas cobranças Asaas foram recriadas.
 * Deve ser chamado UMA vez por um ADMIN e depois deletado.
 * GET /api/admin/fix-payment-links
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || (session.user as any).role !== "ADMIN") {
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }

    const updates = [
      { ref: "TUZRU9", paymentId: "pay_ix3zg9b64htek2ew", boletoUrl: "https://www.asaas.com/i/ix3zg9b64htek2ew" },
      { ref: "68N2SX", paymentId: "pay_tfgdm13m1kud2cn2", boletoUrl: "https://www.asaas.com/i/tfgdm13m1kud2cn2" },
      { ref: "WP4VS3", paymentId: "pay_n3u6zn2x9hujxawb", boletoUrl: "https://www.asaas.com/i/n3u6zn2x9hujxawb" },
      { ref: "9WXNO7", paymentId: "pay_9l20d8yvpgfzervx", boletoUrl: "https://www.asaas.com/i/9l20d8yvpgfzervx" },
    ];

    const results: any[] = [];

    for (const u of updates) {
      // Busca o pedido cujo ID termina com a referência
      const order = await prisma.order.findFirst({
        where: { id: { endsWith: u.ref.toLowerCase() } },
        select: { id: true, asaasPaymentId: true, boletoUrl: true },
      });

      // Tenta também com case insensitive - IDs são cuid() em lowercase
      const orderAlt = order || await prisma.order.findFirst({
        where: { id: { contains: u.ref.toLowerCase() } },
        select: { id: true, asaasPaymentId: true, boletoUrl: true },
      });

      const found = order || orderAlt;

      if (found) {
        await prisma.order.update({
          where: { id: found.id },
          data: { asaasPaymentId: u.paymentId, boletoUrl: u.boletoUrl },
        });
        results.push({ ref: u.ref, orderId: found.id, status: "updated", oldPaymentId: found.asaasPaymentId });
      } else {
        results.push({ ref: u.ref, status: "not_found" });
      }
    }

    return NextResponse.json({ success: true, results });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
