import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    // 1. Find all users in DB
    const allUsers = await prisma.user.findMany({
      select: { id: true, email: true, name: true, role: true }
    });

    // 2. Locate contatohakim user explicitly
    let franchisee = allUsers.find(u => u.email?.toLowerCase().includes("contatohakim"))
                  || allUsers.find(u => u.email?.toLowerCase().includes("hakim"))
                  || allUsers[0];

    if (!franchisee) {
      return NextResponse.json({ ok: false, error: "Nenhum usuário encontrado" });
    }

    // 3. Update franchisee user to connect JotaJá
    await prisma.user.update({
      where: { id: franchisee.id },
      data: { jotajaMerchantId: "22238", jotajaConnected: true }
    });

    // 4. Update ALL orders for openDeliveryOrderId 32511181 OR openDeliveryReference 2280 OR source JOTAJA to belong to this franchisee
    await prisma.customerOrder.updateMany({
      where: {
        OR: [
          { openDeliveryOrderId: "32511181" },
          { openDeliveryReference: "2280" },
          { source: "JOTAJA" }
        ]
      },
      data: { franchiseeId: franchisee.id }
    });

    // 5. Upsert Hewller order
    const order1 = await prisma.customerOrder.upsert({
      where: { openDeliveryOrderId: "32511181" },
      update: {
        franchiseeId: franchisee.id,
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

    return NextResponse.json({
      ok: true,
      message: `SUCESSO! Pedido #2280 Hewller atribuído ao usuário ${franchisee.email} (${franchisee.id})`,
      targetUser: franchisee,
      allUsers,
      order: order1
    });
  } catch (err: any) {
    console.error("[Sync JotaJa Pending] Erro:", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
