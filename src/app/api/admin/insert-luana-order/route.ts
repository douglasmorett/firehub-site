import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const franchisee = await prisma.user.findFirst({
      where: {
        OR: [
          { email: "contatohakim@gmail.com" },
          { jotajaConnected: true },
          { role: { in: ["FRANQUEADO", "ADMIN", "LOJA", "FRANCHISEE"] } }
        ]
      }
    });

    if (!franchisee) {
      return NextResponse.json({ error: "Franqueado não encontrado" }, { status: 404 });
    }

    // Atualiza a data de criação do pedido da Luana para AGORA, garantindo que ele fique no FINAL da fila (#138) sem alterar #133..#137
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
      const updated = await (prisma.customerOrder as any).update({
        where: { id: existing.id },
        data: { createdAt: new Date() }
      });
      return NextResponse.json({ ok: true, message: "Pedido da Luana #2316 atualizado para o FINAL da fila (#138)!", orderId: updated.id });
    }

    const newOrder = await prisma.customerOrder.create({
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

    // Auto-enqueue for print
    try {
      const { pushJobToPrintQueue } = await import("@/app/api/store/print-queue/route");
      pushJobToPrintQueue(franchisee.id, newOrder, "HAKIM RIO DAS OSTRAS");
    } catch (e) {}

    return NextResponse.json({ ok: true, message: "Pedido #2316 - Luana INSERIDO com sucesso!", orderId: newOrder.id });
  } catch (err: any) {
    console.error("[Insert Luana Order] Erro:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
