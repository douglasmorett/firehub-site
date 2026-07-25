import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const users = await prisma.user.findMany({
      where: {
        OR: [
          { email: { contains: "hakim", mode: "insensitive" } },
          { jotajaConnected: true },
          { role: { in: ["FRANQUEADO", "ADMIN", "LOJA", "FRANCHISEE", "STAFF"] } }
        ]
      },
      select: { id: true, email: true, role: true, ownerId: true }
    });

    const targetUser = users.find(u => u.email.toLowerCase() === "contatohakim@gmail.com") || users[0];
    if (!targetUser) return NextResponse.json({ error: "No target user found" });

    const primaryFranchiseeId = targetUser.ownerId || targetUser.id;

    // Delete existing Luana items & orders
    await (prisma.customerOrderItem as any).deleteMany({
      where: {
        order: {
          OR: [
            { openDeliveryOrderId: "32516601" },
            { openDeliveryReference: "2316" },
            { customerPhone: "22992536804" }
          ]
        }
      }
    });

    await (prisma.customerOrder as any).deleteMany({
      where: {
        OR: [
          { openDeliveryOrderId: "32516601" },
          { openDeliveryReference: "2316" },
          { customerPhone: "22992536804" }
        ]
      }
    });

    // Create order with status ACEITO (Em Produção) at NOW timestamp
    const newOrder = await (prisma.customerOrder as any).create({
      data: {
        franchiseeId: primaryFranchiseeId,
        customerName: "Luana",
        customerPhone: "22992536804",
        customerAddress: "Rua André Fillipe Ribeiro da Silva 693 Casa 2 - Costa Azul",
        deliveryType: "DELIVERY",
        paymentMethod: "Cartão Débito",
        totalAmount: 61.99,
        deliveryFee: 0,
        status: "ACEITO", // Status ACEITO -> Fica na 1ª coluna "Em Produção"!
        source: "JOTAJA",
        openDeliveryOrderId: "32516601",
        openDeliveryReference: "2316",
        openDeliveryChannel: "JOTAJA",
        notes: "Pedido JotaJá #2316 - Luana",
        createdAt: new Date(), // Horário atual -> Entra no FINAL da 1ª coluna
        items: {
          create: [
            {
              price: 61.99,
              quantity: 1,
              menuProduct: {
                connectOrCreate: {
                  where: { id: "jotaja-2316-luana" },
                  create: {
                    id: "jotaja-2316-luana",
                    franchiseeId: primaryFranchiseeId,
                    name: "Pedido JotaJá #2316 - Luana (R$ 61,99)",
                    description: "Itens do pedido JotaJá #2316",
                    price: 61.99,
                    category: "Jotajá",
                    active: true,
                  }
                }
              }
            }
          ]
        }
      }
    });

    return NextResponse.json({
      ok: true,
      message: "Pedido da Luana criado na 1ª coluna (Em Produção) no final da fila!",
      orderId: newOrder.id,
      status: newOrder.status,
      franchiseeId: primaryFranchiseeId
    });
  } catch (err: any) {
    console.error("[Move Luana Producao] Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
