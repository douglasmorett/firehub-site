import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

// GET /api/motoboy-report?motoboyId=xxx&from=2026-05-01&to=2026-05-31
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  // Segurança e otimização: buscar apenas o id do usuário (evita carregar tokens e dados sensíveis)
  const user = await prisma.user.findUnique({
    where: { email: session.user?.email || "" },
    select: { id: true, ownerId: true }
  });
  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const targetFranchiseeId = user.ownerId || user.id;

  const url = new URL(req.url);
  const motoboyId = url.searchParams.get("motoboyId");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  // Determinar período
  const fromDate = from ? new Date(from + "T00:00:00") : (() => {
    const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d;
  })();
  const toDate = to ? new Date(to + "T23:59:59") : new Date();

  // Buscar motoboys do franqueado
  const motoboyFilter = motoboyId ? { id: motoboyId } : {};
  const motoboys = await prisma.motoboy.findMany({
    where: { franchiseeId: targetFranchiseeId, ...motoboyFilter },
    orderBy: { name: "asc" },
  });

  // Otimização N+1: Buscar todos os pedidos no período para todos os motoboys de uma só vez
  const motoboyIds = motoboys.map(mb => mb.id);
  const allOrders = await prisma.customerOrder.findMany({
    where: {
      franchiseeId: targetFranchiseeId,
      motoboyId: { in: motoboyIds },
      createdAt: { gte: fromDate, lte: toDate },
      deliveryType: "DELIVERY",
    },
    select: {
      id: true,
      createdAt: true,
      totalAmount: true,
      deliveryFee: true,
      motoboyFee: true,
      deliveryDistance: true,
      customerName: true,
      customerAddress: true,
      status: true,
      motoboyId: true,
    },
    orderBy: { createdAt: "asc" },
  });

  // Agrupar pedidos em memória por motoboyId
  const ordersByMotoboy: Record<string, typeof allOrders> = {};
  for (const o of allOrders) {
    if (o.motoboyId) {
      if (!ordersByMotoboy[o.motoboyId]) {
        ordersByMotoboy[o.motoboyId] = [];
      }
      ordersByMotoboy[o.motoboyId].push(o);
    }
  }

  // Mapear motoboys em memória sem chamadas adicionais ao banco
  const report = motoboys.map((mb) => {
    const orders = ordersByMotoboy[mb.id] || [];

    const totalDeliveries = orders.length;
    const totalDistance = orders.reduce((s, o) => s + (o.deliveryDistance || 0), 0);

    // Calcular dias únicos trabalhados (para diária)
    const uniqueDays = new Set(
      orders.map((o) => o.createdAt.toISOString().split("T")[0])
    ).size;

    // Calcular pagamento baseado no tipo
    let dailyTotal = 0;
    let perDeliveryTotal = 0;
    let perKmTotal = 0;

    if (mb.paymentType === "DAILY_RATE" || mb.paymentType === "BOTH") {
      dailyTotal = (mb.dailyRate || 0) * uniqueDays;
    }
    if (mb.paymentType === "PER_DELIVERY" || mb.paymentType === "BOTH") {
      perDeliveryTotal = (mb.perDeliveryRate || 0) * totalDeliveries;
    }
    if (mb.paymentType === "PER_KM") {
      perKmTotal = (mb.perKmRate || 0) * totalDistance;
    }

    // Se BOTH, também calcular por KM se tiver perKmRate
    if (mb.paymentType === "BOTH" && mb.perKmRate) {
      perKmTotal = mb.perKmRate * totalDistance;
    }

    // Alternativamente: usar o motoboyFee registrado por pedido se disponível
    const motoboyFeeSum = orders.reduce((s, o) => s + (o.motoboyFee || 0), 0);

    const totalToPay = dailyTotal + perDeliveryTotal + perKmTotal;

    return {
      motoboy: {
        id: mb.id,
        name: mb.name,
        phone: mb.phone,
        paymentType: mb.paymentType,
        dailyRate: mb.dailyRate,
        perDeliveryRate: mb.perDeliveryRate,
        perKmRate: mb.perKmRate,
        active: mb.active,
      },
      stats: {
        totalDeliveries,
        totalDistance: Math.round(totalDistance * 10) / 10,
        uniqueDays,
        dailyTotal,
        perDeliveryTotal,
        perKmTotal,
        motoboyFeeSum,
        totalToPay,
      },
      orders: orders.map((o) => ({
        id: o.id,
        date: o.createdAt.toISOString(),
        customerName: o.customerName,
        customerAddress: o.customerAddress,
        totalAmount: o.totalAmount,
        deliveryFee: o.deliveryFee,
        motoboyFee: o.motoboyFee,
        deliveryDistance: o.deliveryDistance,
        status: o.status,
      })),
    };
  });

  return NextResponse.json({
    period: { from: fromDate.toISOString(), to: toDate.toISOString() },
    report,
  });
}
