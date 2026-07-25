import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const existing = await prisma.customerOrder.findFirst({
      where: {
        OR: [
          { openDeliveryOrderId: "32516601" },
          { openDeliveryReference: "2316" },
          { customerPhone: "22992536804" }
        ]
      }
    });

    if (existing) {
      // Set createdAt to NOW (latest timestamp in DB)
      const updated = await (prisma.customerOrder as any).update({
        where: { id: existing.id },
        data: { createdAt: new Date() }
      });
      return NextResponse.json({ ok: true, message: "Pedido da Luana movido para o FINAL ABSOLUTO da fila (#139)!", orderId: updated.id, createdAt: updated.createdAt });
    }

    // If not found, find franchisee and create
    const franchisee = await prisma.user.findFirst({
      where: { email: "contatohakim@gmail.com" }
    });

    if (!franchisee) return NextResponse.json({ error: "Franqueado não encontrado" }, { status: 404 });

    const newOrder = await (prisma.customerOrder as any).create({
      data: {
        franchiseeId: franchisee.id,
        customerName: "Luana",
        customerPhone: "22992536804",
        customerAddress: "Rua André Fillipe Ribeiro da Silva 693 Casa 2 - Costa Azul",
        deliveryType: "DELIVERY",
        paymentMethod: "Cartão Débito",
        totalAmount: 61.99,
        deliveryFee: 0,
        status: "ACEITO",
        source: "JOTAJA",
        openDeliveryOrderId: "32516601",
        openDeliveryReference: "2316",
        openDeliveryChannel: "JOTAJA",
        notes: "Pedido JotaJá #2316 - Luana",
        createdAt: new Date(),
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
                    franchiseeId: franchisee.id,
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

    return NextResponse.json({ ok: true, message: "Pedido da Luana criado no FINAL ABSOLUTO da fila (#139)!", orderId: newOrder.id });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
