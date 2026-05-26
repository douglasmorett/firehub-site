import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkAsaasOverdue, createAsaasPayment } from "@/lib/asaas";

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const { items } = await req.json();
    if (!items || items.length === 0) {
      return NextResponse.json({ error: "Carrinho vazio" }, { status: 400 });
    }

    const userId = (session.user as any).id;
    const user = await prisma.user.findUnique({
      where: userId ? { id: userId } : { email: session.user.email! },
      select: { id: true, name: true, email: true, cpfCnpj: true },
    });
    if (!user) {
      console.error("[checkout] Usuário não encontrado. userId:", userId, "email:", session.user.email);
      return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
    }

    // ── Recalcula total no servidor (segurança) ──────────────────────────────
    const productIds = items.map((i: any) => i.id);
    const dbProducts = await prisma.product.findMany({ where: { id: { in: productIds } } });

    let calculatedTotal = 0;
    const itemsWithPrice = items.map((item: any) => {
      const product = dbProducts.find(p => p.id === item.id);
      if (!product) throw new Error(`Produto ${item.id} não encontrado.`);
      calculatedTotal += product.price * item.quantity;
      return { productId: product.id, quantity: item.quantity, price: product.price };
    });

    if (calculatedTotal < 300) {
      return NextResponse.json(
        { error: `Pedido mínimo é R$ 300,00. Seu total é R$ ${calculatedTotal.toFixed(2)}.` },
        { status: 400 }
      );
    }

    // ── Verifica inadimplência ───────────────────────────────────────────────
    if (user.cpfCnpj) {
      const overdueInfo = await checkAsaasOverdue(user.cpfCnpj);
      if (overdueInfo.blocked) {
        return NextResponse.json(
          { 
            error: "Sua conta está bloqueada por pendências financeiras.",
            overduePayments: overdueInfo.payments
          },
          { status: 403 }
        );
      }
    }

    // ── Cria pedido no banco ─────────────────────────────────────────────────
    const order = await prisma.order.create({
      data: {
        userId: user.id,
        totalAmount: calculatedTotal,
        status: "PENDING_PAYMENT",
        items: { create: itemsWithPrice }
      }
    });

    // ── Gerar boleto Asaas automaticamente (com retry) ───────────────────
    let boletoUrl: string | null = null;
    const shortId = order.id.slice(-6).toUpperCase();
    const paymentOpts = {
      userName: user.name || user.email || "",
      userEmail: user.email || "",
      cpfCnpj: user.cpfCnpj || "",
      totalAmount: calculatedTotal,
      orderId: order.id,
      description: `Pedido #${shortId} — Icebox Congelados`
    };

    // Tenta até 2x
    let asaasResult = await createAsaasPayment(paymentOpts);
    if (!asaasResult) {
      console.warn(`[checkout] Asaas falhou na 1ª tentativa para #${shortId}, retentando...`);
      await new Promise(r => setTimeout(r, 1500));
      asaasResult = await createAsaasPayment(paymentOpts);
    }

    if (asaasResult) {
      boletoUrl = asaasResult.boletoUrl;
      await prisma.order.update({
        where: { id: order.id },
        data: {
          boletoUrl: asaasResult.boletoUrl,
          asaasPaymentId: asaasResult.paymentId
        }
      });
      console.log(`[checkout] ✅ #${shortId} link gerado: ${boletoUrl}`);
    } else {
      console.error(`[checkout] ❌ Asaas falhou 2x para #${shortId} - link será gerado na página de pedidos`);
    }

    return NextResponse.json({ success: true, orderId: order.id, boletoUrl });

  } catch (error: any) {
    console.error("Erro no checkout:", error);
    return NextResponse.json(
      { error: error.message || "Erro interno no servidor" },
      { status: 500 }
    );
  }
}
