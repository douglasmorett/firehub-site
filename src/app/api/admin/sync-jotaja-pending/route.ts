import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const allUsers = await prisma.user.findMany({
      select: { id: true, email: true, name: true, role: true }
    });

    const inserted: any[] = [];

    for (const u of allUsers) {
      // 1. Pedido Renata Nunes #3095 (32626144)
      const ord1 = await prisma.customerOrder.upsert({
        where: { openDeliveryOrderId: `32626144_${u.id}` },
        update: {
          franchiseeId: u.id,
          status: "NOVO",
          kdsStage: "PRODUCTION",
          customerName: "Renata Nunes",
          customerPhone: "21995287212",
          customerAddress: "Rua João Vianna 199 Casa 3 - Nova Esperança",
          totalAmount: 49.85,
          deliveryFee: 4.99,
          paymentMethod: "Débito",
        },
        create: {
          franchiseeId: u.id,
          source: "JOTAJA",
          openDeliveryChannel: "JOTAJA",
          openDeliveryOrderId: `32626144_${u.id}`,
          openDeliveryReference: "3095",
          customerName: "Renata Nunes",
          customerPhone: "21995287212",
          customerAddress: "Rua João Vianna 199 Casa 3 - Nova Esperança",
          totalAmount: 49.85,
          deliveryFee: 4.99,
          paymentMethod: "Débito",
          deliveryType: "DELIVERY",
          status: "NOVO",
          kdsStage: "PRODUCTION",
          kdsProductionAt: new Date(),
          notes: "1 x Combo 10 Esfirras Simples + 2 Bebidas R$ 44,86 (5x Carne, 3x Calabresa, 2x Chocolate Ao Leite), 2x Coca-Cola lata. Obs: Pode ser refrigerante zero?",
          items: {
            create: [
              {
                quantity: 1,
                price: 44.86,
                menuProduct: {
                  connectOrCreate: {
                    where: { id: `jotaja-item-3095_${u.id}` },
                    create: {
                      id: `jotaja-item-3095_${u.id}`,
                      franchiseeId: u.id,
                      name: "Combo 10 Esfirras Simples + 2 Bebidas",
                      description: "5x Carne, 3x Calabresa, 2x Chocolate Ao Leite",
                      price: 44.86,
                      category: "JotaJá",
                    }
                  }
                }
              }
            ]
          }
        }
      });
      inserted.push(ord1);

      // 2. Pedido Queilor Barcelos #3115 (32628794)
      const ord2 = await prisma.customerOrder.upsert({
        where: { openDeliveryOrderId: `32628794_${u.id}` },
        update: {
          franchiseeId: u.id,
          status: "NOVO",
          kdsStage: "PRODUCTION",
          customerName: "Queilor Barcelos",
          customerPhone: "22992376032",
          customerAddress: "Rua dos LÍrios 2002 Casa, portão marrom de madeira - Âncora",
          totalAmount: 71.77,
          paymentMethod: "Crédito",
        },
        create: {
          franchiseeId: u.id,
          source: "JOTAJA",
          openDeliveryChannel: "JOTAJA",
          openDeliveryOrderId: `32628794_${u.id}`,
          openDeliveryReference: "3115",
          customerName: "Queilor Barcelos",
          customerPhone: "22992376032",
          customerAddress: "Rua dos LÍrios 2002 Casa, portão marrom de madeira - Âncora",
          totalAmount: 71.77,
          deliveryFee: 5.99,
          paymentMethod: "Crédito",
          deliveryType: "DELIVERY",
          status: "NOVO",
          kdsStage: "PRODUCTION",
          kdsProductionAt: new Date(),
          notes: "Portão marrom de madeira - Âncora",
          items: {
            create: [
              {
                quantity: 1,
                price: 65.78,
                menuProduct: {
                  connectOrCreate: {
                    where: { id: `jotaja-item-3115_${u.id}` },
                    create: {
                      id: `jotaja-item-3115_${u.id}`,
                      franchiseeId: u.id,
                      name: "Pedido JotaJá #3115",
                      description: "Portão marrom de madeira - Âncora",
                      price: 65.78,
                      category: "JotaJá",
                    }
                  }
                }
              }
            ]
          }
        }
      });
      inserted.push(ord2);
    }

    return NextResponse.json({
      ok: true,
      message: `SUCESSO! Pedidos Jotajá #3095 (Renata Nunes) e #3115 (Queilor Barcelos) inseridos/sincronizados com sucesso no sistema!`,
      insertedCount: inserted.length
    });
  } catch (err: any) {
    console.error("[Sync JotaJa Pending] Erro:", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
