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
  const calcMode = url.searchParams.get("calcMode") || "all"; // "all" | "fee_only"

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
      status: { notIn: ["CANCELADO"] },
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
      paymentMethod: true,
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
    const uniqueDays = orders.length > 0
      ? new Set(orders.map((o) => o.createdAt.toISOString().split("T")[0])).size
      : 0;

    // Soma das taxas dos pedidos
    const deliveryFeeSum = orders.reduce((s, o) => s + (o.deliveryFee || o.motoboyFee || 0), 0);
    const motoboyFeeSum = orders.reduce((s, o) => s + (o.motoboyFee || 0), 0);

    // Classificação de pagamentos recebidos pelo motoboy na entrega vs online
    let cashCollectedSum = 0, cashOrdersCount = 0;
    let debitTotal = 0, debitCount = 0;
    let creditTotal = 0, creditCount = 0;
    let voucherTotal = 0, voucherCount = 0;
    let onlineTotal = 0, onlineCount = 0;

    for (const o of orders) {
      const pm = (o.paymentMethod || "").toUpperCase();
      if (pm === "CASH" || pm.includes("DINHEIR")) {
        cashCollectedSum += o.totalAmount;
        cashOrdersCount++;
      } else if (pm.includes("DEBIT") || pm.includes("DEBITO") || pm.includes("DÉBITO")) {
        debitTotal += o.totalAmount;
        debitCount++;
      } else if (pm.includes("VOUCHER") || pm.includes("VALE") || pm.includes("VR") || pm.includes("VA")) {
        voucherTotal += o.totalAmount;
        voucherCount++;
      } else if (pm.includes("PIX") || pm.includes("ONLINE") || pm.includes("IFOOD") || pm.includes("PREPAID")) {
        onlineTotal += o.totalAmount;
        onlineCount++;
      } else {
        // Padrão para cartões de crédito ou máquinas sem especificação
        creditTotal += o.totalAmount;
        creditCount++;
      }
    }

    const cardPosTotal = debitTotal + creditTotal + voucherTotal;
    const cardPosCount = debitCount + creditCount + voucherCount;

    // Calcular pagamento baseado no tipo
    let dailyTotal = 0;
    let perDeliveryTotal = 0;
    let perKmTotal = 0;

    if (mb.paymentType === "DAILY_RATE" || mb.paymentType === "BOTH" || mb.paymentType === "DAILY_PLUS_FEE") {
      dailyTotal = (mb.dailyRate || 0) * uniqueDays;
    }
    if (mb.paymentType === "PER_DELIVERY" || mb.paymentType === "BOTH") {
      perDeliveryTotal = (mb.perDeliveryRate || 0) * totalDeliveries;
    } else if (mb.paymentType === "DAILY_PLUS_FEE") {
      perDeliveryTotal = deliveryFeeSum;
    }
    if (mb.paymentType === "PER_KM" || (mb.paymentType === "BOTH" && mb.perKmRate)) {
      perKmTotal = (mb.perKmRate || 0) * totalDistance;
    }

    const totalWithDaily = dailyTotal + perDeliveryTotal + perKmTotal;
    const totalFeeOnly = perDeliveryTotal + perKmTotal;
    const totalToPay = calcMode === "fee_only" ? totalFeeOnly : totalWithDaily;

    // Cálculo do acerto financeiro final com a loja (Dinheiro em Mãos vs O que a Loja Deve)
    const netSettlement = cashCollectedSum - totalToPay;
    const motoboyOwesStore = netSettlement > 0 ? netSettlement : 0;
    const storeOwesMotoboy = netSettlement < 0 ? Math.abs(netSettlement) : 0;

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
        deliveryFeeSum,
        motoboyFeeSum,
        totalWithDaily,
        totalFeeOnly,
        totalToPay,
        cashCollectedSum,
        cashOrdersCount,
        debitTotal,
        debitCount,
        creditTotal,
        creditCount,
        voucherTotal,
        voucherCount,
        cardPosTotal,
        cardPosCount,
        onlineTotal,
        onlineCount,
        netSettlement,
        motoboyOwesStore,
        storeOwesMotoboy,
      },
      orders: orders.map((o) => ({
        id: o.id,
        date: o.createdAt.toISOString(),
        customerName: o.customerName,
        customerAddress: o.customerAddress,
        totalAmount: o.totalAmount,
        deliveryFee: o.deliveryFee || o.motoboyFee || 0,
        motoboyFee: o.motoboyFee,
        deliveryDistance: o.deliveryDistance,
        status: o.status,
        paymentMethod: o.paymentMethod || "Não informado",
      })),
    };
  });

  return NextResponse.json({
    period: { from: fromDate.toISOString(), to: toDate.toISOString() },
    report,
  });
}
