"use server";

import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { createAsaasPayment } from "@/lib/asaas";

export async function approveEmergencyOrder(orderId: string) {
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role;
  if (!session || (role !== "ADMIN" && role !== "STAFF")) {
    throw new Error("Não autorizado");
  }

  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { user: true } });
  if (!order) throw new Error("Pedido não encontrado");

  // Gerar boleto Asaas automaticamente após aprovação
  const shortId = order.id.slice(-6).toUpperCase();
  let boletoUrl: string | null = null;
  let asaasPaymentId: string | null = null;

  const asaasResult = await createAsaasPayment({
    userName: order.user.name || order.user.email || "",
    userEmail: order.user.email || "",
    cpfCnpj: order.user.cpfCnpj || "",
    totalAmount: order.totalAmount,
    orderId: order.id,
    description: `Pedido de Emergência #${shortId} — Hakim Congelados`
  });

  if (asaasResult) {
    boletoUrl = asaasResult.boletoUrl;
    asaasPaymentId = asaasResult.paymentId;
  }

  await prisma.order.update({
    where: { id: orderId },
    data: {
      status: "PENDING_PAYMENT",
      emergencyStatus: "APPROVED",
      boletoUrl,
      asaasPaymentId
    }
  });

  await prisma.orderHistory.create({
    data: {
      orderId,
      statusFrom: "EMERGENCIA_PENDENTE",
      statusTo: "PENDING_PAYMENT",
      actionBy: session?.user?.name || "Admin",
      actionEmail: session?.user?.email || "",
      notes: "Emergência Aprovada e Boleto Gerado"
    }
  });

  revalidatePath("/admin/orders");
  return { success: true };
}

export async function rejectEmergencyOrder(orderId: string, reason: string) {
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role;
  if (!session || (role !== "ADMIN" && role !== "STAFF")) {
    throw new Error("Não autorizado");
  }

  await prisma.order.update({
    where: { id: orderId },
    data: {
      status: "CANCELADO",
      emergencyStatus: "REJECTED",
      rejectionReason: reason
    }
  });

  await prisma.orderHistory.create({
    data: {
      orderId,
      statusFrom: "EMERGENCIA_PENDENTE",
      statusTo: "CANCELADO",
      actionBy: session?.user?.name || "Admin",
      actionEmail: session?.user?.email || "",
      notes: `Emergência Reprovada: ${reason}`
    }
  });

  revalidatePath("/admin/orders");
  return { success: true };
}
