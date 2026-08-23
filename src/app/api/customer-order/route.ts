import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateDailyOrderNumber } from "@/lib/order-number";
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
    const { franchiseeSlug, franchiseeId, customerName, customerPhone, customerAddress, deliveryType, paymentMethod, notes, items, couponCode, deliveryFee } = body;

    if ((!franchiseeSlug && !franchiseeId) || !customerName || !customerPhone || !items || items.length === 0) {
      return NextResponse.json({ error: "Dados incompletos." }, { status: 400 });
    }

    // Buscar franqueado com config por ID ou Slug
    const franchisee = await prisma.user.findFirst({
      where: franchiseeId ? { id: franchiseeId } : { slug: franchiseeSlug },
      select: {
        id: true, slug: true, storeName: true, storeOpen: true, storePause: true,
        autoAcceptOrders: true, allowScheduledOrders: true, storeCoupons: true, deliveryConfig: true
      }
    });
    if (!franchisee) return NextResponse.json({ error: "Loja não encontrada." }, { status: 404 });

    // Validar se agendamento está desativado
    if ((body.scheduledDatetime || body.scheduledDate || body.isScheduled) && franchisee.allowScheduledOrders === false) {
      return NextResponse.json({ error: "Esta loja não está aceitando pedidos agendados no momento." }, { status: 400 });
    }

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
    // ISOLAMENTO ENTRE LOJAS: o produto TEM que ser desta loja.
    // Esta rota e PUBLICA. Sem o filtro de franchiseeId, qualquer pessoa na
    // internet mandava no carrinho da loja A um menuProductId da loja B: o
    // pedido nascia na loja A, mas a baixa de estoque seguia a ficha tecnica
    // daquele produto e derrubava o insumo DA LOJA B. De quebra, a fila de
    // impressao devolvia o objeto inteiro do produto alheio, inclusive o campo
    // `cost` — a margem do concorrente.
    const productIds = items.map((i: any) => i.menuProductId).filter(Boolean);
    const menuProducts = await prisma.menuProduct.findMany({
      where: { id: { in: productIds }, active: true, franchiseeId: franchisee.id }
    });

    // Calcular total dos produtos
    let totalAmount = 0;
    const orderItems = items.map((item: any) => {
      const product = menuProducts.find(p => p.id === item.menuProductId);
      // Antes isto era um throw solto, que caia no catch generico e virava 500
      // sem explicacao. Agora o cliente entende o que aconteceu.
      if (!product) {
        throw Object.assign(
          new Error("Um dos itens do carrinho não está mais disponível nesta loja."),
          { statusCode: 400 }
        );
      }
      totalAmount += product.price * item.quantity;
      // `notes` e a observacao POR ITEM ("sem cebola"). O carrinho ja mandava
      // (CustomerStorePage envia notes em cada item) e a impressao/KDS ja liam
      // i.notes — mas aqui ela era descartada, entao nunca chegava na cozinha.
      return {
        menuProductId: product.id,
        quantity: item.quantity,
        price: product.price,
        notes: typeof item.notes === "string" && item.notes.trim() ? item.notes.trim().slice(0, 500) : null,
        comboSelections: item.comboSelections || null,
      };
    });

    // Regra de Frete Grátis por valor mínimo da loja
    const delivConfig = (franchisee.deliveryConfig as any) || {};
    const isFreeShippingMin = Boolean(
      deliveryType === "DELIVERY" &&
      (delivConfig.freeShippingActive === true || delivConfig.freeShippingActive === "true") &&
      delivConfig.freeShippingMinValue &&
      Number(delivConfig.freeShippingMinValue) > 0 &&
      totalAmount >= Number(delivConfig.freeShippingMinValue)
    );

    // ── TAXA DE ENTREGA: VEM DO CLIENTE, ENTÃO NÃO SE CONFIA ──────────────
    // Esta rota é PÚBLICA e `deliveryFee` chega no corpo da requisição. Sem
    // piso, um `deliveryFee: -195` num carrinho de R$ 200 fazia o total virar
    // R$ 5,00 — e era esse valor que ia para o banco e, de lá, para a
    // cobrança no gateway. Frete negativo não existe: qualquer valor abaixo
    // de zero é descartado.
    //
    // O teto é rede de segurança contra o oposto (inflar o pedido de outra
    // pessoa): frete acima de R$ 200 ou maior que 3x o valor dos itens não é
    // frete, é erro ou abuso.
    const feeInformada = deliveryType === "DELIVERY" ? Number(deliveryFee) : 0;
    const feeEhNumero = Number.isFinite(feeInformada);

    // O teto é ABSOLUTO de propósito, não proporcional ao valor dos itens.
    // `totalAmount` sai subestimado quando o pedido tem combo com adicional
    // (bug conhecido e ainda não corrigido, fora do escopo desta mudança), e
    // amarrar o teto a ele faria frete legítimo ser zerado justamente nos
    // pedidos com combo. R$ 300 de entrega não existe em delivery de bairro.
    const TETO_FRETE = 300;
    const feeForaDaFaixa = !feeEhNumero || feeInformada < 0 || feeInformada > TETO_FRETE;

    if (deliveryType === "DELIVERY" && feeForaDaFaixa && deliveryFee !== undefined && deliveryFee !== null) {
      console.warn(
        `[customer-order] deliveryFee recusado (${JSON.stringify(deliveryFee)}) na loja ${franchisee.id} — gravando 0.`
      );
    }

    const originalFee = feeForaDaFaixa ? 0 : feeInformada;
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

    // Arredonda para centavos ANTES de gravar. Em JS 29.9*3 = 89.69999999999999,
    // e era esse número que ia para o banco (`totalAmount Float`) e daí cru como
    // `transaction_amount` para o gateway — que recusa moeda com mais de 2 casas.
    const centavos = (n: number) => Math.round(n * 100) / 100;
    const finalTotal = centavos(Math.max(0, totalAmount - discount + fee));
    // A taxa é gravada ao lado do total e entra em relatório; arredondar só o
    // total deixaria os dois divergindo em frações de centavo.
    fee = centavos(fee);
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

    const dailyOrderNumber = isOnlinePayment 
      ? null 
      : await generateDailyOrderNumber(franchisee.id);

    // Criar pedido
    const order = await prisma.customerOrder.create({
      data: {
        franchiseeId: franchisee.id,
        dailyOrderNumber,
        customerName, customerPhone,
        customerAddress: customerAddress || null,
        deliveryType: deliveryType || "DELIVERY",
        paymentMethod: paymentMethod || null,
        changeAmount: body.changeAmount ? Number(body.changeAmount) : (body.changeFor ? Number(body.changeFor) : null),
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
    // Erros de validacao carregam statusCode e devem chegar ao cliente como 4xx
    // com a mensagem util, em vez de virarem "Erro interno" 500.
    const status = typeof error?.statusCode === "number" ? error.statusCode : 500;
    return NextResponse.json(
      { error: status === 500 ? "Erro interno." : error.message },
      { status }
    );
  }
}
