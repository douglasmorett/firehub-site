"use server";

import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";

export async function cancelOrder(orderId: string, adminPassword?: string, reason?: string) {
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role;

  if (!session || !session.user || (role !== "ADMIN" && role !== "STAFF")) {
    throw new Error("Não autorizado.");
  }

  if (!adminPassword) {
    throw new Error("Senha de acesso não fornecida.");
  }

  if (!reason) {
    throw new Error("O motivo do cancelamento é obrigatório.");
  }

  // Buscar o usuário logado para validar a senha
  const currentUser = await prisma.user.findUnique({
    where: { email: session.user.email! }
  });

  if (!currentUser) {
    throw new Error("Usuário não encontrado.");
  }

  // Verifica a senha
  const passwordMatch = await bcrypt.compare(adminPassword, currentUser.password);
  if (!passwordMatch) {
    throw new Error("Senha incorreta. O pedido não foi cancelado.");
  }

  // Buscar o pedido
  const order = await prisma.order.findUnique({
    where: { id: orderId }
  });

  if (!order) {
    throw new Error("Pedido não encontrado.");
  }

  const oldStatus = order.status;

  if (oldStatus === "CANCELADO") {
    throw new Error("Pedido já está cancelado.");
  }

  // Se o pedido possui um ID de pagamento no Asaas, tentamos cancelar lá primeiro
  if (order.asaasPaymentId) {
    const asaasKey = process.env.ASAAS_API_KEY;
    if (asaasKey) {
      const ASAAS_URL = asaasKey.startsWith("$aact_prod")
        ? "https://api.asaas.com/v3"
        : "https://sandbox.asaas.com/v3";

      const res = await fetch(`${ASAAS_URL}/payments/${order.asaasPaymentId}`, {
        method: "DELETE",
        headers: {
          "access_token": asaasKey,
          "User-Agent": "HakimPortal/1.0"
        }
      });
      
      const data = await res.json();
      
      if (!res.ok && data.errors && data.errors[0].code !== "invalid_action") {
         console.warn("Aviso ao deletar cobrança no Asaas:", data.errors);
         throw new Error("Falha ao remover boleto no Asaas: " + data.errors[0].description);
      }
    }
  }

  await prisma.order.update({
    where: { id: orderId },
    data: { 
      status: "CANCELADO",
      cancelReason: reason
    }
  });

  // Registrar histórico
  await prisma.orderHistory.create({
    data: {
      orderId,
      statusFrom: oldStatus,
      statusTo: "CANCELADO",
      actionBy: session.user?.name || "Sistema",
      actionEmail: session.user?.email || "",
      notes: reason
    }
  });

  revalidatePath("/admin/orders");
  revalidatePath("/store/orders");
}
