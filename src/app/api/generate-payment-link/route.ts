import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createAsaasPayment } from "@/lib/asaas";

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const { orderId } = await req.json();
    if (!orderId) {
      return NextResponse.json({ error: "orderId obrigatório" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, name: true, email: true, cpfCnpj: true },
    });
    if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
    if (order.userId !== user.id) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

    // Se já tem link, retorna direto
    if (order.boletoUrl) {
      return NextResponse.json({ boletoUrl: order.boletoUrl, alreadyExists: true });
    }

    if (order.status !== "PENDING_PAYMENT") {
      return NextResponse.json({ error: "Pedido não está aguardando pagamento" }, { status: 400 });
    }

    // Gera no Asaas
    const shortId = order.id.slice(-6).toUpperCase();
    console.log(`[generate-payment-link] Gerando link para #${shortId} (R$${order.totalAmount.toFixed(2)}) - CPF/CNPJ: ${user.cpfCnpj || "VAZIO"}`);

    const result = await createAsaasPayment({
      userName: user.name || user.email || "",
      userEmail: user.email || "",
      cpfCnpj: user.cpfCnpj || "",
      totalAmount: order.totalAmount,
      orderId: order.id,
      description: `Pedido #${shortId} — Icebox Congelados`,
    });

    if (!result) {
      console.error(`[generate-payment-link] Asaas retornou null para #${shortId}`);
      return NextResponse.json({ error: "Falha ao gerar cobrança no Asaas. Verifique CPF/CNPJ." }, { status: 502 });
    }

    // Salva no banco
    await prisma.order.update({
      where: { id: order.id },
      data: { boletoUrl: result.boletoUrl, asaasPaymentId: result.paymentId },
    });

    console.log(`[generate-payment-link] ✅ #${shortId} link: ${result.boletoUrl}`);
    return NextResponse.json({ boletoUrl: result.boletoUrl, paymentId: result.paymentId });

  } catch (error: any) {
    console.error("[generate-payment-link] Erro:", error);
    return NextResponse.json({ error: error.message || "Erro interno" }, { status: 500 });
  }
}
