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

  // Determinar período exato respeitando fuso horário do Brasil (America/Sao_Paulo UTC-3)
  let fromDate: Date;
  let toDate: Date;

  if (from) {
    // Ex: "2026-08-01" -> inicio do dia em Brasília (00:00:00 BRT = 03:00:00 UTC)
    fromDate = new Date(`${from}T03:00:00.000Z`);
  } else {
    // Início do mês atual em Brasília (00:00:00 BRT = 03:00:00 UTC)
    const nowSp = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
    const yyyy = nowSp.getFullYear();
    const mm = String(nowSp.getMonth() + 1).padStart(2, "0");
    fromDate = new Date(`${yyyy}-${mm}-01T03:00:00.000Z`);
  }

  if (to) {
    // Ex: "2026-08-01" -> fim do dia em Brasília (23:59:59.999 BRT = 2026-08-02T02:59:59.999Z UTC)
    const [y, m, d] = to.split("-").map(Number);
    toDate = new Date(Date.UTC(y, m - 1, d + 1, 2, 59, 59, 999));
  } else {
    toDate = new Date();
  }

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
      customerPhone: true,
      customerAddress: true,
      status: true,
      motoboyId: true,
      paymentMethod: true,
      items: true,
      notes: true,
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

    // Calcular dias únicos trabalhados em fuso horário do Brasil (America/Sao_Paulo)
    const uniqueDays = orders.length > 0
      ? new Set(orders.map((o) => new Date(o.createdAt).toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }).split(",")[0])).size
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
      if (o.status === "CANCELADO") continue; // Pedido cancelado: não cobrar prestação de contas do motoboy
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
      } else if (pm.includes("CARD") || pm.includes("CART") || pm.includes("CREDIT") || pm.includes("MAQUININHA") || pm.includes("MAQUINA")) {
        creditTotal += o.totalAmount;
        creditCount++;
      } else {
        // PIX Online, iFood Pago Online, etc.
        onlineTotal += o.totalAmount;
        onlineCount++;
      }
    }

    const cardPosTotal = debitTotal + creditTotal + voucherTotal;
    const cardPosCount = debitCount + creditCount + voucherCount;

    // Calcular remuneração segundo o tipo do motoboy
    const dailyRate = mb.dailyRate || 0;
    const perDeliveryRate = mb.perDeliveryRate || 0;
    const perKmRate = mb.perKmRate || 0;

    let feeTotal = 0;
    let dailyTotal = 0;

    switch (mb.paymentType) {
      case "DAILY_RATE":
        dailyTotal = uniqueDays * dailyRate;
        feeTotal = 0;
        break;

      case "PER_DELIVERY":
        feeTotal = perDeliveryRate > 0
          ? totalDeliveries * perDeliveryRate
          : deliveryFeeSum;
        dailyTotal = 0;
        break;

      case "BOTH":
      case "DAILY_PLUS_FEE":
        dailyTotal = uniqueDays * dailyRate;
        feeTotal = perDeliveryRate > 0
          ? totalDeliveries * perDeliveryRate
          : deliveryFeeSum;
        break;

      case "PER_KM":
        feeTotal = totalDistance * perKmRate;
        dailyTotal = 0;
        break;

      default:
        feeTotal = deliveryFeeSum;
        dailyTotal = 0;
    }

    const totalWithDaily = dailyTotal + feeTotal;
    const totalFeeOnly = feeTotal;

    return {
      motoboy: {
        id: mb.id,
        name: mb.name,
        paymentType: mb.paymentType,
        dailyRate,
        perDeliveryRate,
        perKmRate,
        active: mb.active,
      },
      stats: {
        totalDeliveries,
        totalDistance,
        uniqueDays,
        deliveryFeeSum,
        motoboyFeeSum,
        cashCollectedSum,
        cashOrdersCount,
        cardPosTotal,
        cardPosCount,
        debitTotal,
        debitCount,
        creditTotal,
        creditCount,
        voucherTotal,
        voucherCount,
        onlineTotal,
        onlineCount,
        dailyTotal,
        feeTotal,
        totalWithDaily,
        totalFeeOnly,
      },
      orders: orders.map(o => ({
        id: o.id,
        createdAt: o.createdAt,
        totalAmount: o.totalAmount,
        deliveryFee: o.deliveryFee,
        motoboyFee: o.motoboyFee,
        customerName: o.customerName,
        customerAddress: o.customerAddress,
        paymentMethod: o.paymentMethod,
        status: o.status,
      })),
    };
  });

  return NextResponse.json({
    period: {
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      fromFormatted: fromDate.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }),
      toFormatted: toDate.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }),
    },
    report,
  });
}
