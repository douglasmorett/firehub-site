import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateDailyOrderNumber } from "@/lib/order-number";
import { jwtVerify } from "jose";

const secret = new TextEncoder().encode(process.env.NEXTAUTH_SECRET || "fallback-secret");

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { token, customerName, items, notes, paymentMethod } = body;

    if (!token) return NextResponse.json({ error: "Token obrigatório" }, { status: 400 });
    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "Carrinho vazio" }, { status: 400 });
    }

    // Verify token
    let payload: any;
    try {
      const result = await jwtVerify(token, secret);
      payload = result.payload;
    } catch {
      return NextResponse.json({ error: "Token inválido" }, { status: 401 });
    }

    const license = await prisma.totemLicense.findUnique({
      where: { id: payload.licenseId },
      select: { id: true, franchiseeId: true, active: true, label: true }
    });

    if (!license || !license.active) {
      return NextResponse.json({ error: "Licença inválida" }, { status: 403 });
    }

    // Buscar produtos para validar preços
    const productIds = items.map((i: any) => i.menuProductId);
    const dbProducts = await prisma.menuProduct.findMany({
      where: { id: { in: productIds }, franchiseeId: license.franchiseeId, active: true },
      include: {
        comboGroups: { include: { items: { include: { menuProduct: true } } } }
      }
    });

    const productMap = new Map(dbProducts.map(p => [p.id, p]));

    // Calcular total verificado pelo servidor
    let totalAmount = 0;
    const orderItems: Array<{ menuProductId: string; quantity: number; price: number; comboSelections: any }> = [];

    for (const item of items) {
      const product = productMap.get(item.menuProductId);
      if (!product) continue;

      let itemPrice = product.price;

      // Calcular acréscimos de combo
      if (item.comboSelections && product.isCombo) {
        for (const group of product.comboGroups) {
          const groupSelections = item.comboSelections[group.id];
          if (!groupSelections) continue;
          for (const comboItem of group.items) {
            const qty = groupSelections[comboItem.menuProduct.name] || 0;
            if (qty > 0 && comboItem.additionalPrice) {
              itemPrice += comboItem.additionalPrice * qty;
            }
          }
        }
      }

      const quantity = Math.max(1, Math.min(99, item.quantity || 1));
      totalAmount += itemPrice * quantity;

      orderItems.push({
        menuProductId: product.id,
        quantity,
        price: itemPrice,
        comboSelections: item.comboSelections || null,
      });
    }

    if (orderItems.length === 0) {
      return NextResponse.json({ error: "Nenhum produto válido no carrinho" }, { status: 400 });
    }

    // Verificar auto-accept
    const store = await prisma.user.findUnique({
      where: { id: license.franchiseeId },
      select: { autoAcceptOrders: true, storeName: true, name: true }
    });

    const autoAccept = store?.autoAcceptOrders ?? false;
    const initialStatus = autoAccept ? "ACEITO" : "NOVO";

    const dailyOrderNumber = await generateDailyOrderNumber(license.franchiseeId);

    // Criar pedido
    const order = await prisma.customerOrder.create({
      data: {
        franchiseeId: license.franchiseeId,
        dailyOrderNumber,
        customerName: customerName || `Totem ${license.label}`,
        customerPhone: "totem",
        deliveryType: "TAKEOUT", // Totem é sempre retirada no balcão
        paymentMethod: paymentMethod || "Cartão (Maquininha)",
        totalAmount,
        deliveryFee: 0,
        status: initialStatus,
        source: "TOTEM",
        notes: notes || null,
        kdsStage: "PRODUCTION",
        totemLicenseId: license.id,
        items: {
          create: orderItems.map(item => ({
            menuProductId: item.menuProductId,
            quantity: item.quantity,
            price: item.price,
            comboSelections: item.comboSelections,
          }))
        }
      },
      include: { items: true }
    });

    // Incrementar contador de pedidos
    await prisma.user.update({
      where: { id: license.franchiseeId },
      data: { storeOrderCount: { increment: 1 } }
    });

    // Track sale for billing
    const { trackSaleForBilling } = await import("@/lib/billing");
    await trackSaleForBilling(license.franchiseeId);

    // Auto-print (se configurado)
    try {
      const { pushJobToPrintQueue } = await import("@/app/api/store/print-queue/route");
      await pushJobToPrintQueue(license.franchiseeId, order);
    } catch (e) {
      // Print queue optional
    }

    return NextResponse.json({
      success: true,
      order: {
        id: order.id,
        status: order.status,
        totalAmount: order.totalAmount,
        customerName: order.customerName,
        itemCount: order.items.length,
        createdAt: order.createdAt.toISOString(),
      }
    });
  } catch (err) {
    console.error("[Totem Order] Erro:", err);
    return NextResponse.json({ error: "Erro ao criar pedido" }, { status: 500 });
  }
}
