import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/api-key";
import { prisma } from "@/lib/prisma";
import { dispatchOutboundWebhook } from "@/lib/webhook-dispatcher";

export const dynamic = "force-dynamic";

// GET: Listar pedidos com paginação e filtros
export async function GET(req: NextRequest) {
  const auth = await authenticateApiKey(req);
  if (!auth) {
    return NextResponse.json({ error: "Não autorizado.", code: "UNAUTHORIZED" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20", 10)));
  const skip = (page - 1) * limit;

  const whereClause: any = {
    franchiseeId: auth.franchiseeId,
    status: { not: "CRIANDO_IA" },
  };

  if (status) {
    whereClause.status = status;
  }

  const [orders, totalCount] = await Promise.all([
    prisma.customerOrder.findMany({
      where: whereClause,
      include: {
        items: {
          include: {
            menuProduct: { select: { id: true, name: true, price: true } },
          },
        },
        motoboy: { select: { id: true, name: true, phone: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.customerOrder.count({ where: whereClause }),
  ]);

  return NextResponse.json({
    page,
    limit,
    totalCount,
    totalPages: Math.ceil(totalCount / limit),
    orders: orders.map((o) => {
      const refNum = o.openDeliveryReference || o.ifoodReference || o.id.slice(-4).toUpperCase();
      const channel = o.openDeliveryChannel || (o.openDeliveryReference ? "Jotajá" : o.ifoodReference ? "iFood" : "API_EXTERNA");

      return {
        id: o.id,
        firehubOrderNumber: refNum,
        channel,
        status: o.status,
        customerName: o.customerName,
        customerPhone: o.customerPhone,
        customerAddress: o.customerAddress,
        deliveryType: o.deliveryType,
        paymentMethod: o.paymentMethod,
        subtotal: o.totalAmount - (o.deliveryFee || 0),
        deliveryFee: o.deliveryFee,
        totalAmount: o.totalAmount,
        notes: o.notes,
        createdAt: o.createdAt,
        updatedAt: o.updatedAt,
        motoboy: o.motoboy ? { id: o.motoboy.id, name: o.motoboy.name, phone: o.motoboy.phone } : null,
        items: o.items.map((i) => ({
          id: i.id,
          name: i.menuProduct?.name || "Item",
          quantity: i.quantity,
          unitPrice: i.price,
          totalPrice: i.price * i.quantity,
          comboSelections: typeof i.comboSelections === "string" ? JSON.parse(i.comboSelections) : i.comboSelections,
        })),
      };
    }),
  });
}

// POST: Criar/Injetar pedido de sistema parceiro no FireHub
export async function POST(req: NextRequest) {
  const auth = await authenticateApiKey(req);
  if (!auth) {
    return NextResponse.json({ error: "Não autorizado.", code: "UNAUTHORIZED" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const {
      customerName,
      customerPhone,
      customerAddress,
      deliveryType = "DELIVERY",
      paymentMethod = "PIX",
      items,
      subtotal,
      deliveryFee = 0,
      notes,
      externalReference,
      externalChannel = "API_PARCEIRO",
    } = body;

    if (!customerName || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: "Nome do cliente e ao menos 1 item são obrigatórios.", code: "INVALID_BODY" },
        { status: 400 }
      );
    }

    // Calcular subtotal e total
    let computedSubtotal = 0;
    const itemRecordsToCreate: any[] = [];

    for (const item of items) {
      const qty = Math.max(1, item.quantity || 1);
      const price = typeof item.price === "number" ? item.price : 0;
      computedSubtotal += price * qty;

      itemRecordsToCreate.push({
        price,
        quantity: qty,
        menuProductId: item.menuProductId || null,
        comboSelections: item.comboSelections ? JSON.stringify(item.comboSelections) : null,
      });
    }

    const finalSubtotal = typeof subtotal === "number" ? subtotal : computedSubtotal;
    const finalFee = typeof deliveryFee === "number" ? deliveryFee : 0;
    const totalAmount = finalSubtotal + finalFee;

    const newOrder = await prisma.customerOrder.create({
      data: {
        franchiseeId: auth.franchiseeId,
        customerName,
        customerPhone: customerPhone || "—",
        customerAddress: customerAddress || "Retirada na loja",
        deliveryType,
        paymentMethod,
        deliveryFee: finalFee,
        totalAmount,
        notes: notes || null,
        status: "NOVO",
        openDeliveryReference: externalReference || null,
        openDeliveryChannel: externalChannel,
        items: {
          create: itemRecordsToCreate,
        },
      },
      include: {
        items: true,
      },
    });

    // Disparar Webhook de saída (order.created)
    dispatchOutboundWebhook(auth.franchiseeId, "order.created", {
      id: newOrder.id,
      externalReference: newOrder.openDeliveryReference,
      customerName: newOrder.customerName,
      status: newOrder.status,
      totalAmount: newOrder.totalAmount,
    });

    return NextResponse.json({
      success: true,
      order: {
        id: newOrder.id,
        firehubOrderNumber: `#${newOrder.openDeliveryReference || newOrder.id.slice(-4)}`,
        status: newOrder.status,
        customerName: newOrder.customerName,
        totalAmount: newOrder.totalAmount,
        createdAt: newOrder.createdAt,
      },
    }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Erro interno ao criar pedido." }, { status: 500 });
  }
}
