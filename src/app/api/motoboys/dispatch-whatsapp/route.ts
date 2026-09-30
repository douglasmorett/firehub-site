import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { STATUS_CANCELADOS } from "@/lib/status-pedido";
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

    // ── SÓ OS PEDIDOS DESTA LOJA ────────────────────────────────────────────
    //
    // Os `orderIds` vêm do corpo, e o `updateMany` não filtrava a loja: uma
    // conta qualquer mandava ids de pedidos de OUTRA loja e os punha em "Saiu
    // para entrega" — com WhatsApp para o cliente dela, despacho no iFood/99
    // dela e, agora, a NFC-e dela emitida. Vale só o que esta loja enxerga no
    // painel (a mesma régua do /api/customer-order/poll: a loja e o próprio
    // usuário; mais os usuários da loja), e o resto da rota — nota, aviso ao
    // cliente, parceiros — usa SÓ os ids que passaram por este filtro.
    //
    // ── O STATUS LIDO AQUI TEM QUE SER O ANTERIOR ───────────────────────────
    //
    // Esta rota grava SAIU_ENTREGA antes de sincronizar com o parceiro. Se os
    // pedidos forem lidos DEPOIS, `ord.status` já é "SAIU_ENTREGA" — e o
    // 99Food deixa de receber o `ready`, porque a função entende que o pedido
    // já passou por ele. Loja que despacha direto de ACEITO (o normal na
    // correria) mandaria confirm + dispatch sem ready, e o 99 recusa o
    // despacho: o pedido fica "confirmado" para sempre lá. Este comentário já
    // existia, mas a leitura estava DEPOIS do updateMany; agora é o filtro da
    // loja, antes de qualquer escrita, que traz o status anterior.
    const idsPedidos = Array.isArray(orderIds)
      ? [...new Set(orderIds.map((x: unknown) => String(x ?? "").trim()).filter(Boolean))]
      : [];
    const daLojaEDespachavel = {
      OR: [{ franchiseeId: { in: [targetFranchiseeId, user.id] } }, { franchisee: { ownerId: targetFranchiseeId } }],
      status: { notIn: ["ENTREGUE", ...STATUS_CANCELADOS] },
    };
    const pedidosAntesDoDespacho = idsPedidos.length > 0
      ? await prisma.customerOrder.findMany({
          where: { id: { in: idsPedidos }, ...daLojaEDespachavel },
          select: {
            id: true, openDeliveryOrderId: true, ifoodOrderId: true, ifoodStoreMerchant: true,
            status: true, franchiseeId: true,
            openDeliveryChannel: true, source: true, deliveryBy: true,
            openDeliveryReference: true, deliveryType: true,
            motoboyId: true,
            motoboy: { select: { id: true, name: true, phone: true } },
          },
        })
      : [];
    const idsDaLoja = pedidosAntesDoDespacho.map((p) => p.id);
    if (idsPedidos.length > idsDaLoja.length) {
      console.warn(
        `[dispatch-whatsapp] ${idsPedidos.length - idsDaLoja.length} pedido(s) de fora da loja ${targetFranchiseeId} ` +
          `(ou já entregues/cancelados) ignorados — usuário ${user.id}.`
      );
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

    // Se vieram pedidos da rota, atualiza o status deles para SAIU_ENTREGA e notifica cada cliente via WhatsApp
    if (idsDaLoja.length > 0) {
      try {
        await prisma.customerOrder.updateMany({
          where: { id: { in: idsDaLoja }, ...daLojaEDespachavel },
          data: { status: "SAIU_ENTREGA" },
        });
        // NFC-e na SAÍDA (lib/fiscal-momento decide se é a hora): sem esta linha a nota só saía pela varredura do cron.
        import("@/lib/fiscal-automatico").then((m) => m.emitirNfceDosPedidos({ id: { in: idsDaLoja } })).catch(() => {});

        const { sendOrderNotification } = await import("@/lib/order-notifications");
        for (const orderId of idsDaLoja) {
          sendOrderNotification(orderId, "SAIU_ENTREGA").catch(() => {});
        }

        // Sync com Jotajá e iFood (assíncrono, não bloqueia resposta)
        (async () => {
          const orders = pedidosAntesDoDespacho;
          const { ehPedido99Food, sincronizar99Food } = await import("@/lib/food99-status");
          const { ehPedidoWabiz, sincronizarWabiz } = await import("@/lib/wabiz-status");
          const { ehPedidoBrendi, sincronizarBrendi } = await import("@/lib/brendi-status");
          for (const ord of orders) {
            if (ehPedidoWabiz(ord)) {
              await sincronizarWabiz(
                {
                  openDeliveryOrderId: ord.openDeliveryOrderId!,
                  openDeliveryReference: ord.openDeliveryReference,
                  franchiseeId: ord.franchiseeId,
                  deliveryType: ord.deliveryType,
                },
                "SAIU_ENTREGA"
              ).catch((err: any) =>
                console.warn(`[Motoboy Dispatch → Wabiz] Erro sync ${ord.openDeliveryOrderId}:`, err?.message)
              );
            } else if (ehPedidoBrendi(ord)) {
              // ── DESPACHAR TAMBÉM AVISA A BRENDI ──────────────────────────
              //
              // Ramo vazio até aqui, com um comentário que só dizia que ela não
              // é JotaJá. O cliente da Brendi continuava vendo "em preparo"
              // depois de a comida sair — e, como a escada de status deles é
              // progressiva, o `delivered` da baixa vinha em cima de um
              // `dispatch` que nunca saiu e era recusado: o pedido também não
              // FECHAVA lá.
              await sincronizarBrendi(
                {
                  openDeliveryOrderId: String(ord.openDeliveryOrderId!).replace(/_recovered$/, ""),
                  franchiseeId: ord.franchiseeId,
                  status: ord.status,
                  deliveryBy: ord.deliveryBy,
                },
                "SAIU_ENTREGA"
              ).catch((err: any) =>
                console.warn(`[Motoboy Dispatch → Brendi] Erro sync ${ord.openDeliveryOrderId}:`, err?.message)
              );
            } else if (ehPedido99Food(ord)) {
              // O 99Food TEM dispatch para entrega própria
              // (/v1/order/selfdelivery/dispatch, doc de 2026), e ele quer
              // saber quem está levando. Sem essa chamada o pedido ficava
              // "pronto" no painel deles até aparecer entregue do nada.
              await sincronizar99Food(
                {
                  openDeliveryOrderId: ord.openDeliveryOrderId!,
                  franchiseeId: ord.franchiseeId,
                  status: ord.status,
                  deliveryBy: ord.deliveryBy,
                  entregador: ord.motoboy ? { nome: ord.motoboy.name, telefone: ord.motoboy.phone, id: ord.motoboy.id } : null,
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
            // Com a credencial do dono do pedido — o token central só alcança
            // a Hakim, e nas outras lojas o despacho era um 403 engolido.
            if (ord.ifoodOrderId) {
              const { despacharNoIfood } = await import("@/lib/ifood-pedido");
              await despacharNoIfood(ord, "Motoboy Dispatch → iFood");
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
