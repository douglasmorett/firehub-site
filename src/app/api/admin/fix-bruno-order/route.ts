import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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

    // 1. Atualizar credenciais do Hakim
    await prisma.user.update({
      where: { id: hakim.id },
      data: {
        jotajaConnected: true,
        jotajaMerchantId: envMerchantId,
        jotajaClientId: process.env.JOTAJA_CLIENT_ID || undefined,
        jotajaClientSecret: process.env.JOTAJA_CLIENT_SECRET || undefined,
      }
    });

    // 2. Desconectar Pastel da Paulista
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

    // 3. Buscar pedidos do Patrick / JotaJá que foram parar na loja errada
    const leakedOrders = await prisma.customerOrder.findMany({
      where: {
        OR: [
          pastel ? { franchiseeId: pastel.id } : undefined,
          { customerName: { contains: "PATRICK" } },
          { openDeliveryReference: "32857612" },
          { openDeliveryOrderId: { contains: "32857612" } },
        ].filter(Boolean) as any
      },
      select: { id: true, customerName: true, openDeliveryReference: true, totalAmount: true, franchiseeId: true }
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const lastOrder = await prisma.customerOrder.findFirst({
      where: {
        franchiseeId: hakim.id,
        createdAt: { gte: today }
      },
      orderBy: { dailyOrderNumber: 'desc' },
      select: { dailyOrderNumber: true }
    });

    let currentMax = Number(lastOrder?.dailyOrderNumber || 0);
    const movedOrders: any[] = [];

    for (const order of leakedOrders) {
      currentMax += 1;
      await prisma.customerOrder.update({
        where: { id: order.id },
        data: {
          franchiseeId: hakim.id,
          dailyOrderNumber: currentMax,
        }
      });

      movedOrders.push({
        id: order.id,
        customerName: order.customerName,
        reference: order.openDeliveryReference,
        assignedDailyNumber: currentMax,
        previousFranchiseeId: order.franchiseeId
      });
    }

    return NextResponse.json({
      ok: true,
      hakimId: hakim.id,
      pastelCleaned: !!pastel,
      movedCount: movedOrders.length,
      movedOrders,
      message: "Pedido do Patrick transferido para o final da fila do Hakim com sucesso!"
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
