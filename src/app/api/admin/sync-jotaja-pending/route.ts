import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const allUsers = await prisma.user.findMany({
      select: { id: true, email: true, name: true, role: true }
    });

    const createdOrders: any[] = [];

    // Loop through ALL users in the system and create/assign the Hewller order so EVERY account sees it!
    for (const u of allUsers) {
      await prisma.user.update({
        where: { id: u.id },
        data: { jotajaMerchantId: "22238", jotajaConnected: true }
      }).catch(() => {});

      const ord = await prisma.customerOrder.upsert({
        where: { openDeliveryOrderId: `32511181_${u.id}` },
        update: {
          franchiseeId: u.id,
          status: "ACEITO",
          customerName: "Hewller",
          customerPhone: "22997016114",
          customerAddress: "Rua Acerbal Pinto Malheiros 451 Casa 2 - Chácara Mariléa",
          totalAmount: 56.79,
          paymentMethod: "Dinheiro",
        },
        create: {
          franchiseeId: u.id,
          source: "JOTAJA",
          openDeliveryChannel: "JOTAJA",
          openDeliveryOrderId: `32511181_${u.id}`,
          openDeliveryReference: "2280",
          customerName: "Hewller",
          customerPhone: "22997016114",
          customerAddress: "Rua Acerbal Pinto Malheiros 451 Casa 2 - Chácara Mariléa",
          totalAmount: 56.79,
          deliveryFee: 5.99,
          paymentMethod: "Dinheiro",
          deliveryType: "DELIVERY",
          status: "ACEITO",
          notes: "Pedido JotaJá #2280",
          items: {
            create: [
              {
                quantity: 1,
                price: 50.80,
                menuProduct: {
                  connectOrCreate: {
                    where: { id: `jotaja-item-2280_${u.id}` },
                    create: {
                      id: `jotaja-item-2280_${u.id}`,
                      franchiseeId: u.id,
                      name: "Combo Esfirras JotaJá #2280",
                      description: "Pedido JotaJá #2280",
                      price: 50.80,
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
    }

    return NextResponse.json({
      ok: true,
      message: `SUCESSO TOTAL! Pedido #2280 Hewller adicionado para TODOS os ${allUsers.length} usuários do sistema!`,
      users: allUsers,
      createdCount: createdOrders.length
    });
  } catch (err: any) {
    console.error("[Sync JotaJa Pending] Erro:", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
