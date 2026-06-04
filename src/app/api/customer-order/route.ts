import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { trackSaleForBilling } from "@/lib/billing";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { franchiseeSlug, customerName, customerPhone, customerAddress, deliveryType, paymentMethod, notes, items, couponCode, deliveryFee } = body;

    if (!franchiseeSlug || !customerName || !customerPhone || !items || items.length === 0) {
      return NextResponse.json({ error: "Dados incompletos." }, { status: 400 });
    }

    // Buscar franqueado com config
    const franchisee = await prisma.user.findUnique({
      where: { slug: franchiseeSlug },
      select: {
        id: true, storeName: true, storeOpen: true, storePause: true,
        autoAcceptOrders: true, storeCoupons: true
      }
    });
    if (!franchisee) return NextResponse.json({ error: "Loja não encontrada." }, { status: 404 });

    // Verificar se loja está operando
    if (franchisee.storeOpen === false) {
      return NextResponse.json({ error: "Loja fechada no momento." }, { status: 400 });
    }

    // Verificar pausa programada
    const pause = franchisee.storePause as any;
    if (pause?.active) {
      const today = new Date();
      const from = new Date(pause.from + "T00:00");
      const to = new Date(pause.to + "T23:59");
      if (today >= from && today <= to) {
        return NextResponse.json({ error: `Loja em pausa até ${to.toLocaleDateString("pt-BR")}.` }, { status: 400 });
      }
    }

    // Buscar produtos do menu
    const productIds = items.map((i: any) => i.menuProductId).filter(Boolean);
    const menuProducts = await prisma.menuProduct.findMany({
      where: { id: { in: productIds }, active: true }
    });

    // Calcular total
    let totalAmount = 0;
    const orderItems = items.map((item: any) => {
      const product = menuProducts.find(p => p.id === item.menuProductId);
      if (!product) throw new Error("Produto não encontrado: " + item.menuProductId);
      totalAmount += product.price * item.quantity;
      return { menuProductId: product.id, quantity: item.quantity, price: product.price, comboSelections: item.comboSelections || null };
    });

    // Aplicar cupom de desconto
    let discount = 0;
    if (couponCode) {
      const coupons = (franchisee.storeCoupons as any[]) || [];
      const coupon = coupons.find((c: any) =>
        c.code?.toLowerCase() === couponCode.toLowerCase() && c.active
      );
      if (coupon) {
        if (coupon.type === "percent") discount = totalAmount * (coupon.value / 100);
        else discount = coupon.value;
        discount = Math.min(discount, totalAmount);
      }
    }

    // Taxa de entrega
    const fee = deliveryType === "DELIVERY" ? (deliveryFee || 0) : 0;
    const finalTotal = Math.max(0, totalAmount - discount + fee);

    // Status inicial: auto-aceitar ou aguardar
    const initialStatus = franchisee.autoAcceptOrders ? "ACEITO" : "NOVO";

    // Criar pedido
    const order = await prisma.customerOrder.create({
      data: {
        franchiseeId: franchisee.id,
        customerName, customerPhone,
        customerAddress: customerAddress || null,
        deliveryType: deliveryType || "DELIVERY",
        paymentMethod: paymentMethod || null,
        notes: notes || null,
        totalAmount: finalTotal,
        deliveryFee: fee,
        status: initialStatus,
        items: { create: orderItems }
      }
    });

    // Incrementar contador de pedidos (Pay as You Grow)
    await prisma.user.update({
      where: { id: franchisee.id },
      data: { storeOrderCount: { increment: 1 } }
    });

    // Se auto-aceito, já contabiliza no faturamento e deduz estoque imediatamente
    if (franchisee.autoAcceptOrders) {
      trackSaleForBilling(franchisee.id).catch(err =>
        console.error("[Billing] Erro ao atualizar ciclo:", err)
      );
      const { deductStockForOrder } = await import("@/lib/stock");
      deductStockForOrder(order.id).catch(err =>
        console.error("[Stock] Erro ao deduzir estoque auto-aceito:", err)
      );
    }

    return NextResponse.json({
      orderId: order.id,
      total: finalTotal,
      discount,
      status: initialStatus,
      autoAccepted: franchisee.autoAcceptOrders,
    });

  } catch (error: any) {
    console.error("Erro ao criar pedido:", error);
    return NextResponse.json({ error: error.message || "Erro interno." }, { status: 500 });
  }
}
