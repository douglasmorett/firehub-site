import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/ifood/import-order
 * Importa manualmente um pedido do iFood que não foi capturado pelo poll.
 * Body: { orderId: string } ou { reference: string }
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const { orderId, reference } = body as { orderId?: string; reference?: string };

  if (!orderId && !reference) {
    return NextResponse.json({ error: "orderId ou reference é obrigatório" }, { status: 400 });
  }

  const log: string[] = [];

  try {
    const { getIfoodToken } = await import("@/lib/ifood-api");
    const token = await getIfoodToken();
    log.push("✅ Token obtido");

    // Get franchisee
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, ownerId: true, ifoodMerchantId: true },
    });
    if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
    const franchiseeId = user.ownerId || user.id;
    const merchantId = user.ifoodMerchantId;

    let actualOrderId = orderId;

    if (!actualOrderId && reference && merchantId) {
      const ordersRes = await fetch(
        `https://merchant-api.ifood.com.br/order/v1.0/orders?merchantId=${merchantId}&sort=NEWEST`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (ordersRes.ok) {
        const orders = await ordersRes.json();
        log.push(`📋 ${orders.length || 0} pedidos encontrados no merchant`);
        const match = orders.find((o: any) => 
          o.displayId === reference || 
          o.shortReference === reference ||
          o.orderNumber === reference ||
          String(o.displayId).includes(reference)
        );
        if (match) {
          actualOrderId = match.id;
          log.push(`✅ Pedido encontrado: ${match.id} (ref: ${reference})`);
        }
      }
    }

    if (!actualOrderId) {
      log.push(`❌ Pedido com referência "${reference}" não encontrado via API`);
      return NextResponse.json({ ok: false, log, error: "Pedido não encontrado na API iFood" });
    }

    // Verificar se já existe
    const existing = await prisma.customerOrder.findFirst({
      where: { ifoodOrderId: actualOrderId },
    });
    if (existing) {
      log.push(`⚠️ Pedido já existe no sistema (ID: ${existing.id})`);
      return NextResponse.json({ ok: true, log, message: "Pedido já existe no sistema", orderId: existing.id });
    }

    // Detalhes completos
    const orderRes = await fetch(
      `https://merchant-api.ifood.com.br/order/v1.0/orders/${actualOrderId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!orderRes.ok) {
      log.push(`❌ Erro ao buscar detalhes: ${orderRes.status}`);
      return NextResponse.json({ ok: false, log, error: `Erro iFood: ${orderRes.status}` });
    }

    const orderData = await orderRes.json();
    log.push(`✅ Detalhes obtidos: ${orderData.displayId || actualOrderId}`);

    const { getIfoodItemUnitPrice } = await import("@/lib/ifood-api");
    const items = (orderData.items ?? []).map((i: any) => {
      const subItemsList = i.options || i.subItems || i.garnishItems || i.items || [];
      const comboSels = Array.isArray(subItemsList) && subItemsList.length > 0
        ? JSON.stringify(subItemsList.map((s: any) => ({
            name: s.name || s.label || s.productName || "",
            quantity: s.quantity || 1,
            price: s.price || s.unitPrice || s.addition || 0,
          })))
        : null;

      const itemUnitPrice = getIfoodItemUnitPrice(i);

      return {
        price: itemUnitPrice,
        quantity: i.quantity ?? 1,
        comboSelections: comboSels,
        menuProduct: {
          connectOrCreate: {
            where: { id: i.id || "dummy_id" },
            create: {
              name: i.name || "Item iFood",
              price: itemUnitPrice,
              description: "",
              category: "iFood",
              franchiseeId,
            },
          },
        },
      };
    });

    const customer = orderData.customer || {};
    const delivery = orderData.delivery || {};
    const address = delivery.deliveryAddress || customer.address || {};

    const deliveryFee = orderData.deliveryFee?.value ?? orderData.deliveryFee ?? 
      (orderData.total?.deliveryFee) ?? 0;

    const totalAmount = orderData.totalPrice ?? orderData.total?.orderAmount ?? 
      orderData.orderAmount ?? 0;

    const payments = orderData.payments?.methods || orderData.payments || [];
    const pmLabel = payments[0]?.method || payments[0]?.type || "iFood";
    const payMethod = pmLabel.toUpperCase().includes("PIX") ? "Pix (iFood Pago Online)"
      : pmLabel.toUpperCase().includes("CREDIT") || pmLabel.toUpperCase().includes("CRÉDITO") ? "Cartão (iFood Pago Online)"
      : pmLabel.toUpperCase().includes("DEBIT") || pmLabel.toUpperCase().includes("DÉBITO") ? "Débito (iFood Pago Online)"
      : pmLabel.toUpperCase().includes("CASH") || pmLabel.toUpperCase().includes("DINHEIRO") ? "Dinheiro"
      : `${pmLabel} (iFood Pago Online)`;

    const benefits = orderData.benefits || [];
    const discountMerchant = benefits
      .filter((b: any) => b.sponsorshipValues?.some?.((s: any) => s.name === "MERCHANT"))
      .reduce((s: number, b: any) => s + (b.value || 0), 0);
    const discountIfood = benefits
      .filter((b: any) => b.sponsorshipValues?.some?.((s: any) => s.name === "IFOOD"))
      .reduce((s: number, b: any) => s + (b.value || 0), 0);

    const logistics = orderData.logistics || {};
    const deliveryBy = logistics.deliveryBy || "MERCHANT";

    const formattedAddress = [
      address.streetName,
      address.streetNumber,
      address.neighborhood || address.district,
      address.city,
    ].filter(Boolean).join(", ") || address.formattedAddress || "";

    const newOrder = await (prisma.customerOrder as any).create({
      data: {
        franchiseeId,
        customerName: customer.name || "Cliente iFood",
        customerPhone: customer.phone?.number || customer.phone || "",
        customerAddress: formattedAddress,
        status: "ACEITO",
        paymentMethod: payMethod,
        totalAmount,
        deliveryFee: typeof deliveryFee === "number" ? deliveryFee : 0,
        notes: orderData.extraInfo || "",
        source: "IFOOD",
        ifoodOrderId: actualOrderId,
        ifoodReference: orderData.displayId || reference || "",
        discountMerchant,
        discountIfood,
        deliveryBy,
        items: { create: items },
      },
    });

    log.push(`✅ Pedido importado com sucesso! ID: ${newOrder.id}`);

    return NextResponse.json({
      ok: true,
      log,
      orderId: newOrder.id,
      ifoodReference: orderData.displayId,
      message: "Pedido importado com sucesso!",
    });
  } catch (err: any) {
    log.push(`❌ Erro: ${err.message}`);
    console.error("[iFood Import] Erro:", err);
    return NextResponse.json({ ok: false, error: err.message, log }, { status: 500 });
  }
}
