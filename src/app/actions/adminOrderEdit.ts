"use server";

import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { createAsaasPayment } from "@/lib/asaas";

export async function adminUpdateOrderItems(orderId: string, items: { productId: string, quantity: number, price?: number }[]) {
  const session = await getServerSession(authOptions);
  
  if (!session || ((session.user as any)?.role !== "ADMIN" && (session.user as any)?.role !== "STAFF")) {
    throw new Error("Não autorizado");
  }

  if (!items || items.length === 0) {
    throw new Error("O pedido não pode ficar vazio.");
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { user: true }
  });

  if (!order) throw new Error("Pedido não encontrado");

  // Fetch products to calculate total
  const productIds = items.map(i => i.productId);
  const dbProducts = await prisma.product.findMany({
    where: { id: { in: productIds } }
  });

  let newTotal = 0;
  const itemsWithPrice = items.map(item => {
    const product = dbProducts.find(p => p.id === item.productId);
    if (!product) throw new Error(`Produto não encontrado.`);
    const itemPrice = item.price !== undefined && item.price > 0 ? item.price : product.price;
    newTotal += itemPrice * item.quantity;
    return {
      productId: product.id,
      quantity: item.quantity,
      price: itemPrice
    };
  });

  // Update Database
  await prisma.$transaction([
    prisma.orderItem.deleteMany({ where: { orderId } }),
    prisma.order.update({
      where: { id: orderId },
      data: {
        totalAmount: newTotal,
        items: {
          create: itemsWithPrice
        }
      }
    }),
    prisma.orderHistory.create({
      data: {
        orderId,
        statusFrom: order.status,
        statusTo: order.status,
        actionBy: session.user?.name || "Admin",
        actionEmail: session.user?.email || "",
        notes: `Admin editou os itens do pedido. Total alterado de R$ ${order.totalAmount.toFixed(2)} para R$ ${newTotal.toFixed(2)}.`
      }
    })
  ]);

  // If order has Asaas payment and is still open, cancel it and recreate
  if (order.asaasPaymentId && order.status === "PENDING_PAYMENT") {
    const asaasKey = process.env.ASAAS_API_KEY;
    if (asaasKey) {
      const ASAAS_URL = asaasKey.startsWith("$aact_prod") 
        ? "https://api.asaas.com/v3" 
        : "https://sandbox.asaas.com/v3";
      
      // 1. Delete old payment
      await fetch(`${ASAAS_URL}/payments/${order.asaasPaymentId}`, {
        method: "DELETE",
        headers: { "access_token": asaasKey }
      });

      // 2. Create new payment using shared function
      const shortId = order.id.slice(-6).toUpperCase();
      const asaasResult = await createAsaasPayment({
        userName: order.user.name || order.user.email || "",
        userEmail: order.user.email || "",
        cpfCnpj: order.user.cpfCnpj || "",
        totalAmount: newTotal,
        orderId: order.id,
        description: `Pedido #${shortId} — Hakim Congelados (Editado)`
      });

      if (asaasResult) {
        await prisma.order.update({
          where: { id: orderId },
          data: { 
            boletoUrl: asaasResult.boletoUrl, 
            asaasPaymentId: asaasResult.paymentId 
          }
        });
      }
    }
  }

  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${orderId}/edit`);
}
