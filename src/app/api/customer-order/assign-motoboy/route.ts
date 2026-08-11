/**
 * PATCH /api/customer-order/assign-motoboy
 * Atribui ou remove um motoboy de um pedido e envia notificação no WhatsApp do entregador com o número do FireHub (#171).
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendEvolutionMessage } from "@/lib/whatsapp-evolution";

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { orderId, motoboyId, firehubOrderNumber } = await req.json();
  if (!orderId) return NextResponse.json({ error: "orderId obrigatório" }, { status: 400 });

  const order = await prisma.customerOrder.update({
    where: { id: orderId },
    data: {
      motoboyId: motoboyId || null,
    },
    include: {
      motoboy: true,
      franchisee: true,
    },
  });

  // Disparar notificação automática via WhatsApp para o Motoboy se atribuído
  if (order.motoboy && order.motoboy.phone && order.motoboyId) {
    try {
      const cleanPhone = order.motoboy.phone.replace(/\D/g, "");
      if (cleanPhone.length >= 8) {
        const fullPhone = cleanPhone.startsWith("55") ? cleanPhone : `55${cleanPhone}`;

        const oAny = order as any;

        // PRIORIDADE ABSOLUTA: Número do Pedido no FireHub (ex: #171)
        let firehubSeq = firehubOrderNumber ? String(firehubOrderNumber) : oAny.dailyOrderNumber;
        if (!firehubSeq) {
          const startOfDay = new Date(order.createdAt);
          startOfDay.setHours(0, 0, 0, 0);
          const count = await prisma.customerOrder.count({
            where: {
              franchiseeId: order.franchiseeId,
              createdAt: { gte: startOfDay, lte: order.createdAt },
            },
          });
          firehubSeq = count || order.id.slice(-4).toUpperCase();
        }

        let displayNum = `#${firehubSeq}`;
        if (oAny.ifoodReference) {
          displayNum += ` (iFood #${oAny.ifoodReference})`;
        } else if (oAny.openDeliveryReference) {
          displayNum += ` (Jotajá #${oAny.openDeliveryReference})`;
        }

        const customerName = order.customerName || "Cliente";
        const customerPhone = order.customerPhone ? `📞 *Tel:* ${order.customerPhone}\n` : "";
        const customerAddress = order.customerAddress || "Endereço não informado";
        const storeCity = order.franchisee?.city || "Rio das Ostras";
        const storeAddress = storeCity;

        // Análise de Pagamento e Troco
        const methodRaw = String(order.paymentMethod || "").toUpperCase();
        const notesRaw = String(order.notes || "").toUpperCase();
        const total = Number(order.totalAmount || 0);

        const isCash =
          methodRaw.includes("DINHEIRO") ||
          methodRaw.includes("CASH") ||
          notesRaw.includes("DINHEIRO") ||
          notesRaw.includes("TROCO");
        const isCardOnDelivery =
          methodRaw.includes("CARTAO") ||
          methodRaw.includes("MAQUINA") ||
          methodRaw.includes("MAQUININHA") ||
          methodRaw.includes("DEBITO") ||
          methodRaw.includes("CREDITO") ||
          methodRaw.includes("VALE") ||
          notesRaw.includes("LEVAR MAQUINA") ||
          notesRaw.includes("MAQUININHA");

        let changeNeeded = 0;
        if (typeof order.changeAmount === "number" && order.changeAmount > 0) {
          changeNeeded = order.changeAmount > total ? order.changeAmount - total : order.changeAmount;
        } else {
          const match =
            notesRaw.match(/TROCO\s*(?:PARA)?\s*R?\$?\s*(\d+[\.,]?\d*)/i) ||
            notesRaw.match(/TROCO\s*(\d+[\.,]?\d*)/i);
          if (match && match[1]) {
            const trocoPara = parseFloat(match[1].replace(",", "."));
            if (trocoPara > total) changeNeeded = trocoPara - total;
            else changeNeeded = trocoPara;
          }
        }

        let payText = "✅ Pago Online";
        if (isCash) {
          payText = `💵 Dinheiro (Levar R$ ${changeNeeded.toFixed(2)} de troco)`;
        } else if (isCardOnDelivery) {
          payText = `💳 Cartão (Levar Maquininha e cobrar na entrega)`;
        }

        // Link leve de navegação direta do Google Maps (utiliza o GPS atual do motoboy e remove textos pesados de complemento)
        const orderLat = (order as any).customerLatLng?.lat || (order as any).latitude || (order as any).lat;
        const orderLng = (order as any).customerLatLng?.lng || (order as any).longitude || (order as any).lng;

        let googleMapsUrl = "";
        if (orderLat && orderLng && !isNaN(Number(orderLat)) && !isNaN(Number(orderLng))) {
          googleMapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${orderLat},${orderLng}`;
        } else {
          let cleanAddr = customerAddress
            .replace(/(-?\s*Comp(?:lemento)?:.*)/gi, "")
            .replace(/(-?\s*Ref(?:erencia)?:.*)/gi, "")
            .replace(/(-?\s*Ponto de Ref(?:erencia)?:.*)/gi, "")
            .replace(/(-?\s*Casa\s*\d+.*)/gi, "")
            .replace(/(-?\s*Apto?\s*\d+.*)/gi, "")
            .replace(/(-?\s*Bloco\s*\w+.*)/gi, "")
            .trim();

          const cityStr = storeCity || "Rio das Ostras";
          if (!cleanAddr.toLowerCase().includes(cityStr.toLowerCase())) {
            cleanAddr = `${cleanAddr}, ${cityStr}`;
          }

          googleMapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(cleanAddr)}`;
        }

        let msg = `📦 *NOVO PEDIDO ATRIBUÍDO PARA ENTREGA!*\n\n`;
        msg += `🛵 *Entregador:* ${order.motoboy.name}\n`;
        msg += `📋 *Pedido:* ${displayNum}\n`;
        msg += `👤 *Cliente:* ${customerName}\n`;
        msg += `📍 *Endereço:* ${customerAddress}\n`;
        if (customerPhone) msg += customerPhone;
        msg += `💰 *Pagamento:* ${payText}\n\n`;
        msg += `🗺️ *Navegação Google Maps:* ${googleMapsUrl}`;

        await sendEvolutionMessage(order.franchiseeId, fullPhone, msg);
      }
    } catch (err) {
      console.error("[assign-motoboy] Erro ao enviar notificação no WhatsApp do motoboy:", err);
    }
  }

  return NextResponse.json({ success: true, motoboy: order.motoboy });
}
