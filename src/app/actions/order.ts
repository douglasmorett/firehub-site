"use server";

import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { getAsaasKey } from "@/lib/asaas";

export async function updateOrderStatus(orderId: string, newStatus: string, notes?: string) {
  const session = await getServerSession(authOptions);
  
  if (!session || ((session.user as any)?.role !== "ADMIN" && (session.user as any)?.role !== "STAFF")) {
    throw new Error("Não autorizado");
  }

  const oldOrder = await prisma.order.findUnique({
    where: { id: orderId },
    select: { status: true, asaasPaymentId: true }
  });

  if (!oldOrder) throw new Error("Pedido não encontrado");

  // Se está mudando para CANCELADO e tem pagamento no Asaas, cancela lá também
  if (newStatus === "CANCELADO" && oldOrder.asaasPaymentId) {
    const asaasKey = getAsaasKey();
    if (asaasKey) {
      const ASAAS_URL = asaasKey.startsWith("$aact_prod")
        ? "https://api.asaas.com/v3"
        : "https://sandbox.asaas.com/v3";

      try {
        const res = await fetch(`${ASAAS_URL}/payments/${oldOrder.asaasPaymentId}`, {
          method: "DELETE",
          headers: {
            "access_token": asaasKey,
            "User-Agent": "FireHubPortal/1.0"
          }
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok || data.deleted) {
          console.log(`[updateOrderStatus] ✅ Cobrança ${oldOrder.asaasPaymentId} cancelada no Asaas.`);
        } else {
          console.warn(`[updateOrderStatus] ⚠️ Aviso ao cancelar no Asaas:`, JSON.stringify(data));
        }
      } catch (asaasErr) {
        console.error(`[updateOrderStatus] ❌ Erro de rede ao cancelar no Asaas:`, asaasErr);
      }
    }
  }

  await prisma.order.update({
    where: { id: orderId },
    data: { 
      status: newStatus,
      // Se for cancelamento por outro método que não o cancelOrder específico
      ...(newStatus === "CANCELADO" && notes ? { cancelReason: notes } : {})
    }
  });

  // Registrar histórico
  await prisma.orderHistory.create({
    data: {
      orderId,
      statusFrom: oldOrder.status,
      statusTo: newStatus,
      actionBy: session.user?.name || "Sistema",
      actionEmail: session.user?.email || "",
      notes: notes || null
    }
  });

  revalidatePath("/admin/orders");
  revalidatePath("/store/orders");
}
