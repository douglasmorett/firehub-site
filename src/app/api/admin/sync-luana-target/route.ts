import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // 1. Get all Hakim / store users to find targetFranchiseeId
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
    if (!targetUser) return NextResponse.json({ error: "No target user found", users });

    const targetFranchiseeId = targetUser.ownerId || targetUser.id;

    // Delete any existing Luana order
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

    // Create Luana's order linked directly to targetFranchiseeId and ALL associated user IDs!
    const createdOrders: any[] = [];
    const userIdsToAttach = Array.from(new Set([targetFranchiseeId, targetUser.id, ...users.map(u => u.id)]));

    for (const fid of userIdsToAttach) {
      const o = await (prisma.customerOrder as any).create({
        data: {
          franchiseeId: fid,
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
          createdAt: new Date(), // NOW -> Last in queue (#138)
          items: {
            create: [
              {
                price: 61.99,
                quantity: 1,
                menuProduct: {
                  connectOrCreate: {
                    where: { id: `jotaja-2316-${fid}` },
                    create: {
                      id: `jotaja-2316-${fid}`,
                      franchiseeId: fid,
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
      createdOrders.push(o);

      try {
        const { pushJobToPrintQueue } = await import("@/app/api/store/print-queue/route");
        pushJobToPrintQueue(fid, o, "HAKIM RIO DAS OSTRAS");
      } catch (e) {}
    }

    return NextResponse.json({
      ok: true,
      message: "Pedido da Luana #2316 inserido com sucesso para TODOS os IDs de loja!",
      targetFranchiseeId,
      users,
      createdOrdersCount: createdOrders.length
    });
  } catch (err: any) {
    console.error("[Sync Luana Target] Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
