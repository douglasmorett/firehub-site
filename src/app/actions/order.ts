"use server";

import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export async function updateOrderStatus(orderId: string, newStatus: string, notes?: string) {
  const session = await getServerSession(authOptions);
  
  if (!session || ((session.user as any)?.role !== "ADMIN" && (session.user as any)?.role !== "STAFF")) {
    throw new Error("Não autorizado");
  }

  const oldOrder = await prisma.order.findUnique({
    where: { id: orderId },
    select: { status: true }
  });

  if (!oldOrder) throw new Error("Pedido não encontrado");

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
