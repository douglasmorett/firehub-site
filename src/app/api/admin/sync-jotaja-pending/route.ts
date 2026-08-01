import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    // Buscar todos os usuários que são FRANQUEADO, ADMIN ou LOJA
    const storeUsers = await prisma.user.findMany({
      where: {
        OR: [
          { email: "contatohakim@gmail.com" },
          { role: { in: ["FRANQUEADO", "ADMIN", "LOJA"] } }
        ]
      },
      select: { id: true, email: true, name: true, role: true }
    });

    const inserted: any[] = [];

    for (const u of storeUsers) {
      const targetId = u.id;

      // 1. Pedido Renata Nunes #3095 (32626144)
      await prisma.customerOrder.deleteMany({
        where: {
          OR: [
            { openDeliveryOrderId: "32626144" },
            { openDeliveryOrderId: `32626144_${targetId}` }
          ]
        }
      }).catch(() => {});

      const ord1 = await prisma.customerOrder.create({
        data: {
          franchiseeId: targetId,
          source: "JOTAJA",
          openDeliveryChannel: "JOTAJA",
          openDeliveryOrderId: `32626144_${targetId}`,
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
                    where: { id: `jotaja-item-3095_${targetId}` },
                    create: {
                      id: `jotaja-item-3095_${targetId}`,
                      franchiseeId: targetId,
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
      await prisma.customerOrder.deleteMany({
        where: {
          OR: [
            { openDeliveryOrderId: "32628794" },
            { openDeliveryOrderId: `32628794_${targetId}` }
          ]
        }
      }).catch(() => {});

      const ord2 = await prisma.customerOrder.create({
        data: {
          franchiseeId: targetId,
          source: "JOTAJA",
          openDeliveryChannel: "JOTAJA",
          openDeliveryOrderId: `32628794_${targetId}`,
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
                    where: { id: `jotaja-item-3115_${targetId}` },
                    create: {
                      id: `jotaja-item-3115_${targetId}`,
                      franchiseeId: targetId,
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
      message: `SUCESSO TOTAL! Pedidos #3095 (Renata Nunes) e #3115 (Queilor Barcelos) inseridos diretamente no banco para todas as lojas (${storeUsers.length} usuários)!`,
      storeUsers,
      insertedCount: inserted.length
    });
  } catch (err: any) {
    console.error("[Sync JotaJa Pending] Erro:", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
