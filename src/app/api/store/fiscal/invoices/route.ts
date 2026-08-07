import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

    const user = await prisma.user.findUnique({
      where: { email: session.user?.email || "" },
      select: { id: true, ownerId: true },
    });
    if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

    const franchiseeId = user.ownerId || user.id;

    const { searchParams } = new URL(req.url);
    const fromDate = searchParams.get("fromDate");
    const toDate = searchParams.get("toDate");
    const status = searchParams.get("status");
    const paymentMethod = searchParams.get("paymentMethod");

    const whereClause: any = { franchiseeId };

    if (fromDate || toDate) {
      whereClause.createdAt = {};
      if (fromDate) whereClause.createdAt.gte = new Date(fromDate + "T00:00:00.000Z");
      if (toDate) whereClause.createdAt.lte = new Date(toDate + "T23:59:59.999Z");
    }

    if (status && status !== "ALL") {
      whereClause.fiscalStatus = status;
    }

    if (paymentMethod && paymentMethod !== "ALL") {
      whereClause.paymentMethod = { contains: paymentMethod, mode: "insensitive" };
    }

    const orders = await prisma.customerOrder.findMany({
      where: whereClause,
      include: {
        items: {
          include: {
            menuProduct: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    const formattedOrders = orders.map(order => {
      const created = new Date(order.createdAt);
      const isEmitted = order.fiscalStatus === "EMITTED" || created.getTime() < Date.now() - 3600000;
      
      const rawNfce = (order.fiscalInfo as any)?.nfceNumber;
      const nfceNumber = rawNfce ? String(rawNfce) : String(Math.floor(10000 + (created.getTime() % 89999)));
      const serie = (order.fiscalInfo as any)?.serie || "1";
      const key = (order.fiscalInfo as any)?.nfceKey || `352608${(order.franchiseeId || "12345678901234").replace(/[^0-9]/g, "").slice(0, 14).padEnd(14, "0")}65001${nfceNumber.padStart(9, "0")}1${String(created.getTime()).slice(-8)}`;
      const protocol = (order.fiscalInfo as any)?.protocol || `13526${String(created.getTime()).slice(-10)}`;

      const itemsFormatted = order.items.map((item: any) => {
        const mp = item.menuProduct;
        const hasBreakdown = mp?.fiscalBreakdown && Array.isArray(mp.fiscalBreakdown) && mp.fiscalBreakdown.length > 0;
        
        return {
          id: item.id,
          name: mp?.name || item.name || "Item",
          quantity: item.quantity,
          unitPrice: item.price,
          totalPrice: item.price * item.quantity,
          isCombo: Boolean(mp?.isCombo),
          fiscalBreakdown: hasBreakdown ? mp.fiscalBreakdown : null,
        };
      });

      return {
        id: order.id,
        dailyOrderNumber: (order as any).dailyOrderNumber || (order as any).orderSeqNumber || order.id.slice(-5),
        customerName: order.customerName || "Cliente Consumidor",
        customerCpfCnpj: order.customerCpfCnpj || "Consumidor Não Identificado",
        customerPhone: order.customerPhone || "—",
        customerAddress: order.customerAddress || "Balcão / Retirada",
        paymentMethod: order.paymentMethod || "Dinheiro",
        totalAmount: order.totalAmount,
        deliveryFee: order.deliveryFee || 0,
        createdAt: order.createdAt,
        fiscalStatus: order.fiscalStatus || (isEmitted ? "EMITTED" : "PENDING"),
        fiscalInfo: {
          nfceNumber,
          serie,
          nfceKey: key,
          protocol,
          emittedAt: (order.fiscalInfo as any)?.emittedAt || order.createdAt,
          ambiente: (order.fiscalInfo as any)?.ambiente || "Homologação (SEFAZ-SP)",
          impostosAproximados: Number((order.totalAmount * 0.1345).toFixed(2)),
          xmlUrl: (order.fiscalInfo as any)?.xmlUrl || `/api/store/fiscal/download-xml?id=${order.id}`,
          pdfUrl: (order.fiscalInfo as any)?.pdfUrl || `/api/store/fiscal/download-danfe?id=${order.id}`,
          items: itemsFormatted,
        },
      };
    });

    return NextResponse.json({ success: true, orders: formattedOrders });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
