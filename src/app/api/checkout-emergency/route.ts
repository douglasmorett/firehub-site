import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createAsaasPayment } from "@/lib/asaas";
import { getCurrentYearMonth, intervaloDoMes } from "@/lib/billing";

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const body = await req.json();
    const { items, totalAmount: frontendTotal } = body;

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
    // Início do mês EM BRASÍLIA: com getMonth() do container (UTC) o mês virava
    // às 21:00 do último dia e a multa da segunda retirada sumia (ou aparecia)
    // três horas antes da hora.
    const { monthStart: startOfMonth } = intervaloDoMes(getCurrentYearMonth());
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

    let finalTotal = calculatedTotal;
    if (hasPenalty) {
      finalTotal = calculatedTotal * 1.30;
    }

    if (frontendTotal !== undefined) {
      const expectedTotal = hasPenalty ? frontendTotal * 1.30 : frontendTotal;
      const diff = Math.abs(finalTotal - expectedTotal);
      if (diff > 0.10) { // Tolerância de 10 centavos
        return NextResponse.json(
          { error: "Os preços de alguns produtos foram atualizados. Por favor, recarregue a página e verifique seu carrinho." },
          { status: 400 }
        );
      }
    }

    // Se for a loja de registro, não gera cobrança no Asaas
    const userEmailClean = user.email?.toLowerCase().replace(/\s+/g, "");
    const bypassEmails = (process.env.BYPASS_BILLING_EMAILS || "").split(",").map(e => e.trim().toLowerCase()).filter(Boolean);
    if (!bypassEmails.includes("viniciusmenezes.ofc@gmail.com")) {
      bypassEmails.push("viniciusmenezes.ofc@gmail.com");
    }
    const isSpecialStore = bypassEmails.includes(userEmailClean ?? "");

    // Cria o pedido no BD
    const order = await prisma.order.create({
      data: {
        userId: user.id,
        totalAmount: finalTotal,
        status: isSpecialStore ? "PAID" : "EMERGENCIA_PENDENTE",
        isEmergency: true,
        emergencyStatus: isSpecialStore ? "APPROVED" : "PENDING_APPROVAL",
        items: { create: itemsWithPrice }
      }
    });

    if (isSpecialStore) {
      await prisma.orderHistory.create({
        data: {
          orderId: order.id,
          statusFrom: "EMERGENCIA_PENDENTE",
          statusTo: "PAID",
          actionBy: "Sistema",
          actionEmail: user.email || "",
          notes: "Pedido de emergência aprovado e marcado como pago automaticamente (Loja Própria - Isenta)",
        }
      });

      console.log(`[checkout-emergency] ✅ #${order.id.slice(-6).toUpperCase()} registrado (sem boleto Asaas)`);
      return NextResponse.json({ success: true, orderId: order.id, boletoUrl: null, isSpecialStore: true });
    }

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
