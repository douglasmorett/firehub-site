import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { trackSaleForBilling } from "@/lib/billing";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

export async function POST(req: Request) {
  try {
    // ── Rate Limiting ────────────────────────────────────────────────────────
    const ip = getClientIp(req);
    const { allowed } = checkRateLimit(`create-order:${ip}`, { windowMs: 60000, maxRequests: 20 });
    if (!allowed) {
      return NextResponse.json({ error: "Muitas requisições. Tente novamente em 1 minuto." }, { status: 429 });
    }

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
        autoAcceptOrders: true, storeCoupons: true, deliveryConfig: true
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

    // Calcular total dos produtos
    let totalAmount = 0;
    const orderItems = items.map((item: any) => {
      const product = menuProducts.find(p => p.id === item.menuProductId);
      if (!product) throw new Error("Produto não encontrado: " + item.menuProductId);
      totalAmount += product.price * item.quantity;
      return { menuProductId: product.id, quantity: item.quantity, price: product.price, comboSelections: item.comboSelections || null };
    });

    // Regra de Frete Grátis por valor mínimo da loja
    const delivConfig = (franchisee.deliveryConfig as any) || {};
    const isFreeShippingMin = Boolean(
      deliveryType === "DELIVERY" &&
      delivConfig.freeShippingActive &&
      delivConfig.freeShippingMinValue &&
      totalAmount >= Number(delivConfig.freeShippingMinValue)
    );

    // Taxa de entrega base informada
    const originalFee = deliveryType === "DELIVERY" ? (deliveryFee || 0) : 0;
    let fee = originalFee;
    let freeShippingNote = "";

    if (isFreeShippingMin) {
      fee = 0; // Isenta a taxa cobrada
      freeShippingNote = ` [Frete Grátis (Pedido >= R$ ${Number(delivConfig.freeShippingMinValue).toFixed(2).replace('.', ',')}) — Taxa ref: R$ ${originalFee.toFixed(2).replace('.', ',')}]`;
    }

    // Aplicar cupom de desconto
    let discount = 0;
    if (couponCode) {
      const coupons = (franchisee.storeCoupons as any[]) || [];
      const coupon = coupons.find((c: any) =>
        c.code?.toLowerCase() === couponCode.toLowerCase() && c.active !== false
      );
      if (coupon) {
        if (coupon.minOrderValue && totalAmount < coupon.minOrderValue) {
          discount = 0;
        } else {
          if (coupon.type === "free_shipping") {
            discount = fee;
            fee = 0;
          } else if (coupon.type === "fixed") {
            discount = typeof coupon.discount === "number" ? coupon.discount : (coupon.value || 0);
          } else if (coupon.type === "percent") {
            const pct = typeof coupon.discount === "number" ? coupon.discount : (coupon.value || 10);
            discount = totalAmount * (pct / 100);
          } else {
            const pct = typeof coupon.discount === "number" ? coupon.discount : (coupon.value || 10);
            discount = totalAmount * (pct / 100);
          }
          discount = Math.min(discount, totalAmount + fee);
        }
      }
    }

    const finalTotal = Math.max(0, totalAmount - discount + fee);
    let orderNotes = notes || "";
    if (couponCode && discount > 0) {
      orderNotes = `[Cupom: ${couponCode.trim().toUpperCase()}] ${orderNotes}`.trim();
    }
    if (freeShippingNote) {
      orderNotes = `${orderNotes} ${freeShippingNote}`.trim();
    }
    const finalNotes = orderNotes || null;

    const pmUpper = (paymentMethod || "").toUpperCase().trim();
    const isOnlinePayment = pmUpper.includes("ONLINE") || pmUpper === "PIX" || pmUpper === "PIX_ONLINE" || pmUpper === "CREDITO_ONLINE" || pmUpper === "DEBITO_ONLINE";

    const initialStatus = isOnlinePayment
      ? "AGUARDANDO_PAGAMENTO"
      : franchisee.autoAcceptOrders
      ? "ACEITO"
      : "NOVO";

    const initialKdsStage = isOnlinePayment ? null : "PRODUCTION";
    const initialKdsProductionAt = isOnlinePayment ? null : new Date();

    // Criar pedido
    const order = await prisma.customerOrder.create({
      data: {
        franchiseeId: franchisee.id,
        customerName, customerPhone,
        customerAddress: customerAddress || null,
        deliveryType: deliveryType || "DELIVERY",
        paymentMethod: paymentMethod || null,
        notes: finalNotes,
        totalAmount: finalTotal,
        deliveryFee: fee,
        status: initialStatus,
        kdsStage: initialKdsStage,
        kdsProductionAt: initialKdsProductionAt,
        items: { create: orderItems }
      }
    });

    // Se NÃO for pagamento online (ex: dinheiro/maquininha na entrega), envia direto para a fila de impressão da loja!
    if (!isOnlinePayment) {
      try {
        const { pushJobToPrintQueue } = await import("@/app/api/store/print-queue/route");
        const formattedOrder = {
          id: order.id,
          dailyOrderNumber: order.id.slice(-4).toUpperCase(),
          customerName: order.customerName,
          customerPhone: order.customerPhone,
          customerAddress: order.customerAddress,
          deliveryType: order.deliveryType || "DELIVERY",
          paymentMethod: order.paymentMethod || "Não informado",
          isPrepaid: false,
          items: orderItems.map((i: any) => ({
            name: menuProducts.find(p => p.id === i.menuProductId)?.name || "Item",
            qty: i.quantity,
            price: i.price,
            comboSelections: i.comboSelections,
          })),
          totalAmount: finalTotal,
          deliveryFee: fee,
          notes: finalNotes,
          createdAt: order.createdAt.toISOString(),
        };
        pushJobToPrintQueue(franchisee.id, formattedOrder, franchisee.storeName || "FIREHUB", "80mm");
      } catch (errPrint) {
        console.error("[CustomerOrder] Auto-print error:", errPrint);
      }
    }

    // Incrementar contador de pedidos (Pay as You Grow)
    await prisma.user.update({
      where: { id: franchisee.id },
      data: { storeOrderCount: { increment: 1 } }
    });

    // Envia notificação WhatsApp de confirmação de pedido recebido apenas se for pagamento presencial (não-online)
    if (!isOnlinePayment) {
      const { sendOrderNotification } = await import("@/lib/order-notifications");
      sendOrderNotification(order.id, "CREATED").catch(err =>
        console.warn("[CustomerOrder] Erro ao enviar notificação CREATED:", err)
      );
    }

    // Se auto-aceito e não-online, contabiliza no faturamento e deduz estoque imediatamente
    if (franchisee.autoAcceptOrders && !isOnlinePayment) {
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
