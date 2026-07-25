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

    // Atualizar o pedido da Luana para status SAIU_ENTREGA e motoboy Lucas, com data de criação ATUAL para ficar no FINAL da fila!
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
        data: {
          status: "SAIU_ENTREGA",
          motoboyId: lucasMotoboy.id,
          createdAt: new Date() // Horário atual -> Final da fila
        }
      });

      return NextResponse.json({
        ok: true,
        message: "Pedido da Luana atualizado para SAIU PARA ENTREGA com o entregador Lucas!",
        orderId: updated.id,
        status: updated.status,
        motoboy: lucasMotoboy.name
      });
    }

    // Se por acaso não existir, cria o pedido
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
        status: "SAIU_ENTREGA",
        motoboyId: lucasMotoboy.id,
        source: "JOTAJA",
        openDeliveryOrderId: "32516601",
        openDeliveryReference: "2316",
        openDeliveryChannel: "JOTAJA",
        notes: "Pedido JotaJá #2316 - Luana (Saiu para entrega com Lucas)",
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
      message: "Pedido da Luana criado no final da fila como SAIU PARA ENTREGA com entregador Lucas!",
      orderId: newOrder.id,
      status: newOrder.status,
      motoboy: lucasMotoboy.name
    });
  } catch (err: any) {
    console.error("[Update Luana Status] Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
