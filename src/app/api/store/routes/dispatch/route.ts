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

    // ── A ROTA, O MOTOBOY E OS PEDIDOS TÊM DE SER DESTA LOJA ────────────────
    //
    // Esta rota nem carregava o usuário: qualquer sessão mandava o `routeId`
    // de OUTRA loja e a despachava — pedidos dela em "Saiu para entrega",
    // WhatsApp para os clientes dela, despacho no iFood/99 dela e a NFC-e
    // dela emitida. Agora, antes de qualquer escrita: a rota é da loja de quem
    // pede, o motoboy também, e só os pedidos da loja andam.
    //
    // "Da loja" é a loja ou um usuário dela: a rota nasce com o PRIMEIRO id de
    // `getValidFranchiseeIds` (api/store/routes), que pode ser o de um
    // funcionário da própria loja — exigir só `franchiseeId === loja`
    // recusaria rota legítima.
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, ownerId: true },
    });
    if (!user) {
      return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
    }
    const lojaId = user.ownerId || user.id;
    const daLoja = { OR: [{ franchiseeId: lojaId }, { franchisee: { ownerId: lojaId } }] };

    const body = await req.json();
    const { routeId, motoboyId } = body;

    if (!routeId) {
      return NextResponse.json({ error: "ID da rota não informado" }, { status: 400 });
    }

    // Rota de outra loja responde como rota inexistente: a resposta não conta
    // que o id existe.
    const route = await prisma.routeSchedule.findFirst({
      where: { id: String(routeId), ...daLoja },
      select: { id: true, routeNumber: true, motoboyId: true, franchiseeId: true },
    });

    if (!route) {
      return NextResponse.json({ error: "Rota não encontrada" }, { status: 404 });
    }

    const finalMotoboyId = motoboyId || route.motoboyId;
    if (!finalMotoboyId) {
      return NextResponse.json({ error: "Selecione um motoboy para poder despachar a rota!" }, { status: 400 });
    }

    const motoboy = await prisma.motoboy.findFirst({
      where: { id: String(finalMotoboyId), ...daLoja },
    });

    if (!motoboy) {
      return NextResponse.json({ error: "Motoboy não encontrado" }, { status: 404 });
    }

    // Os pedidos da rota que são DESTA loja. A montagem da rota
    // (api/store/routes) grava o `routeId` nos ids que o corpo mandou; um
    // pedido de outra loja pendurado aqui não sai, não recebe aviso nem nota.
    const pedidosDaRota = await prisma.customerOrder.findMany({
      where: { routeId: route.id, ...daLoja },
      select: {
        id: true, franchiseeId: true, status: true, source: true, deliveryType: true, deliveryBy: true,
        customerName: true, customerPhone: true, customerAddress: true, dailyOrderNumber: true,
        ifoodOrderId: true, ifoodReference: true, ifoodStoreMerchant: true,
        openDeliveryOrderId: true, openDeliveryChannel: true, openDeliveryReference: true,
        motoboyId: true,
      },
    });
    const idsDaRota = pedidosDaRota.map((o) => o.id);

    // 1. Atualiza status da rota no banco
    await prisma.routeSchedule.update({
      where: { id: route.id },
      data: {
        status: "DISPATCHED",
        motoboyId: motoboy.id,
        dispatchedAt: new Date(),
      },
    });

    // 2. Atualiza todos os pedidos para SAIU_ENTREGA e vincula ao motoboy
    // ── REDE DE SEGURANÇA NO BANCO ──────────────────────────────────────
    //
    // Sem o filtro de status, despachar uma rota reescrevia QUALQUER pedido
    // ligado a ela — inclusive um que já foi entregue ou que já está na rua
    // com outro entregador. O pedido voltava para a rota, trocava de motoboy,
    // e quem estava com a comida na mão levava 404 ao dar baixa. A tela já
    // impede selecionar esses pedidos; isto impede o resto.
    const { STATUS_CANCELADOS, STATUS_FINALIZADOS } = await import("@/lib/status-pedido");
    if (idsDaRota.length > 0) {
      await prisma.customerOrder.updateMany({
        where: {
          id: { in: idsDaRota },
          routeId: route.id,
          status: { notIn: [...STATUS_FINALIZADOS, ...STATUS_CANCELADOS, "SAIU_ENTREGA"] },
        },
        data: {
          status: "SAIU_ENTREGA",
          motoboyId: motoboy.id,
          isRoutePriority: false, // Pedido saiu da cozinha!
        },
      });
      // ── O CLIENTE SABE QUE SAIU ────────────────────────────────────────
      // O botão "Saiu" do painel, o app do motoboy e o despacho pelo WhatsApp
      // avisam o cliente; a roteirização punha a rota inteira em SAIU_ENTREGA
      // calada (conferência de 09/10/2026, pedido do Douglas: todo aviso em
      // toda modalidade). Só o que mudou AGORA: o que já estava na rua já foi
      // avisado. A própria função pula iFood/99 (telefone 0800) e a loja que
      // desligou os avisos.
      const sairamAgora = pedidosDaRota.filter(
        (o) => !([...STATUS_FINALIZADOS, ...STATUS_CANCELADOS, "SAIU_ENTREGA"] as string[]).includes(o.status),
      );
      if (sairamAgora.length > 0) {
        import("@/lib/order-notifications")
          .then(({ sendOrderNotification }) => {
            for (const o of sairamAgora) sendOrderNotification(o.id, "SAIU_ENTREGA").catch(() => {});
          })
          .catch(() => {});
      }
      // NFC-e na SAÍDA (lib/fiscal-momento decide se é a hora): sem esta linha a nota da rota só saía pela varredura do cron.
      import("@/lib/fiscal-automatico").then((m) => m.emitirNfceDosPedidos({ id: { in: idsDaRota } })).catch(() => {});

      // Aviso no app nativo, só do que CHEGOU ao celular dele agora: a rota
      // montada já com este entregador avisou na montagem (api/store/routes).
      const chegaramAgora = pedidosDaRota.filter(
        (o) =>
          o.motoboyId !== motoboy.id &&
          !([...STATUS_FINALIZADOS, ...STATUS_CANCELADOS, "SAIU_ENTREGA"] as string[]).includes(o.status),
      );
      if (chegaramAgora.length > 0) {
        import("@/lib/app-motoboy/aparelhos")
          .then((m) => m.avisarPedidosNovos(motoboy.id, chegaramAgora, route.routeNumber))
          .catch(() => {});
      }
    }

    // O WhatsApp sai pela instância da LOJA (o nome dela vem do id da loja —
    // lib/whatsapp-evolution). Era `route.franchiseeId`, que pode ser o id de
    // um funcionário (ver acima): a instância não existia e nada saía.
    const targetFranchiseeId = lojaId;

    // 2.5 Sync com plataformas externas (Jotajá + iFood) — assíncrono, não bloqueia resposta
    (async () => {
      const { ehPedido99Food, sincronizar99Food } = await import("@/lib/food99-status");
      const { ehPedidoWabiz, sincronizarWabiz } = await import("@/lib/wabiz-status");
      const { ehPedidoBrendi, sincronizarBrendi } = await import("@/lib/brendi-status");
      for (const ord of pedidosDaRota) {
        // ── Sync Brendi ──
        //
        // Faltava. `ehPedidoBrendi` era importado só para EXCLUIR a Brendi do
        // ramo do JotaJá (os dois usam `openDeliveryOrderId`), e depois ninguém
        // a avisava: despachar a rota punha o pedido em SAIU_ENTREGA aqui e o
        // cliente da Brendi continuava vendo "em preparo".
        //
        // E não era só o aviso: a escada de status da Brendi é progressiva, e
        // `delivered` depois de um `dispatch` que nunca saiu é recusado — então
        // o pedido também não FECHAVA lá. Pelo botão do KDS e pelo despacho por
        // WhatsApp isso já funcionava; só a roteirização ficava de fora.
        if (ehPedidoBrendi(ord)) {
          await sincronizarBrendi(
            {
              // O resgate manual grava o id com sufixo `_recovered`; a API da
              // Brendi só conhece o UUID limpo (mesma normalização do KDS e da
              // rota de status).
              openDeliveryOrderId: ord.openDeliveryOrderId!.replace(/_recovered$/, ""),
              franchiseeId: ord.franchiseeId,
              status: ord.status,
              deliveryBy: ord.deliveryBy,
            },
            "SAIU_ENTREGA"
          ).catch((err: any) =>
            console.warn(`[Route Dispatch → Brendi] Erro sync ${ord.openDeliveryOrderId}:`, err?.message)
          );
        }
        // ── Sync Wabiz ──
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
            console.warn(`[Route Dispatch → Wabiz] Erro sync ${ord.openDeliveryOrderId}:`, err?.message)
          );
        }
        // ── Sync 99Food ──
        // Mesmo campo (`openDeliveryOrderId`), parceiro diferente. Sem esta
        // separação, despachar a rota mandava o pedido do 99Food para a API do
        // JotaJá e o 99 nunca sabia que a comida tinha saído.
        if (ehPedido99Food(ord)) {
          await sincronizar99Food(
            {
              openDeliveryOrderId: ord.openDeliveryOrderId!,
              franchiseeId: ord.franchiseeId,
              status: ord.status,
              deliveryBy: ord.deliveryBy,
              // A rota inteira sai com o mesmo motoboy — é ele que o 99Food
              // mostra ao cliente no acompanhamento.
              entregador: motoboy ? { nome: motoboy.name, telefone: motoboy.phone, id: motoboy.id } : null,
            },
            "SAIU_ENTREGA"
          ).catch((err: any) =>
            console.warn(`[Route Dispatch → 99Food] Erro sync ${ord.openDeliveryOrderId}:`, err?.message)
          );
        }
        // ── Sync Jotajá (Open Delivery) ──
        if (ord.openDeliveryOrderId && !ehPedido99Food(ord) && !ehPedidoWabiz(ord) && !ehPedidoBrendi(ord)) {
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
        // Com a credencial do dono do pedido — o token central só alcança a
        // Hakim, e nas outras lojas o despacho era um 403 engolido pelo log.
        if (ord.ifoodOrderId) {
          const { despacharNoIfood } = await import("@/lib/ifood-pedido");
          await despacharNoIfood(ord, "Route Dispatch → iFood");
        }
      }
    })();


    // 3. O aviso ao cliente saiu daqui: é o `sendOrderNotification` lá em
    // cima (só o que saiu agora, com o filtro de telefone de verdade e a
    // chave da loja). Este laço mandava para todo pedido da rota — inclusive
    // o 0800 do iFood e o que já estava na rua — e ignorava a loja que
    // desligou os avisos.

    // 4. Monta o link da rota completa no Google Maps para o motoboy
    if (motoboy.phone) {
      const addresses = pedidosDaRota
        .map((o) => o.customerAddress)
        .filter(Boolean) as string[];

      if (addresses.length > 0) {
        const origin = encodeURIComponent("Rio das Ostras, RJ"); // Ou endereço base da loja
        const waypoints = addresses.map((a) => encodeURIComponent(a)).join("/");
        const mapsUrl = `https://www.google.com/maps/dir/${origin}/${waypoints}`;

        let summaryText = `🚀 *NOVA ROTA ATRIBUÍDA: ${route.routeNumber}*\n\n`;
        summaryText += `📦 *Total de Pedidos:* ${pedidosDaRota.length}\n\n`;
        summaryText += `📍 *Paradas da Rota:*\n`;

        pedidosDaRota.forEach((o, idx) => {
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
