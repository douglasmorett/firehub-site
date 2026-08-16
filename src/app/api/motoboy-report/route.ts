import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { getStartOfDayUTC, getEndOfDayUTC, getStartOfMonthUTC, toLocalISODate } from "@/lib/timezone";

// GET /api/motoboy-report?motoboyId=xxx&from=2026-05-01&to=2026-05-31
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  // Segurança e otimização: buscar apenas o id do usuário e timezone
  const user = await prisma.user.findUnique({
    where: { email: session.user?.email || "" },
    select: { id: true, ownerId: true, storeTimezone: true }
  });
  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const targetFranchiseeId = user.ownerId || user.id;

  const url = new URL(req.url);
  const motoboyId = url.searchParams.get("motoboyId");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const calcMode = url.searchParams.get("calcMode") || "all"; // "all" | "fee_only"

  const tz = user.storeTimezone || "America/Sao_Paulo";

  // Determinar período exato respeitando fuso horário do restaurante
  let fromDate: Date;
  let toDate: Date;

  if (from) {
    fromDate = getStartOfDayUTC(from, tz);
  } else {
    fromDate = getStartOfMonthUTC(new Date(), tz);
  }

  if (to) {
    toDate = getEndOfDayUTC(to, tz);
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
      changeAmount: true,
      items: true,
      notes: true,
      dailyOrderNumber: true,
      ifoodReference: true,
      openDeliveryReference: true,
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

    // Calcular dias únicos trabalhados no fuso horário do restaurante
    const uniqueDays = orders.length > 0
      ? new Set(orders.map((o) => toLocalISODate(new Date(o.createdAt), tz))).size
      : 0;

    // Soma das taxas dos pedidos
    const deliveryFeeSum = orders.reduce((s, o) => s + (o.deliveryFee || o.motoboyFee || 0), 0);
    const motoboyFeeSum = orders.reduce((s, o) => s + (o.motoboyFee || 0), 0);

    // Classificação de pagamentos recebidos pelo motoboy na entrega vs online
    let cashCollectedSum = 0, cashOrdersCount = 0, changeGivenSum = 0, cashOrdersValueSum = 0;
    let debitTotal = 0, debitCount = 0;
    let creditTotal = 0, creditCount = 0;
    let voucherTotal = 0, voucherCount = 0;
    let onlineTotal = 0, onlineCount = 0;

    for (const o of orders) {
      const st = (o.status || "").toUpperCase();
      if (st.includes("CANCEL")) continue; // Pedido cancelado: não cobrar prestação de contas do motoboy

      const pm = (o.paymentMethod || "").toUpperCase();
      const isCash = pm === "CASH" || pm.includes("DINHEIR") || pm.includes("DINHEIRO");

      if (isCash) {
        const orderTotal = Number(o.totalAmount || 0);
        let changeFor: number | null = null;

        // 1. Verificar se há valor de troco estruturado (changeAmount)
        if (typeof o.changeAmount === "number" && o.changeAmount > orderTotal) {
          changeFor = o.changeAmount;
        } else if (o.notes) {
          // 2. Extrair troco de notas/observações (ex: "Troco para 100", "Troco p/ 100", "Troco para R$ 100,00", "Troco: 100", "Levar troco para 50")
          const notesUpper = String(o.notes).toUpperCase();
          const match =
            notesUpper.match(/TROCO\s*(?:PARA|P\/|DE|PRA)?\s*R?\$?\s*(\d+(?:[.,]\d{1,2})?)/i) ||
            notesUpper.match(/TROCO\s*[:=]?\s*R?\$?\s*(\d+(?:[.,]\d{1,2})?)/i);
          if (match && match[1]) {
            const parsed = parseFloat(match[1].replace(",", "."));
            if (!isNaN(parsed) && parsed > orderTotal) {
              changeFor = parsed;
            }
          }
        }

        // O valor que o motoboy recebe fisicamente do cliente e entrega para a loja
        const cashCollected = changeFor ? changeFor : orderTotal;
        const changeGiven = changeFor ? (changeFor - orderTotal) : 0;

        cashCollectedSum += cashCollected;
        cashOrdersCount++;
        changeGivenSum += changeGiven;
        cashOrdersValueSum += orderTotal;
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
        cashOrdersValueSum,
        changeGivenSum,
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
      orders: orders.map(o => {
        const pm = (o.paymentMethod || "").toUpperCase();
        const isCash = pm === "CASH" || pm.includes("DINHEIR") || pm.includes("DINHEIRO");
        const orderTotal = Number(o.totalAmount || 0);
        let changeFor: number | null = null;
        if (typeof o.changeAmount === "number" && o.changeAmount > orderTotal) {
          changeFor = o.changeAmount;
        } else if (o.notes) {
          const notesUpper = String(o.notes).toUpperCase();
          const match =
            notesUpper.match(/TROCO\s*(?:PARA|P\/|DE|PRA)?\s*R?\$?\s*(\d+(?:[.,]\d{1,2})?)/i) ||
            notesUpper.match(/TROCO\s*[:=]?\s*R?\$?\s*(\d+(?:[.,]\d{1,2})?)/i);
          if (match && match[1]) {
            const parsed = parseFloat(match[1].replace(",", "."));
            if (!isNaN(parsed) && parsed > orderTotal) {
              changeFor = parsed;
            }
          }
        }
        const cashToDeliver = isCash ? (changeFor || orderTotal) : 0;
        const changeGiven = isCash && changeFor ? (changeFor - orderTotal) : 0;

        return {
          id: o.id,
          createdAt: o.createdAt,
          date: o.createdAt,
          totalAmount: o.totalAmount,
          changeAmount: o.changeAmount,
          changeFor,
          changeGiven,
          cashToDeliver,
          deliveryFee: o.deliveryFee,
          motoboyFee: o.motoboyFee,
          deliveryDistance: o.deliveryDistance,
          customerName: o.customerName,
          customerPhone: o.customerPhone,
          customerAddress: o.customerAddress,
          paymentMethod: o.paymentMethod,
          status: o.status,
          notes: o.notes,
          items: o.items,
          dailyOrderNumber: o.dailyOrderNumber,
          ifoodReference: o.ifoodReference,
          openDeliveryReference: o.openDeliveryReference,
        };
      }),
    };
  });

  return NextResponse.json({
    period: {
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      fromFormatted: fromDate.toLocaleDateString("pt-BR", { timeZone: tz }),
      toFormatted: toDate.toLocaleDateString("pt-BR", { timeZone: tz }),
    },
    report,
  });
}
