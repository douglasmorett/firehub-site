import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateDailyOrderNumber } from "@/lib/order-number";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const hakim = await prisma.user.findUnique({
      where: { email: "contatohakim@gmail.com" },
      select: { id: true, email: true, name: true, storeName: true }
    });

    const pastel = await prisma.user.findUnique({
      where: { email: "pasteldapaulistamacae21@gmail.com" },
      select: { id: true, email: true, name: true, storeName: true }
    });

    if (!hakim) {
      return NextResponse.json({ error: "Hakim não encontrado" }, { status: 404 });
    }

    const envMerchantId = process.env.JOTAJA_MERCHANT_ID || "14800";

    // 1. Atualizar credenciais do Hakim no banco
    await prisma.user.update({
      where: { id: hakim.id },
      data: {
        jotajaConnected: true,
        jotajaMerchantId: envMerchantId,
        jotajaClientId: process.env.JOTAJA_CLIENT_ID || undefined,
        jotajaClientSecret: process.env.JOTAJA_CLIENT_SECRET || undefined,
      }
    });

    // 2. Desconectar Jotajá do Pastel da Paulista
    if (pastel) {
      await prisma.user.update({
        where: { id: pastel.id },
        data: {
          jotajaConnected: false,
          jotajaMerchantId: null,
          jotajaClientId: null,
          jotajaClientSecret: null,
        }
      });
    }

    // 3. Mover pedidos de JotaJá que foram parar no Pastel da Paulista para o Hakim (no final da fila)
    let movedCount = 0;
    let movedOrders: any[] = [];

    if (pastel) {
      const leakedOrders = await prisma.customerOrder.findMany({
        where: {
          franchiseeId: pastel.id,
          OR: [
            { openDeliveryOrderId: { not: null } },
            { openDeliveryReference: { not: null } },
            { customerName: { contains: "PATRICK" } },
          ]
        },
        select: { id: true, customerName: true, openDeliveryReference: true, totalAmount: true }
      });

      for (const order of leakedOrders) {
        // Gerar número sequencial no FINAL da fila do Hakim sem colidir com nenhum outro
        const newDailyNumber = await generateDailyOrderNumber(hakim.id);
        await prisma.customerOrder.update({
          where: { id: order.id },
          data: {
            franchiseeId: hakim.id,
            dailyOrderNumber: newDailyNumber,
          }
        });
        movedCount++;
        movedOrders.push({
          id: order.id,
          customerName: order.customerName,
          reference: order.openDeliveryReference,
          assignedDailyNumber: newDailyNumber,
        });
      }
    }

    return NextResponse.json({
      success: true,
      hakimUpdated: { id: hakim.id, storeName: hakim.storeName, merchantId: envMerchantId },
      pastelCleaned: pastel ? { id: pastel.id, email: pastel.email, jotajaConnected: false } : null,
      movedCount,
      movedOrders,
      message: "Pedidos do JotaJá migrados para a loja do Hakim com sucesso e isolamento restabelecido."
    });
  } catch (err: any) {
    console.error("[Fix Jotaja Leak Error]:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
