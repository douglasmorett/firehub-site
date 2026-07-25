import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const franchisee = await prisma.user.findFirst({
      where: { role: { in: ["FRANQUEADO", "ADMIN", "LOJA"] } }
    });

    if (!franchisee) {
      return NextResponse.json({ ok: false, error: "Nenhum usuário encontrado" });
    }

    // Order 1: Hewller (#2280 / 32511181)
    const order1 = await prisma.customerOrder.upsert({
      where: { openDeliveryOrderId: "32511181" },
      update: {
        status: "ACEITO",
        customerName: "Hewller",
        customerPhone: "22997016114",
        customerAddress: "Rua Acerbal Pinto Malheiros 451 Casa 2 - Chácara Mariléa",
        totalAmount: 56.79,
        paymentMethod: "Dinheiro",
      },
      create: {
        franchiseeId: franchisee.id,
        source: "JOTAJA",
        openDeliveryChannel: "JOTAJA",
        openDeliveryOrderId: "32511181",
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
                  where: { id: "jotaja-item-2280" },
                  create: {
                    id: "jotaja-item-2280",
                    franchiseeId: franchisee.id,
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

    return NextResponse.json({ ok: true, message: "Pedidos do JotaJá sincronizados no banco de dados!", orders: [order1] });
  } catch (err: any) {
    console.error("[Sync JotaJa Pending] Erro:", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
