import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, ownerId: true, email: true }
    });
    if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

    const targetFranchiseeId = user.ownerId || user.id;
    const body = await req.json();

    const {
      orderIdInput, // ex: 32522836 ou 2366
      customerName,
      customerPhone,
      customerAddress,
      totalAmount,
      paymentMethod,
      itemsSummary,
    } = body;

    if (!orderIdInput && !customerName) {
      return NextResponse.json({ error: "Informe o número do pedido JotaJá ou dados do cliente" }, { status: 400 });
    }

    const cleanRef = String(orderIdInput || "").replace(/#/g, "").trim();
    const orderKey = `manual_jotaja_${cleanRef || Date.now()}_${targetFranchiseeId}`;

    // Tentar buscar na API oficial do JotaJá via Open Delivery se tiver id numérico/UUID
    if (cleanRef) {
      try {
        const { jotajaFetch, jotajaMutate } = await import("@/lib/jotaja-api");
        const { processJotajaEvent } = await import("@/lib/processJotajaEvent");

        const eventFake = { orderId: cleanRef, eventType: "CREATED", code: "PLC" };
        const result = await processJotajaEvent(eventFake, jotajaFetch, jotajaMutate);

        if (result.action === "created" || result.action === "updated") {
          return NextResponse.json({
            ok: true,
            message: `✅ Pedido #${cleanRef} importado com sucesso via API JotaJá!`,
            orderId: result.orderId
          });
        }
      } catch (err: any) {
        console.warn("[Import JotaJá] Tentativa via API Open Delivery falhou:", err?.message);
      }
    }

    // Fallback: criação direta resiliente no banco com os dados informados
    const refTag = cleanRef || "MANUAL";
    const ord = await prisma.customerOrder.create({
      data: {
        franchiseeId: targetFranchiseeId,
        source: "JOTAJA",
        openDeliveryChannel: "JOTAJA",
        openDeliveryOrderId: orderKey,
        openDeliveryReference: refTag,
        customerName: customerName || `Cliente JotaJá #${refTag}`,
        customerPhone: customerPhone || "",
        customerAddress: customerAddress || "",
        totalAmount: Number(totalAmount) || 0,
        deliveryFee: 0,
        paymentMethod: paymentMethod || "JotaJá Online",
        deliveryType: (customerAddress && customerAddress.trim().length > 3) ? "DELIVERY" : "RETIRADA",
        status: "NOVO",
        notes: `Pedido JotaJá #${refTag}${itemsSummary ? ` | ${itemsSummary}` : ""}`,
        items: {
          create: [
            {
              quantity: 1,
              price: Number(totalAmount) || 0,
              menuProduct: {
                connectOrCreate: {
                  where: { id: `jotaja-item-${refTag}_${targetFranchiseeId}` },
                  create: {
                    id: `jotaja-item-${refTag}_${targetFranchiseeId}`,
                    franchiseeId: targetFranchiseeId,
                    name: itemsSummary || `Pedido JotaJá #${refTag}`,
                    description: `Pedido JotaJá #${refTag}`,
                    price: Number(totalAmount) || 0,
                    category: "JotaJá",
                  }
                }
              }
            }
          ]
        }
      }
    });

    // Disparar impressão na nuvem
    try {
      const { pushJobToPrintQueue } = await import("@/app/api/store/print-queue/route");
      pushJobToPrintQueue(targetFranchiseeId, ord, "HAKIM RIO DAS OSTRAS");
    } catch {}

    return NextResponse.json({
      ok: true,
      message: `✅ Pedido JotaJá #${refTag} de ${ord.customerName} adicionado e enviado para impressão!`,
      order: ord
    });
  } catch (err: any) {
    console.error("[Import JotaJá] Erro:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
