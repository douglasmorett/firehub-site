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

    if (!franchisee) return NextResponse.json({ error: "Franqueado não encontrado" }, { status: 404 });

    const targetFranchiseeId = franchisee.ownerId || franchisee.id;

    // Encontrar ou criar Motoboy "Lucas"
    let lucasMotoboy = await prisma.motoboy.findFirst({
      where: {
        franchiseeId: targetFranchiseeId,
        name: { contains: "Lucas", mode: "insensitive" }
      }
    });

    if (!lucasMotoboy) {
      lucasMotoboy = await prisma.motoboy.create({
        data: {
          franchiseeId: targetFranchiseeId,
          name: "Lucas",
          phone: "22992536804",
          active: true
        }
      });
    }

    // Apagar qualquer registro solto anterior da Luana
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

    // Criar pedido da Luana com status SAIU_ENTREGA e Entregador Lucas no FINAL DA FILA
    const newOrder = await (prisma.customerOrder as any).create({
      data: {
        franchiseeId: targetFranchiseeId,
        customerName: "Luana",
        customerPhone: "22992536804",
        customerAddress: "Rua André Fillipe Ribeiro da Silva 693 Casa 2 - Costa Azul",
        deliveryType: "DELIVERY",
        paymentMethod: "Cartão Débito",
        totalAmount: 61.99,
        deliveryFee: 0,
        status: "SAIU_ENTREGA", // Status: Saiu para Entrega
        motoboyId: lucasMotoboy.id, // Motoboy: Lucas
        source: "JOTAJA",
        openDeliveryOrderId: "32516601",
        openDeliveryReference: "2316",
        openDeliveryChannel: "JOTAJA",
        notes: "Pedido JotaJá #2316 - Luana (Saiu para entrega com Lucas)",
        createdAt: new Date(), // Horário atual -> Final da fila
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
                    franchiseeId: targetFranchiseeId,
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
      message: "Pedido da Luana inserido no final da fila como SAIU PARA ENTREGA com o entregador Lucas!",
      orderId: newOrder.id,
      motoboy: lucasMotoboy.name,
      status: newOrder.status
    });
  } catch (err: any) {
    console.error("[Luana Out For Delivery] Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
