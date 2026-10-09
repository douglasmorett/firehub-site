/**
 * PATCH /api/customer-order/assign-motoboy
 * Atribui ou remove um motoboy de um pedido e envia notificação no WhatsApp do entregador com o número do FireHub (#171).
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendEvolutionMessage } from "@/lib/whatsapp-evolution";
import { inicioDoExpedienteDaLoja } from "@/lib/fuso";
import { linhasDePagamentoParaOMotoboy } from "@/lib/pagamento-no-whatsapp-do-motoboy";

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { orderId, motoboyId, firehubOrderNumber } = await req.json();
  if (!orderId) return NextResponse.json({ error: "orderId obrigatório" }, { status: 400 });

  // ── O PEDIDO PRECISA SER DESTA LOJA ───────────────────────────────────────
  //
  // Só se conferia "existe sessão". Qualquer conta logada mandava o id de um
  // pedido de OUTRA loja e atribuía um motoboy a ele — inclusive um motoboy
  // que não é da loja dona do pedido, disparando WhatsApp em nome dela.
  const usuario = await prisma.user.findUnique({
    where: { email: session.user?.email || "" },
    select: { id: true, ownerId: true, role: true, name: true, email: true },
  });
  if (!usuario) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  const lojaDaSessao = usuario.ownerId || usuario.id;

  const pedidoAlvo = await prisma.customerOrder.findUnique({
    where: { id: orderId },
    select: { franchiseeId: true, status: true, motoboyId: true, totalAmount: true, editHistory: true, motoboy: { select: { name: true } } },
  });
  if (!pedidoAlvo) return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
  if (usuario.role !== "ADMIN" && pedidoAlvo.franchiseeId !== lojaDaSessao) {
    console.warn(`[assign-motoboy] 🚫 ${usuario.id} tentou mexer no pedido ${orderId} da loja ${pedidoAlvo.franchiseeId}.`);
    return NextResponse.json({ error: "Este pedido não é desta loja" }, { status: 403 });
  }

  // ── PEDIDO JÁ ENTREGUE TAMBÉM TROCA DE ENTREGADOR ─────────────────────────
  //
  // Trocar o nome aqui é o que MOVE o pedido de um celular para o outro (o app
  // lista por `motoboyId`), e o relatório de entregas soma o repasse por ele.
  //
  // Até 09/10/2026 pedido ENTREGUE recusava a troca (409) — e fechar o caixa
  // marca como ENTREGUE tudo o que estava na rua. A Delícias de Casa acerta os
  // motoboys DEPOIS de fechar o caixa, e é aí que descobre que a entrega foi
  // de outro: a troca não passava, a tela mostrava o nome novo mesmo assim, e
  // o relatório seguia com o antigo. "A loja é dos caras, eles fazem o que
  // quiserem" (Douglas). Agora troca, e fica no histórico do pedido
  // (editHistory, MOTOBOY): quem, quando, de quem para quem.
  const { STATUS_CANCELADOS, STATUS_FINALIZADOS } = await import("@/lib/status-pedido");
  const jaFechou = [...STATUS_FINALIZADOS, ...STATUS_CANCELADOS].includes(pedidoAlvo.status as any);
  const trocandoDeFato = String(motoboyId || "") !== String(pedidoAlvo.motoboyId || "");

  // O motoboy também tem que ser da loja: senão dava para "emprestar" o
  // entregador de outra loja para um pedido seu.
  let nomeDoNovo: string | null = null;
  if (motoboyId) {
    const motoboyDaLoja = await prisma.motoboy.findFirst({
      where: { id: String(motoboyId), franchiseeId: pedidoAlvo.franchiseeId },
      select: { id: true, name: true },
    });
    if (!motoboyDaLoja) {
      return NextResponse.json({ error: "Este entregador não é desta loja" }, { status: 403 });
    }
    nomeDoNovo = motoboyDaLoja.name;
  }

  const { empilharEdicao } = await import("@/lib/edicao-de-pedido");
  const total = Number(pedidoAlvo.totalAmount || 0);
  const order = await prisma.customerOrder.update({
    where: { id: orderId },
    data: {
      motoboyId: motoboyId || null,
      ...(trocandoDeFato
        ? {
            editHistory: empilharEdicao(pedidoAlvo.editHistory, {
              quando: new Date().toISOString(),
              quem: usuario.name || usuario.email || "loja",
              acao: "MOTOBOY",
              descricao: `Entregador: ${pedidoAlvo.motoboy?.name || "nenhum"} → ${nomeDoNovo || "nenhum"}`,
              totalAntes: total,
              totalDepois: total,
            }) as any,
          }
        : {}),
      // A LOJA atribuindo (ou desatribuindo) apaga o carimbo de "puxou pelo
      // app": senão o selo "puxou 19:42" ficava ao lado do nome de quem a loja
      // escolheu DEPOIS — a etiqueta erraria exatamente na discussão para a
      // qual foi criada.
      motoboyPuxadoEm: null,
    },
    include: {
      motoboy: true,
      franchisee: true,
    },
  });

  // Aviso no app nativo do entregador (lib/app-motoboy/aparelhos.ts): quem
  // recebeu fica sabendo com o celular no bolso, e quem perdeu o pedido para
  // de procurar a sacola dele. Em segundo plano — a loja não espera o Expo.
  if (trocandoDeFato && !jaFechou) {
    import("@/lib/app-motoboy/aparelhos")
      .then(async ({ avisarPedidosNovos, avisarMotoboy }) => {
        if (order.motoboyId) await avisarPedidosNovos(order.motoboyId, [order]);
        if (pedidoAlvo.motoboyId && pedidoAlvo.motoboyId !== order.motoboyId) {
          await avisarMotoboy(pedidoAlvo.motoboyId, {
            titulo: `↩️ Pedido${order.dailyOrderNumber ? ` #${order.dailyOrderNumber}` : ""} saiu da sua lista`,
            corpo: "A loja passou esta entrega para outro entregador.",
            dados: { tipo: "PEDIDO_REMOVIDO" },
          });
        }
      })
      .catch(() => {});
  }

  // Disparar notificação automática via WhatsApp para o Motoboy se atribuído.
  // Pedido já finalizado é acerto de contas, não entrega nova: nada de
  // mandar o endereço para o entregador sair de novo.
  if (!jaFechou && order.motoboy && order.motoboy.phone && order.motoboyId) {
    try {
      const cleanPhone = order.motoboy.phone.replace(/\D/g, "");
      if (cleanPhone.length >= 8) {
        const fullPhone = cleanPhone.startsWith("55") ? cleanPhone : `55${cleanPhone}`;

        const oAny = order as any;

        // PRIORIDADE ABSOLUTA: Número do Pedido no FireHub (ex: #171)
        let firehubSeq = firehubOrderNumber ? String(firehubOrderNumber) : oAny.dailyOrderNumber;
        if (!firehubSeq) {
          // Expediente da loja, não meia-noite do processo.
          //
          // `setHours(0,0,0,0)` usa o fuso do container, que é UTC — o contador
          // zerava às 21:00 de Brasília e o pedido das 21:10 recebia o mesmo
          // número do primeiro da tarde. Numeração duplicada no meio do pico.
          const startOfDay = inicioDoExpedienteDaLoja(null, new Date(order.createdAt));
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

        // Quanto cobrar, em qual forma e o troco: a MESMA decisão do app do
        // motoboy (lib/pagamento-no-whatsapp-do-motoboy.ts). A leitura que
        // morava aqui não dizia o valor, e o que ela não reconhecia virava
        // "Pago Online" — o app, na dúvida, manda cobrar.
        const linhasDePagamento = linhasDePagamentoParaOMotoboy(order as any);

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
        msg += `${linhasDePagamento}\n`;
        msg += `🗺️ *Navegação Google Maps:* ${googleMapsUrl}`;

        await sendEvolutionMessage(order.franchiseeId, fullPhone, msg);
      }
    } catch (err) {
      console.error("[assign-motoboy] Erro ao enviar notificação no WhatsApp do motoboy:", err);
    }
  }

  return NextResponse.json({ success: true, motoboy: order.motoboy });
}
