import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createAsaasPayment } from "@/lib/asaas";

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const { items } = await req.json();

    if (!items || items.length === 0) {
      return NextResponse.json({ error: "Carrinho vazio" }, { status: 400 });
    }

    const userId = (session.user as any).id;
    const user = await prisma.user.findUnique({
      where: { id: userId || undefined, email: session.user.email! },
      select: { id: true, name: true, email: true, cpfCnpj: true },
    });
    if (!user) return NextResponse.json({ error: "User não encontrado" }, { status: 404 });

    // Verifica se já fez retirada de emergência no mês
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const emergencyOrdersThisMonth = await prisma.order.count({
      where: {
        userId: user.id,
        isEmergency: true,
        createdAt: { gte: startOfMonth }
      }
    });

    const hasPenalty = emergencyOrdersThisMonth > 0;
    
    // Calcula o total dos produtos
    const productIds = items.map((i: any) => i.id);
    const dbProducts = await prisma.product.findMany({
      where: { id: { in: productIds } }
    });

    let calculatedTotal = 0;
    const itemsWithPrice = items.map((item: any) => {
      const product = dbProducts.find(p => p.id === item.id);
      if (!product) throw new Error(`Produto ${item.id} não encontrado.`);
      calculatedTotal += product.price * item.quantity;
      return {
        productId: product.id,
        quantity: item.quantity,
        price: product.price
      };
    });

    // Adiciona 30% se tiver multa
    let finalTotal = calculatedTotal;
    if (hasPenalty) {
      finalTotal = calculatedTotal * 1.30;
    }

    // Cria o pedido no BD como Emergência Pendente
    const order = await prisma.order.create({
      data: {
        userId: user.id,
        totalAmount: finalTotal,
        status: "EMERGENCIA_PENDENTE",
        isEmergency: true,
        emergencyStatus: "PENDING_APPROVAL",
        items: { create: itemsWithPrice }
      }
    });

    // ── Gerar boleto Asaas automaticamente ──────────────────────────────────
    let boletoUrl: string | null = null;
    const shortId = order.id.slice(-6).toUpperCase();

    const asaasResult = await createAsaasPayment({
      userName: user.name || user.email || "",
      userEmail: user.email || "",
      cpfCnpj: user.cpfCnpj || "",
      totalAmount: finalTotal,
      orderId: order.id,
      description: `Pedido #${shortId} — Hakim Congelados (EMERGÊNCIA)`
    });

    if (asaasResult) {
      boletoUrl = asaasResult.boletoUrl;
      await prisma.order.update({
        where: { id: order.id },
        data: {
          boletoUrl: asaasResult.boletoUrl,
          asaasPaymentId: asaasResult.paymentId
        }
      });
    }

    return NextResponse.json({ success: true, orderId: order.id, boletoUrl });

  } catch (error: any) {
    console.error("Erro na emergência:", error);
    return NextResponse.json({ error: error.message || "Erro interno no servidor" }, { status: 500 });
  }
}
