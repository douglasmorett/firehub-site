import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendEvolutionMessage } from "@/lib/whatsapp-evolution";
import { paraEnvioWhatsApp } from "@/lib/telefone";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, ownerId: true },
    });

    if (!user) {
      return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
    }

    const targetFranchiseeId = user.ownerId || user.id;
    const body = await req.json();
    const { motoboyPhone, routeText, orderIds } = body;

    if (!motoboyPhone || !routeText) {
      return NextResponse.json({ error: "Telefone do motoboy e texto da rota são obrigatórios." }, { status: 400 });
    }

    // `paraEnvioWhatsApp` em vez de prefixar "55" na unha: o jeito antigo
    // aceitava 8 dígitos e montava destino inválido, e lia "022998851680" como
    // 55 + 022998851680. É a mesma função que o resto do sistema usa.
    const fullPhone = paraEnvioWhatsApp(motoboyPhone);
    if (!fullPhone) {
      return NextResponse.json({ error: "Número de telefone do motoboy inválido." }, { status: 400 });
    }

    // UM envio, uma vez.
    //
    // Aqui havia um reenvio pela instância do próprio usuário quando o primeiro
    // falhava. Só que "falhou" era `res.ok === false`, e o gateway responde erro
    // em casos nos quais a mensagem JÁ SAIU — inclusive no timeout de 15s do
    // fetch, que estoura enquanto o gateway ainda está consultando o WhatsApp.
    // O motoboy recebia a mesma rota duas vezes, de dois números diferentes, um
    // deles nunca visto por ele. Era parte do "muitas mensagens" do relato.
    const success = await sendEvolutionMessage(targetFranchiseeId, fullPhone, routeText);

    // Se vieram orderIds da rota, atualiza o status de todos para SAIU_ENTREGA e notifica cada cliente via WhatsApp
    if (Array.isArray(orderIds) && orderIds.length > 0) {
      try {
        await prisma.customerOrder.updateMany({
          where: { id: { in: orderIds }, status: { notIn: ["ENTREGUE", "CANCELADO", "CANCELED"] } },
          data: { status: "SAIU_ENTREGA" },
        });

        const { sendOrderNotification } = await import("@/lib/order-notifications");
        for (const orderId of orderIds) {
          sendOrderNotification(orderId, "SAIU_ENTREGA").catch(() => {});
        }

        // Sync com Jotajá e iFood (assíncrono, não bloqueia resposta)
        (async () => {
          const orders = await prisma.customerOrder.findMany({
            where: { id: { in: orderIds } },
            select: {
              id: true, openDeliveryOrderId: true, ifoodOrderId: true, status: true, franchiseeId: true,
              // O canal decide o parceiro: o id do 99Food mora no mesmo campo
              // do JotaJá, e sem isto o dispatch ia sempre para o JotaJá.
              openDeliveryChannel: true, source: true, deliveryBy: true,
            },
          });
          const { ehPedido99Food, sincronizar99Food } = await import("@/lib/food99-status");
          for (const ord of orders) {
            if (ehPedido99Food(ord)) {
              // O 99Food não tem "dispatch": o aviso que existe é o `ready`, e
              // é ele que solta o pedido do lado deles.
              await sincronizar99Food(
                {
                  openDeliveryOrderId: ord.openDeliveryOrderId!,
                  franchiseeId: ord.franchiseeId,
                  status: ord.status,
                  deliveryBy: ord.deliveryBy,
                },
                "SAIU_ENTREGA"
              ).catch((err: any) =>
                console.warn(`[Motoboy Dispatch → 99Food] Erro sync ${ord.openDeliveryOrderId}:`, err?.message)
              );
            } else if (ord.openDeliveryOrderId) {
              try {
                const { jotajaMutate } = await import("@/lib/jotaja-api");
                const r = await jotajaMutate(`/v1/orders/${ord.openDeliveryOrderId}/dispatch`, { method: "POST" }, ord.franchiseeId);
                console.log(`[Motoboy Dispatch → Jotajá] dispatch ${ord.openDeliveryOrderId}: ${r.status}`);
              } catch (err: any) {
                console.warn(`[Motoboy Dispatch → Jotajá] Erro sync ${ord.openDeliveryOrderId}:`, err?.message);
              }
            }
            if (ord.ifoodOrderId) {
              try {
                const { getIfoodToken } = await import("@/lib/ifood-api");
                const token = await getIfoodToken();
                const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
                const baseUrl = `https://merchant-api.ifood.com.br/order/v1.0/orders/${ord.ifoodOrderId}`;
                await fetch(`${baseUrl}/readyToPickup`, { method: "POST", headers }).catch(() => {});
                const r = await fetch(`${baseUrl}/dispatch`, { method: "POST", headers });
                console.log(`[Motoboy Dispatch → iFood] dispatch ${ord.ifoodOrderId}: ${r.status}`);
              } catch (err: any) {
                console.warn(`[Motoboy Dispatch → iFood] Erro sync ${ord.ifoodOrderId}:`, err?.message);
              }
            }
          }
        })();
      } catch (errSync) {
        console.warn("[dispatch-whatsapp] Erro ao sincronizar status/notificações dos pedidos da rota:", errSync);
      }
    }

    if (success) {
      return NextResponse.json({
        success: true,
        message: `🚀 Rota enviada com sucesso no WhatsApp do Motoboy (${fullPhone})!`,
      });
    } else {
      return NextResponse.json(
        { error: "Falha ao enviar mensagem no WhatsApp do motoboy. Verifique se o WhatsApp Gateway está ativo." },
        { status: 500 }
      );
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
