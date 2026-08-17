import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions).catch(() => null);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: {
        id: true,
        name: true,
        storeName: true,
        repasseConfig: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
    }

    const { amount, chavePix, tipoChave, titular } = await req.json();

    const withdrawAmount = Number(amount);
    if (isNaN(withdrawAmount) || withdrawAmount <= 0) {
      return NextResponse.json({ error: "Valor de saque inválido" }, { status: 400 });
    }

    const activePix = chavePix || (user.repasseConfig as any)?.chavePix;
    if (!activePix) {
      return NextResponse.json({
        error: "Nenhuma chave Pix configurada. Cadastre sua chave Pix antes de solicitar o saque."
      }, { status: 400 });
    }

    // Calcular o saldo disponível real de vendas online
    const onlineOrders = await prisma.customerOrder.findMany({
      where: {
        franchiseeId: user.id,
        status: { notIn: ["CANCELADO"] },
        paymentPaidAt: { not: null },
      },
      select: {
        totalAmount: true,
        paymentMethod: true,
        source: true,
      }
    });

    let pixGross = 0;
    let pixCount = 0;

    onlineOrders.forEach(o => {
      const pm = (o.paymentMethod || "").toUpperCase();
      const src = (o.source || "").toUpperCase();
      const isOnline = pm.includes("PIX") || pm.includes("CREDITO") || pm.includes("ONLINE") || pm.includes("MERCADOPAGO") || src === "ONLINE";
      if (isOnline && pm.includes("PIX")) {
        pixGross += o.totalAmount || 0;
        pixCount++;
      }
    });

    const pixFees = pixGross * 0.005 + pixCount * 0.40;
    const saldoDisponivel = Math.max(0, pixGross - pixFees);

    if (withdrawAmount > saldoDisponivel && saldoDisponivel > 0) {
      return NextResponse.json({
        error: `O valor solicitado (R$ ${withdrawAmount.toFixed(2)}) é maior que o saldo disponível (R$ ${saldoDisponivel.toFixed(2)}).`
      }, { status: 400 });
    }

    const payoutRecord = {
      id: `SAQ-${Date.now().toString().slice(-6)}`,
      franchiseeId: user.id,
      storeName: user.storeName || user.name,
      amount: withdrawAmount,
      chavePix: activePix,
      tipoChave: tipoChave || (user.repasseConfig as any)?.tipoChave || "CHAVE_PIX",
      titular: titular || (user.repasseConfig as any)?.titular || user.name,
      status: "SOLICITADO",
      requestedAt: new Date().toISOString(),
    };

    console.log(`[Repasse / Saque Solicitado] Loja: ${user.storeName} | Valor: R$ ${withdrawAmount.toFixed(2)} | Pix: ${activePix}`);

    return NextResponse.json({
      success: true,
      message: `Solicitação de saque de R$ ${withdrawAmount.toFixed(2)} realizada com sucesso! O valor será transferido para a chave Pix cadastrada.`,
      payout: payoutRecord
    });
  } catch (err: any) {
    console.error("[Solicitar Saque Error]:", err);
    return NextResponse.json({ error: err.message || "Erro ao processar solicitação de saque" }, { status: 500 });
  }
}
