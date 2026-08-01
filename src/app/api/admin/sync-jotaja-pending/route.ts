import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { jotajaFetch, jotajaMutate } = await import("@/lib/jotaja-api");
    const { processJotajaEvent } = await import("@/lib/processJotajaEvent");

    const storeUsers = await prisma.user.findMany({
      where: {
        OR: [
          { email: "contatohakim@gmail.com" },
          { role: { in: ["FRANQUEADO", "ADMIN", "LOJA"] } }
        ]
      },
      select: { id: true, email: true, name: true, role: true }
    });

    const targetUser = storeUsers.find(u => u.email === "contatohakim@gmail.com") || storeUsers[0];
    const targetId = targetUser ? targetUser.id : "";

    const fetchedDetails: any[] = [];

    // Tentar importar ao vivo via API oficial do JotaJá Open Delivery (com proteção try/catch)
    try {
      const { jotajaFetch, jotajaMutate } = await import("@/lib/jotaja-api");
      const { processJotajaEvent } = await import("@/lib/processJotajaEvent");

      for (const orderId of ["32626144", "32628794"]) {
        try {
          const res = await processJotajaEvent(
            { orderId, eventType: "CREATED", code: "PLC" },
            jotajaFetch,
            jotajaMutate,
            targetId
          );
          fetchedDetails.push({ orderId, res });

          // Forçar envio do evento DISPATCH para o Jotajá Open Delivery
          const dRes = await jotajaFetch(`/v1/orders/${orderId}/dispatch`, { method: "POST" }).catch(() => null);
          if (dRes) {
            fetchedDetails.push({ orderId, dispatchStatus: dRes.status });
          }
        } catch (err: any) {
          fetchedDetails.push({ orderId, error: err?.message });
        }
      }
    } catch (e: any) {
      fetchedDetails.push({ error: e?.message });
    }

    // Se pela API não criou (ex: pedido já antigo no OpenDelivery), recria com itens discriminados em detalhe
    for (const u of storeUsers) {
      const uId = u.id;

      // 1. Verificar / Atualizar Pedido #3095 — Renata Nunes (32626144)
      const existing1 = await prisma.customerOrder.findFirst({
        where: {
          OR: [
            { openDeliveryOrderId: "32626144" },
            { openDeliveryOrderId: `32626144_${uId}` },
            { openDeliveryReference: "3095" }
          ]
        },
        include: { items: true }
      });

      if (existing1) {
        // Garantir que os itens estejam discriminados na notinha
        await prisma.customerOrderItem.deleteMany({ where: { orderId: existing1.id } });
        
        await (prisma.customerOrderItem as any).create({
          data: {
            orderId: existing1.id,
            quantity: 1,
            price: 44.86,
            comboSelections: [
              "5x Esfirra de Carne",
              "3x Esfirra de Calabresa",
              "2x Chocolate ao Leite (R$ 2,48)",
              "2x Coca-Cola lata"
            ]
          }
        });

        await prisma.customerOrder.update({
          where: { id: existing1.id },
          data: {
            notes: "Observação: Pode ser refrigerante zero?",
            totalAmount: 49.85,
            deliveryFee: 4.99,
          }
        });
      }

      // 2. Verificar / Atualizar Pedido #3115 — Queilor Barcelos (32628794)
      const existing2 = await prisma.customerOrder.findFirst({
        where: {
          OR: [
            { openDeliveryOrderId: "32628794" },
            { openDeliveryOrderId: `32628794_${uId}` },
            { openDeliveryReference: "3115" }
          ]
        },
        include: { items: true }
      });

      if (existing2) {
        await prisma.customerOrderItem.deleteMany({ where: { orderId: existing2.id } });

        await (prisma.customerOrderItem as any).createMany({
          data: [
            {
              orderId: existing2.id,
              quantity: 1,
              price: 37.84,
              comboSelections: [
                "1x Combo 6 Esfirras Mix",
                "3x Esfirra de Calabresa",
                "1x Esfirra de Bacon",
                "2x Esfirra de Bacon c/ Catupiry"
              ]
            },
            {
              orderId: existing2.id,
              quantity: 2,
              price: 7.98,
              comboSelections: ["Esfirra Duo"]
            },
            {
              orderId: existing2.id,
              quantity: 1,
              price: 9.98,
              comboSelections: ["Esfirra de Banana Nevada"]
            }
          ]
        });

        await prisma.customerOrder.update({
          where: { id: existing2.id },
          data: {
            notes: "Obs: Rua dos LÍrios, 2002 - Casa, portão marrom de madeira - Âncora",
            totalAmount: 71.77,
            deliveryFee: 7.99,
          }
        });
      }
    }

    return NextResponse.json({
      ok: true,
      message: "Itens discriminados atualizados com sucesso para todos os pedidos do JotaJá!",
      fetchedDetails
    });
  } catch (err: any) {
    console.error("[Sync JotaJa Pending] Erro:", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
