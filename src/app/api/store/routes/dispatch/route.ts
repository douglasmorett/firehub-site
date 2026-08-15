import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendEvolutionMessage } from "@/lib/whatsapp-evolution";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const body = await req.json();
    const { routeId, motoboyId } = body;

    if (!routeId) {
      return NextResponse.json({ error: "ID da rota não informado" }, { status: 400 });
    }

    const route = await prisma.routeSchedule.findUnique({
      where: { id: routeId },
      include: {
        orders: true,
        motoboy: true,
      },
    });

    if (!route) {
      return NextResponse.json({ error: "Rota não encontrada" }, { status: 404 });
    }

    const finalMotoboyId = motoboyId || route.motoboyId;
    if (!finalMotoboyId) {
      return NextResponse.json({ error: "Selecione um motoboy para poder despachar a rota!" }, { status: 400 });
    }

    const motoboy = await prisma.motoboy.findUnique({
      where: { id: finalMotoboyId },
    });

    if (!motoboy) {
      return NextResponse.json({ error: "Motoboy não encontrado" }, { status: 404 });
    }

    // 1. Atualiza status da rota no banco
    await prisma.routeSchedule.update({
      where: { id: routeId },
      data: {
        status: "DISPATCHED",
        motoboyId: finalMotoboyId,
        dispatchedAt: new Date(),
      },
    });

    // 2. Atualiza todos os pedidos para SAIU_ENTREGA e vincula ao motoboy
    await prisma.customerOrder.updateMany({
      where: { routeId },
      data: {
        status: "SAIU_ENTREGA",
        motoboyId: finalMotoboyId,
        isRoutePriority: false, // Pedido saiu da cozinha!
      },
    });

    const targetFranchiseeId = route.franchiseeId || "";

    // 2.5 Sync com plataformas externas (Jotajá + iFood) — assíncrono, não bloqueia resposta
    (async () => {
      for (const ord of route.orders) {
        // ── Sync Jotajá (Open Delivery) ──
        if (ord.openDeliveryOrderId) {
          try {
            const { jotajaMutate } = await import("@/lib/jotaja-api");
            const odId = ord.openDeliveryOrderId;
            // Garantir startPreparation antes do dispatch
            if (ord.status === "ACEITO" || ord.status === "NOVO") {
              await jotajaMutate(`/v1/orders/${odId}/startPreparation`, { method: "POST" }, targetFranchiseeId).catch(() => {});
            }
            const r = await jotajaMutate(`/v1/orders/${odId}/dispatch`, { method: "POST" }, targetFranchiseeId);
            console.log(`[Route Dispatch → Jotajá] dispatch ${odId}: ${r.status}`);
          } catch (err: any) {
            console.warn(`[Route Dispatch → Jotajá] Erro sync ${ord.openDeliveryOrderId}:`, err?.message);
          }
        }
        // ── Sync iFood ──
        if (ord.ifoodOrderId) {
          try {
            const { getIfoodToken } = await import("@/lib/ifood-api");
            const token = await getIfoodToken();
            const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
            const baseUrl = `https://merchant-api.ifood.com.br/order/v1.0/orders/${ord.ifoodOrderId}`;
            if (ord.status === "ACEITO" || ord.status === "NOVO") {
              await fetch(`${baseUrl}/startPreparation`, { method: "POST", headers }).catch(() => {});
            }
            await fetch(`${baseUrl}/readyToPickup`, { method: "POST", headers }).catch(() => {});
            const r = await fetch(`${baseUrl}/dispatch`, { method: "POST", headers });
            console.log(`[Route Dispatch → iFood] dispatch ${ord.ifoodOrderId}: ${r.status}`);
          } catch (err: any) {
            console.warn(`[Route Dispatch → iFood] Erro sync ${ord.ifoodOrderId}:`, err?.message);
          }
        }
      }
    })();


    // 3. Notifica cada cliente via WhatsApp que o pedido saiu para entrega
    for (const ord of route.orders) {
      if (ord.customerPhone) {
        const phoneDigits = ord.customerPhone.replace(/\D/g, "");
        if (phoneDigits) {
          const formattedPhone = phoneDigits.startsWith("55") ? phoneDigits : `55${phoneDigits}`;
          const displayNum = (ord as any).dailyOrderNumber ? `#${(ord as any).dailyOrderNumber}` : (ord.ifoodReference || ord.openDeliveryReference || "");
          const msg = `🚨 *Seu Pedido ${displayNum} Saiu para Entrega!*\n\n🛵 Entregador: *${motoboy.name}*\nO seu pedido já está a caminho com a nossa rota. Bom apetite! 🚀`;
          sendEvolutionMessage(targetFranchiseeId, formattedPhone, msg).catch(() => {});
        }
      }
    }

    // 4. Monta o link da rota completa no Google Maps para o motoboy
    if (motoboy.phone) {
      const addresses = route.orders
        .map((o) => o.customerAddress)
        .filter(Boolean) as string[];

      if (addresses.length > 0) {
        const origin = encodeURIComponent("Rio das Ostras, RJ"); // Ou endereço base da loja
        const waypoints = addresses.map((a) => encodeURIComponent(a)).join("/");
        const mapsUrl = `https://www.google.com/maps/dir/${origin}/${waypoints}`;

        let summaryText = `🚀 *NOVA ROTA ATRIBUÍDA: ${route.routeNumber}*\n\n`;
        summaryText += `📦 *Total de Pedidos:* ${route.orders.length}\n\n`;
        summaryText += `📍 *Paradas da Rota:*\n`;

        route.orders.forEach((o, idx) => {
          const displayNum = (o as any).dailyOrderNumber ? `#${(o as any).dailyOrderNumber}` : (o.ifoodReference || o.openDeliveryReference || "");
          summaryText += `${idx + 1}️⃣ *Pedido ${displayNum}*: ${o.customerName || "Cliente"}\n   🏠 ${o.customerAddress || "Sem endereço"}\n`;
        });

        summaryText += `\n🗺️ *Navegação GPS (Google Maps):*\n${mapsUrl}`;

        const motoboyPhoneDigits = motoboy.phone.replace(/\D/g, "");
        if (motoboyPhoneDigits) {
          const formattedMotoboyPhone = motoboyPhoneDigits.startsWith("55") ? motoboyPhoneDigits : `55${motoboyPhoneDigits}`;
          sendEvolutionMessage(targetFranchiseeId, formattedMotoboyPhone, summaryText).catch(() => {});
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: `🚀 Rota ${route.routeNumber} despachada com sucesso com o motoboy ${motoboy.name}!`,
    });
  } catch (err: any) {
    console.error("[POST /api/store/routes/dispatch Error]:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
