import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const allUsers = await prisma.user.findMany({
      select: { id: true, email: true, name: true, role: true }
    });

    const createdOrders: any[] = [];

    for (const u of allUsers) {
      await prisma.user.update({
        where: { id: u.id },
        data: { jotajaMerchantId: "22238", jotajaConnected: true }
      }).catch(() => {});

      const orderKey = `32522836_${u.id}`;

      const existing = await prisma.customerOrder.findFirst({
        where: { openDeliveryOrderId: orderKey }
      });

      if (!existing) {
        const ord = await prisma.customerOrder.create({
          data: {
            franchiseeId: u.id,
            source: "JOTAJA",
            openDeliveryChannel: "JOTAJA",
            openDeliveryOrderId: orderKey,
            openDeliveryReference: "2366",
            customerName: "Thiago",
            customerPhone: "22998023663",
            customerAddress: "Rua Toninho de Almeida 60 - Liberdade",
            totalAmount: 35.39,
            deliveryFee: 0,
            paymentMethod: "Cartão de Débito",
            deliveryType: "DELIVERY",
            status: "NOVO",
            notes: "Pedido JotaJá #2366 | Id: 32522836",
            createdAt: new Date(),
            items: {
              create: [
                {
                  quantity: 1,
                  price: 35.39,
                  menuProduct: {
                    connectOrCreate: {
                      where: { id: `jotaja-item-2366_${u.id}` },
                      create: {
                        id: `jotaja-item-2366_${u.id}`,
                        franchiseeId: u.id,
                        name: "Pedido JotaJá #2366",
                        description: "Pedido JotaJá #2366",
                        price: 35.39,
                        category: "JotaJá",
                      }
                    }
                  }
                }
              ]
            }
          }
        });
        createdOrders.push(ord);

        // Enfileira impressão na nuvem
        try {
          const { pushJobToPrintQueue } = await import("@/app/api/store/print-queue/route");
          pushJobToPrintQueue(u.id, ord, "HAKIM RIO DAS OSTRAS");
        } catch {}
      }
    }

    return NextResponse.json({
      ok: true,
      message: `SUCESSO! Pedido #2366 (Thiago) inserido com sucesso!`,
      createdCount: createdOrders.length
    });
  } catch (err: any) {
    console.error("[Insert Thiago Order] Erro:", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
