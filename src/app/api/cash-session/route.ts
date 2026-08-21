import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { sendEvolutionMessage } from "@/lib/whatsapp-evolution";

async function getUser(session: any) {
  const u = await prisma.user.findUnique({ where: { email: session.user?.email || "" } });
  if (!u) return null;
  const targetId = u.ownerId || u.id;
  return { ...u, targetId };
}

// GET - retorna sessão aberta atual e pedidos presenciais do período
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const user = await getUser(session);
  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  // Sessão aberta atual
  const openSession = await prisma.cashSession.findFirst({
    where: { franchiseeId: user.targetId, status: "OPEN" },
    orderBy: { openedAt: "desc" },
  });

  // Se tem sessão aberta, calcular os valores esperados com base em TODOS os pedidos do período
  let expected = { cash: 0, debit: 0, credit: 0, pix: 0, voucher: 0, ifoodOnline: 0, ifoodCoupons: 0, total: 0 };
  if (openSession) {
    const orders = await prisma.customerOrder.findMany({
      where: {
        franchiseeId: user.targetId,
        status: { notIn: ["CANCELADO"] },
        createdAt: { gte: openSession.openedAt },
      },
      select: { paymentMethod: true, totalAmount: true, source: true, paymentPaidAt: true, gatewayProvider: true, deliveryFee: true, discountIfood: true, discountTotal: true, discountMerchant: true, notes: true },
    });

    for (const o of orders) {
      const pm = (o.paymentMethod || "").toLowerCase();
      const src = ((o as any).source || "").toUpperCase();

      const channelDisc = (o.discountIfood && o.discountIfood > 0)
        ? o.discountIfood
        : (o.discountTotal && o.discountMerchant && o.discountTotal > o.discountMerchant
            ? o.discountTotal - o.discountMerchant
            : (o.notes?.match(/(?:iFood|Plataforma):\s*R\$\s*(\d+[.,]\d{2})/i)?.[1]
                ? parseFloat(o.notes.match(/(?:iFood|Plataforma):\s*R\$\s*(\d+[.,]\d{2})/i)![1].replace(",", "."))
                : 0));
      const val = (o.totalAmount || 0) + channelDisc;

      // Identificar pagamentos ON-LINE (iFood Pago Online, PIX Online, Crédito Online via App)
      // Pagamentos Online NÃO passam pelas maquininhas da loja nem dinheiro de motoboy!
      const isOnlinePayment =
        pm.includes("online") ||
        pm.includes("prepaid") ||
        pm.includes("ifood") ||
        pm.includes("pago_online") ||
        !!(o.paymentPaidAt || o.gatewayProvider) ||
        (src === "IFOOD" && !pm.includes("dinheiro") && !pm.includes("debito") && !pm.includes("débito") && !pm.includes("credito") && !pm.includes("crédito") && !pm.includes("maquininha") && !pm.includes("cobrar"));

      if (src === "IFOOD" && isOnlinePayment) {
        expected.ifoodOnline += val;
      } else if (isOnlinePayment && src !== "PDV") {
        expected.ifoodOnline += val;
      } else if (pm.includes("dinheiro") || pm.includes("cash")) {
        expected.cash += val;
      } else if (pm.includes("débito") || pm.includes("debito") || pm.includes("debit")) {
        expected.debit += val;
      } else if (pm.includes("crédito") || pm.includes("credito") || pm.includes("credit")) {
        expected.credit += val;
      } else if (pm.includes("pix")) {
        expected.pix += val;
      } else if (pm.includes("voucher") || pm.includes("vale") || pm.includes("meal") || pm.includes("food")) {
        expected.voucher += val;
      } else {
        expected.cash += val;
      }

      expected.total += val;

      // Somar desconto custeado pelo iFood (cupons iFood) — apenas informativo
      if (o.discountIfood && o.discountIfood > 0) {
        expected.ifoodCoupons += o.discountIfood;
      }
    }
    // Adicionar o troco inicial ao dinheiro esperado
    expected.cash += openSession.openingAmount;
  }

  return NextResponse.json({ session: openSession, expected, cashOpen: user.cashOpen });
}

// POST - abrir caixa com valor inicial
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const user = await getUser(session);
  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const { openingAmount = 0 } = await req.json();

  // Fechar qualquer sessão aberta anterior
  await prisma.cashSession.updateMany({
    where: { franchiseeId: user.targetId, status: "OPEN" },
    data: { status: "CLOSED", closedAt: new Date() },
  });

  // Criar nova sessão
  const cashSession = await prisma.cashSession.create({
    data: { franchiseeId: user.targetId, openingAmount: Number(openingAmount), status: "OPEN" },
  });

  // Marcar caixa como aberto no user e no owner
  await prisma.user.updateMany({
    where: { OR: [{ id: user.targetId }, { ownerId: user.targetId }] },
    data: { cashOpen: true },
  });

  const ownerInfo = await prisma.user.findUnique({ where: { id: user.targetId }, select: { notificationPhone: true, storeName: true } });
  if (ownerInfo?.notificationPhone) {
    const timeStr = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    const msg = `🟢 *Caixa Aberto*\n\nOlá chefe! O caixa da loja *${ownerInfo.storeName || 'sua loja'}* acabou de ser *ABERTO* às ${timeStr} com R$ ${Number(openingAmount).toFixed(2).replace('.', ',')} de troco.\n\n_Ass: Seu Assistente FireHub 🔥_`;
    sendEvolutionMessage(user.targetId, ownerInfo.notificationPhone, msg).catch(() => {});
  }

  return NextResponse.json({ success: true, session: cashSession });
}

// PUT - fechar caixa com valores contados
export async function PUT(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const user = await getUser(session);
  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const body = await req.json();
  const { closingCash, closingDebit, closingCredit, closingPix, closingVoucher,
    expectedCash, expectedDebit, expectedCredit, expectedPix, expectedVoucher, expectedTotal,
    justification } = body;

  const totalInformed = (closingCash || 0) + (closingDebit || 0) + (closingCredit || 0) +
    (closingPix || 0) + (closingVoucher || 0);
  const difference = totalInformed - (expectedTotal || 0);

  const openSession = await prisma.cashSession.findFirst({
    where: { franchiseeId: user.targetId, status: "OPEN" },
    orderBy: { openedAt: "desc" },
  });

  if (openSession) {
    await prisma.cashSession.update({
      where: { id: openSession.id },
      data: {
        status: "CLOSED", closedAt: new Date(),
        closingCash: Number(closingCash || 0),
        closingDebit: Number(closingDebit || 0),
        closingCredit: Number(closingCredit || 0),
        closingPix: Number(closingPix || 0),
        closingVoucher: Number(closingVoucher || 0),
        expectedCash: Number(expectedCash || 0),
        expectedDebit: Number(expectedDebit || 0),
        expectedCredit: Number(expectedCredit || 0),
        expectedPix: Number(expectedPix || 0),
        expectedVoucher: Number(expectedVoucher || 0),
        expectedTotal: Number(expectedTotal || 0),
        difference: Number(difference.toFixed(2)),
        justification: justification || null,
        closedBy: session.user?.name || session.user?.email || "",
      },
    });
  }

  // 🔧 Auto-finalizar pedidos travados em SAIU_ENTREGA com mais de 3h
  // Isso limpa pedidos que nunca foram confirmados como entregues pelo motoboy
  const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
  try {
    const stuckResult = await prisma.customerOrder.updateMany({
      where: {
        franchiseeId: user.targetId,
        status: "SAIU_ENTREGA",
        createdAt: { lt: threeHoursAgo },
      },
      data: { status: "ENTREGUE", updatedAt: new Date() },
    });
    if (stuckResult.count > 0) {
      console.log(`[CashSession Close] ✅ ${stuckResult.count} pedidos SAIU_ENTREGA finalizados automaticamente`);
    }
  } catch (err) {
    console.error("[CashSession Close] Erro ao finalizar pedidos travados:", err);
  }

  // Marcar caixa como fechado no user e no owner
  await prisma.user.updateMany({
    where: { OR: [{ id: user.targetId }, { ownerId: user.targetId }] },
    data: { cashOpen: false },
  });

  const ownerInfo = await prisma.user.findUnique({ where: { id: user.targetId }, select: { notificationPhone: true, storeName: true } });
  if (ownerInfo?.notificationPhone) {
    const timeStr = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    const msg = `🔴 *Caixa Fechado*\n\nOlá chefe! O caixa da loja *${ownerInfo.storeName || 'sua loja'}* acabou de ser *FECHADO* às ${timeStr}.\n\nDiferença no caixa: R$ ${Number(difference.toFixed(2)).toLocaleString('pt-BR', {minimumFractionDigits: 2})}\n\n_Ass: Seu Assistente FireHub 🔥_`;
    sendEvolutionMessage(user.targetId, ownerInfo.notificationPhone, msg).catch(() => {});
  }

  return NextResponse.json({ success: true, difference });
}
