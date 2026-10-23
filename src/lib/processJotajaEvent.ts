/**
 * lib/processJotajaEvent.ts
 * Lógica centralizada de processamento de eventos Open Delivery (JotaJá).
 * Usada por: webhook, cron-poll e dashboard-poll — elimina triplicação.
 */
import { observacaoDoItem } from "@/lib/observacao-do-item";
import { prisma } from "@/lib/prisma";
import { lojaBloqueadaPorMensalidade } from "@/lib/loja-bloqueada";
import { dataHoraDaLoja } from "@/lib/fuso";
import { fusoDaLoja } from "@/lib/fuso-da-loja";
import { isBeverageName } from "@/lib/beverage";
import { generateDailyOrderNumber } from "@/lib/order-number";
// A MESMA extração da Brendi (mesmo contrato Open Delivery). Eram duas
// cópias idênticas, com o mesmo defeito nas duas — ver o arquivo.
import { extrairOpcoesDoItem, valorOpenDelivery } from "@/lib/opcoes-open-delivery";
import { corrigirNomeDoEspelho } from "@/lib/espelho-do-parceiro";
import {
  decidirLojaDoPedido,
  HORAS_DO_PEDIDO_ANTIGO,
  idDoEspelhoJotaja,
  idDoItemJotaja,
  merchantDoEvento,
  pedidoAntigoDemais,
  pedidoDeAntesDaLigacao,
} from "@/lib/jotaja-loja";
import { ligadoEmDaLoja } from "@/lib/jotaja-api";

export interface JotajaEvent {
  id?: string;
  eventId?: string;
  code?: string;
  fullCode?: string;
  eventType?: string;
  orderId: string;
  metadata?: Record<string, any>;
}

export interface ProcessResult {
  // "ignorado": pedido que nunca entra nesta loja — feito antes de ela ligar o
  // JotaJá, ou velho demais (lib/jotaja-loja.ts). O evento pode sair da fila
  // mesmo sem pedido no banco.
  action: "created" | "updated" | "cancelled" | "dispute" | "skipped" | "ignorado" | "error";
  orderId: string;
  message?: string;
  // O pedido é de OUTRA loja/restaurante: não entra aqui de jeito nenhum.
  recusadoPorLoja?: boolean;
}

/** GET do pedido no JotaJá, com até 3 tentativas. */
async function buscarPedidoJotaja(
  jotajaFetch: (path: string, options?: RequestInit) => Promise<Response>,
  orderId: string,
): Promise<{ ok: true; dados: any } | { ok: false; erro: string }> {
  let ultimoErro = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await jotajaFetch(`/v1/orders/${orderId}`);
      if (res.ok) return { ok: true, dados: await res.json() };
      ultimoErro = `HTTP ${res.status}`;
    } catch (e: any) {
      ultimoErro = e?.message || "erro de rede";
    }
    if (attempt < 3) await new Promise(r => setTimeout(r, 500));
  }
  const erro = `GET /orders falhou após 3 tentativas (${ultimoErro || "network error"})`;
  // Sem log, este era o caminho em que o pedido sumia sem deixar rastro.
  console.error(`[Jotaja] ❌ ${orderId}: ${erro}`);
  return { ok: false, erro };
}

/**
 * Processa um único evento Open Delivery do JotaJá.
 * Retorna o resultado do processamento.
 * Auto-confirma pedidos PLACED via API.
 *
 * `targetFranchiseeId` é a loja cuja credencial buscou o evento — e a ÚNICA
 * loja em que o pedido pode entrar (lib/jotaja-loja.ts).
 */
export async function processJotajaEvent(
  event: JotajaEvent,
  jotajaFetch: (path: string, options?: RequestInit) => Promise<Response>,
  jotajaMutate: (path: string, options?: RequestInit) => Promise<Response>,
  targetFranchiseeId?: string,
  opcoes: { pedidoAntigoEntra?: boolean } = {},
): Promise<ProcessResult> {
  const { code } = event || {} as JotajaEvent;
  // Só texto: o webhook não confere assinatura sem segredo, e um objeto aqui
  // viraria filtro do Prisma (openDeliveryOrderId: { ... }) no cancelamento.
  const orderIdBruto: unknown = event?.orderId;
  const orderId = typeof orderIdBruto === "string" || typeof orderIdBruto === "number" ? String(orderIdBruto) : "";
  if (!orderId) return { action: "skipped", orderId: "", message: "sem orderId" };
  if (!targetFranchiseeId) {
    return { action: "error", orderId, message: "evento sem loja — pedido do JotaJá só entra na loja dona da credencial" };
  }

  // Jotajá uses eventType (CREATED, CONFIRMED, etc.) in addition to code/fullCode
  const et = event.eventType?.toUpperCase() ?? "";
  const isPlaced         = code === "PLC" || event.fullCode === "PLACED" || et === "CREATED" || et === "PLACED";
  const isConfirmed      = code === "CFM" || event.fullCode === "CONFIRMED" || et === "CONFIRMED";
  const isPreparation    = code === "PRP" || event.fullCode === "IN_PREPARATION" || event.fullCode === "PREPARATION_STARTED" || et === "IN_PREPARATION" || et === "PREPARATION_STARTED";
  const isReadyPickup    = code === "RTP" || event.fullCode === "READY_TO_PICKUP" || et === "READY_TO_PICKUP";
  const isDispatched     = code === "DSP" || event.fullCode === "DISPATCHED" || et === "DISPATCHED";
  const isConcluded      = code === "CON" || event.fullCode === "CONCLUDED" || et === "CONCLUDED";
  const isCancelled      = code === "CAN" || event.fullCode === "CANCELLED" || et === "CANCELLED";
  const isCancellationRequest =
    code === "HSD" || code === "CRR" ||
    event.fullCode === "HANDSHAKE_DISPUTE" ||
    event.fullCode === "CANCELLATION_REQUESTED" ||
    et === "CANCELLATION_REQUESTED" || et === "HANDSHAKE_DISPUTE";

  // ── A partir de quando esta loja recebe (lib/jotaja-api.ts › ligadoEmDaLoja)
  // O que foi pedido antes de ela ligar o JotaJá fica no portal do JotaJá. O
  // import manual (pedidoAntigoEntra) não passa por esta régua nem pela de 12 h.
  let ligadoEmCarregado = false;
  let ligadoEm: number | null = null;
  const carregarLigadoEm = async () => {
    if (!ligadoEmCarregado) {
      ligadoEm = opcoes.pedidoAntigoEntra ? null : await ligadoEmDaLoja(targetFranchiseeId).catch(() => null);
      ligadoEmCarregado = true;
    }
    return ligadoEm;
  };
  /** O próprio evento é de antes da ligação (então o pedido também é). */
  const eventoDeAntesDaLigacao = async () => {
    const l = await carregarLigadoEm();
    const t = (event as any).createdAt ? new Date((event as any).createdAt).getTime() : NaN;
    return !!l && Number.isFinite(t) && t < l;
  };
  /** Pedido que nunca entra nesta loja sozinho: de antes da ligação, ou velho demais. */
  const motivoDeNaoEntrar = async (pedido: any): Promise<string | null> => {
    if (opcoes.pedidoAntigoEntra) return null;
    if (pedidoDeAntesDaLigacao(pedido, await carregarLigadoEm())) return `pedido de ${pedido?.createdAt}, de antes de a loja ligar o JotaJá — fica no portal do JotaJá`;
    if (pedidoAntigoDemais(pedido)) return `pedido de ${pedido?.createdAt}, mais de ${HORAS_DO_PEDIDO_ANTIGO} h — não entra sozinho`;
    return null;
  };

  try {
    // ── Cancelamento e negociação: só em pedido DESTA loja ─────────────────
    if (isCancellationRequest || isCancelled) {
      // Exato ou o recuperado ("<uuid>_recovered").
      const doPedido = { OR: [{ openDeliveryOrderId: orderId }, { openDeliveryOrderId: { startsWith: `${orderId}_` } }] };
      const pedidoNoBanco: any = await prisma.customerOrder.findFirst({
        where: doPedido as any,
        select: { id: true, franchiseeId: true, cancelledBy: true } as any,
      });
      if (pedidoNoBanco && pedidoNoBanco.franchiseeId !== targetFranchiseeId) {
        const msg = `pedido está em outra loja do FireHub (${pedidoNoBanco.franchiseeId}) — não mexo`;
        console.error(`[Jotaja] ⛔ ${orderId}: ${msg}`);
        return { action: "error", orderId, message: msg, recusadoPorLoja: true };
      }
      if (!pedidoNoBanco) {
        // Pedido que não está na loja. Se ele nunca vai entrar (feito antes
        // de ligar, ou velho demais), o evento sai da fila sem alerta — antes
        // ficava preso 7 dias, alertando "pedido não entrou". Senão, o CREATED
        // dele ainda não passou: este evento espera na fila.
        if (await eventoDeAntesDaLigacao()) {
          return { action: "ignorado", orderId, message: "evento de pedido de antes da ligação" };
        }
        const busca = await buscarPedidoJotaja(jotajaFetch, orderId);
        if (!busca.ok) return { action: "error", orderId, message: busca.erro };
        const motivo = await motivoDeNaoEntrar(busca.dados);
        if (motivo) return { action: "ignorado", orderId, message: motivo };
        return { action: "skipped", orderId, message: "cancelamento de pedido que ainda não entrou — espera na fila" };
      }
      const naLoja = { ...doPedido, franchiseeId: targetFranchiseeId };

      if (isCancellationRequest) {
        const meta = event.metadata || {};
        if (meta.action === "CANCELLATION" || code === "CRR") {
          const disputeData = {
            pending: true,
            disputeId: meta.disputeId || "",
            reason: meta.message || meta.cancelCodeDescription || "Cliente solicitou cancelamento",
            handshakeType: meta.handshakeType || "",
            expiresAt: meta.expiresAt || "",
            requestedAt: meta.createdAt || new Date().toISOString(),
          };
          await (prisma.customerOrder as any).updateMany({
            where: naLoja as any,
            data: { cancelDispute: disputeData },
          });
          return { action: "dispute", orderId, message: `disputeId=${meta.disputeId}` };
        }
        return { action: "skipped", orderId, message: "handshake ignorado" };
      }

      // ── Cancelamento definitivo ──────────────────────────────────────────
      const cancelData: any = { status: "CANCELADO", cancelDispute: { pending: false } };
      if (!pedidoNoBanco.cancelledBy || pedidoNoBanco.cancelledBy !== "LOJA") {
        cancelData.cancelledBy = "JOTAJA";
      }
      await (prisma.customerOrder as any).updateMany({
        where: naLoja as any,
        data: cancelData,
      });
      // Cancelado pelo JotaJá com NFC-e de pé: não trava (o cliente já foi estornado lá), avisa na tela fiscal.
      import("./fiscal-automatico").then((m) => m.alertarCancelamentoComNota(naLoja as any, "JotaJá")).catch(() => {});
      return { action: "cancelled", orderId };
    }

    // ── Verifica idempotência ──────────────────────────────────────────────
    // openDeliveryOrderId é globalmente único (@unique no schema) — busca global
    // openDeliveryReference NÃO é único (schema.prisma: só @@index) e é gravado
    // também por 99Food, pela API v1 e pelo import manual. Casar só por ele
    // encontrava o pedido de outro canal, o evento virava "sem mudança de
    // status", vinha o ACK e o pedido novo sumia. Por isso exige canal + loja.
    const idempotencyConditions: any[] = [
      { openDeliveryOrderId: orderId },
      { openDeliveryOrderId: { startsWith: `${orderId}_` } },
      { openDeliveryReference: orderId, franchiseeId: targetFranchiseeId, openDeliveryChannel: "JOTAJA" },
    ];
    const displayRef = (event as any).displayId || (event as any).orderSeqNumber;
    if (displayRef) {
      idempotencyConditions.push({
        openDeliveryReference: String(displayRef),
        franchiseeId: targetFranchiseeId,
        openDeliveryChannel: "JOTAJA",
      });
    }
    const existing = await prisma.customerOrder.findFirst({
      where: { OR: idempotencyConditions } as any,
    });

    // O UUID do pedido é único no banco inteiro; se ele já está em OUTRA loja,
    // nada aqui mexe nele — nem status, nem cópia nesta loja.
    if (existing && existing.franchiseeId !== targetFranchiseeId) {
      const msg = `pedido já está em outra loja do FireHub (${existing.franchiseeId}) — não mexo`;
      console.error(`[Jotaja] ⛔ ${orderId}: ${msg}`);
      return { action: "error", orderId, message: msg, recusadoPorLoja: true };
    }

    if (!existing) {
      // Evento de antes da ligação: o pedido também é — nem precisa buscá-lo.
      if (await eventoDeAntesDaLigacao()) {
        return { action: "ignorado", orderId, message: "pedido de antes de a loja ligar o JotaJá — fica no portal do JotaJá" };
      }

      // ── CRIAR pedido novo (com até 3 tentativas resilientes) ──────────────
      const busca = await buscarPedidoJotaja(jotajaFetch, orderId);
      if (!busca.ok) return { action: "error", orderId, message: busca.erro };
      const orderData = busca.dados;

      // ── A loja do pedido: SÓ a dona da credencial (lib/jotaja-loja.ts) ─────
      // Antes procurava "a loja que tem este merchantId" no banco inteiro e
      // usava a primeira — podia ser outra conta, ou um funcionário (a tela de
      // Equipe copia o jotajaMerchantId do dono), e aí o espelho e a impressão
      // iam para o id do funcionário.
      const franchisee: any = await prisma.user.findUnique({ where: { id: targetFranchiseeId } });
      if (!franchisee) {
        return { action: "error", orderId, message: `loja ${targetFranchiseeId} não encontrada` };
      }
      const franchiseeIdToUse = franchisee.id;
      const nomeDaLoja = franchisee.storeName || franchiseeIdToUse;
      const recusar = (motivo: string): ProcessResult => {
        console.error(`[Jotaja] ⛔ ${orderId} NÃO entra em ${nomeDaLoja}: ${motivo}`);
        // A loja fica "ligada" e nada entra: avisa (o alerta tem trava de 5 min).
        import("@/lib/server-monitor")
          .then((m) => m.alertarFalhaDeIntegracao("JotaJá", nomeDaLoja, motivo))
          .catch(() => {});
        return { action: "error", orderId, message: motivo, recusadoPorLoja: true };
      };
      const merchantDoPedido = merchantDoEvento(orderData);
      const outraLoja = merchantDoPedido && !franchisee.jotajaMerchantId
        ? await prisma.user.findFirst({
            where: {
              jotajaMerchantId: merchantDoPedido,
              id: { not: franchiseeIdToUse },
              ownerId: null,
              NOT: { email: { startsWith: "deleted_" } },
            } as any,
            select: { id: true, storeName: true },
          })
        : null;
      const decisao = decidirLojaDoPedido({
        merchantDaLoja: franchisee.jotajaMerchantId,
        merchantDoPedido,
        outraLojaComEsseMerchant: outraLoja ? (outraLoja.storeName || outraLoja.id) : null,
      });
      if (!decisao.entra) return recusar(decisao.motivo);
      if (decisao.adotarMerchant) {
        // Só grava se continua vazio (duas lojas não adotam o mesmo restaurante ao mesmo tempo).
        const gravou = await prisma.user.updateMany({
          where: { id: franchiseeIdToUse, OR: [{ jotajaMerchantId: null }, { jotajaMerchantId: "" }] },
          data: { jotajaMerchantId: decisao.adotarMerchant },
        });
        if (gravou.count === 0) {
          const agora = await prisma.user.findUnique({ where: { id: franchiseeIdToUse }, select: { jotajaMerchantId: true } });
          if (agora?.jotajaMerchantId && agora.jotajaMerchantId !== decisao.adotarMerchant) {
            return recusar(`pedido do restaurante ${decisao.adotarMerchant} do JotaJá; esta loja é o ${agora.jotajaMerchantId}`);
          }
        } else {
          console.log(`[Jotaja] ${nomeDaLoja} é o restaurante ${decisao.adotarMerchant} do JotaJá (gravado no 1º pedido)`);
        }
      }

      // Feito antes de a loja ligar (fica no portal do JotaJá) ou velho demais
      // (fila parada): não vai para a cozinha. O import manual entra.
      const motivoDeFora = await motivoDeNaoEntrar(orderData);
      if (motivoDeFora) {
        console.warn(`[Jotaja] ${orderId} (#${orderData.displayId ?? "?"}) em ${nomeDaLoja}: ${motivoDeFora}`);
        return { action: "ignorado", orderId, message: motivoDeFora };
      }

      // Loja bloqueada por mensalidade (lib/loja-bloqueada.ts): pedido NOVO não
      // entra — nada gravado, impresso ou confirmado; fica no portal do parceiro.
      // O cron nem puxa a fila dela; aqui chegam o webhook e a importação manual.
      if (await lojaBloqueadaPorMensalidade(franchiseeIdToUse)) {
        return { action: "skipped", orderId, message: "loja bloqueada por mensalidade — pedido não importado" };
      }

      // ── 2ª barreira de idempotência: pelo NÚMERO do pedido no JotaJá ───────
      // O evento do feed traz só o UUID. O número que o lojista vê (displayId)
      // aparece agora, no corpo do pedido — e é por ele que casam os pedidos
      // que entraram por outro caminho: import manual ou resgate de um pedido
      // que o feed não entregou. Sem esta checagem o mesmo pedido vai duas
      // vezes para a cozinha.
      const displayIdReal = orderData.displayId ?? orderData.orderSeqNumber ?? null;
      if (displayIdReal) {
        const jaImportado = await prisma.customerOrder.findFirst({
          where: {
            franchiseeId: franchiseeIdToUse,
            openDeliveryChannel: "JOTAJA",
            OR: [
              { openDeliveryReference: String(displayIdReal) },
              { openDeliveryOrderId: String(displayIdReal) },
            ],
          } as any,
          select: { id: true, dailyOrderNumber: true, openDeliveryOrderId: true },
        });
        if (jaImportado) {
          // Amarra o UUID ao pedido que já está lá, para os eventos de status
          // seguintes (CONFIRMED, DISPATCHED…) o encontrarem pelo caminho normal.
          if (jaImportado.openDeliveryOrderId !== orderId) {
            await prisma.customerOrder
              .update({
                where: { id: jaImportado.id },
                data: { openDeliveryOrderId: orderId, openDeliveryReference: String(displayIdReal) },
              })
              .catch(() => {});
          }
          console.log(`[Jotaja] ℹ️ ${orderId} já existe como #${jaImportado.dailyOrderNumber} (entrou por outro caminho) — não duplicado`);
          return { action: "updated", orderId, message: `já existia como #${jaImportado.dailyOrderNumber}; UUID vinculado` };
        }
      }

      // REGRA DE OURO: Gerar dailyOrderNumber sequencial — entra no FINAL da fila sem mexer em nada existente
      const dailyOrderNumber = await generateDailyOrderNumber(franchiseeIdToUse);

      // Itens — inclui suporte a todos os formatos de payload do Open Delivery / JotaJá
      const rawItemsList = (
        (Array.isArray(orderData.items) && orderData.items.length > 0 ? orderData.items : null) ??
        (Array.isArray(orderData.orderItems) && orderData.orderItems.length > 0 ? orderData.orderItems : null) ??
        (Array.isArray(orderData.order?.items) && orderData.order?.items.length > 0 ? orderData.order?.items : null) ??
        (Array.isArray(orderData.products) && orderData.products.length > 0 ? orderData.products : null) ??
        (Array.isArray(orderData.cart?.items) && orderData.cart?.items.length > 0 ? orderData.cart?.items : null) ??
        []
      );

      // Espelho com id de OUTRA loja não é usado: o item desta loja ganha o seu
      // (lib/jotaja-loja.ts › idDoEspelhoJotaja).
      const idsGlobais = Array.from(new Set(rawItemsList.map((i: any) => `jotaja-${idDoItemJotaja(i)}`))) as string[];
      const donosDosIds = new Map<string, string>(
        (await prisma.menuProduct.findMany({
          where: { id: { in: idsGlobais } },
          select: { id: true, franchiseeId: true },
        })).map((p) => [p.id, p.franchiseeId] as [string, string]),
      );
      // Espelho que o código antigo criou em nome de um FUNCIONÁRIO desta loja
      // continua sendo da loja (senão nasceria um espelho repetido).
      const donosDeFora = Array.from(new Set(donosDosIds.values())).filter((d) => d !== franchiseeIdToUse);
      const contasDaLoja = [
        franchiseeIdToUse,
        ...(donosDeFora.length > 0
          ? (await prisma.user.findMany({ where: { id: { in: donosDeFora }, ownerId: franchiseeIdToUse }, select: { id: true } })).map((u) => u.id)
          : []),
      ];

      // Espelhos que já existem e cujo nome precisa acompanhar o catálogo do
      // JotaJá (lib/espelho-do-parceiro.ts) — corrigidos antes de gravar.
      const espelhos: { id: string; nome: string }[] = [];
      const items = rawItemsList.map((i: any) => {
        const itemName = i.name || i.productName || i.title || i.label || "Item Jotajá";
        const options = extrairOpcoesDoItem(i);
        const optionNames = options.map((o: any) => `${o.quantity > 1 ? o.quantity + 'x ' : ''}${o.name}`);
        const fullName = optionNames.length > 0
          ? `${itemName} | ${optionNames.join(" | ")}`
          : itemName;
        const qty = i.quantity ?? i.qty ?? 1;
        const rawUnit = valorOpenDelivery(i.unitPrice) || valorOpenDelivery(i.price) || 0;
        const rawTotal = valorOpenDelivery(i.totalPrice) || valorOpenDelivery(i.total) || 0;

        // Preço do item:
        // 1. Se totalPrice disponível → usar direto (já inclui opções pagas corretamente)
        // 2. Senão, calcular: unitPrice base + soma de opções que são ADIÇÕES
        let itemPrice = 0;
        if (rawTotal > 0 && qty > 0) {
          // totalPrice do JotaJá já inclui tudo (base + opções cobradas)
          itemPrice = rawTotal / qty;
        } else if (rawUnit > 0) {
          // Sem totalPrice — somar manualmente apenas adições
          const additionsSum = options.reduce(
            (sum: number, o: any) => sum + (valorOpenDelivery(o.addition) || 0) * (o.quantity || 1),
            0
          );
          itemPrice = rawUnit + additionsSum;
        } else {
          // Fallback: usar soma de opções como preço total
          const optionsSum = options.reduce(
            (sum: number, o: any) => sum + (valorOpenDelivery(o.price) || valorOpenDelivery(o.addition) || valorOpenDelivery(o.unitPrice) || 0) * (o.quantity || 1),
            0
          );
          itemPrice = optionsSum;
        }

        const comboSelsList = options.length > 0 ? options.map((o: any) => ({
          id: o.id,
          name: o.name,
          quantity: o.quantity ?? 1,
          price: valorOpenDelivery(o.price) || 0,
        })) : null;

        const comboSelectionsJson = comboSelsList ? JSON.stringify(comboSelsList) : null;
        // Sem id no catálogo, o espelho é pelo código externo ou pelo NOME —
        // nunca aleatório, senão cada pedido cria um espelho novo do mesmo item.
        const itemId = idDoItemJotaja(i);
        const espelhoId = idDoEspelhoJotaja(itemId, franchiseeIdToUse, donosDosIds.get(`jotaja-${itemId}`), contasDaLoja);
        espelhos.push({ id: espelhoId, nome: itemName });

        return {
          price: Math.round(itemPrice * 100) / 100,
          quantity: qty,
          productName: fullName,
          // A observação do prato, na coluna que a comanda imprime. Eram 0 de
          // 365 itens em 30 dias — ver lib/observacao-do-item.ts.
          notes: observacaoDoItem(i),
          comboSelections: comboSelectionsJson,
          menuProduct: {
            // O id é o do item no CATÁLOGO do JotaJá, o mesmo em todo pedido
            // daquele produto: o nome do espelho é o nome BASE, nunca o nome
            // com as opções deste pedido (as opções vão em `comboSelections`,
            // o nome completo do dia em `productName`). Era o mesmo defeito
            // da Brendi — ver lib/espelho-do-parceiro.ts.
            connectOrCreate: {
              where: { id: espelhoId } as any,
              create: {
                id: espelhoId,
                franchiseeId: franchiseeIdToUse,
                name: itemName,
                description: "",
                price: rawUnit || itemPrice,
                category: i.category || "Jotajá",
                // Só pelo nome BASE: combo com refri entre as opções não é bebida.
                isBeverage: isBeverageName(itemName),
                active: false,
              } as any,
            } as any,
          },
        };
      });
      // Espelho que já existe com outro nome (renomeado no JotaJá, ou nascido
      // com as opções no nome): corrige antes de gravar o pedido.
      await Promise.all(espelhos.map((e) => corrigirNomeDoEspelho(e.id, e.nome, franchiseeIdToUse, "JotaJá")));

      // Totais — handles {value, currency} objects
      const rawTotal = orderData.total?.orderAmount ?? orderData.total?.subTotal ?? orderData.totalPrice ?? orderData.total;
      const total = valorOpenDelivery(rawTotal);

      const paymentMethods = orderData.payments?.methods ?? orderData.payments ?? [];
      const paymentList = Array.isArray(paymentMethods) ? paymentMethods : [];

      // Delivery fee — Jotajá sends in total.deliveryFee or otherFees array
      let deliveryFeeValue = valorOpenDelivery(orderData.total?.deliveryFee) || valorOpenDelivery(orderData.delivery?.deliveryFee) || valorOpenDelivery(orderData.deliveryFee) || 0;
      if (!deliveryFeeValue && Array.isArray(orderData.otherFees)) {
        const delFee = orderData.otherFees.find((f: any) =>
          (f.type || f.name || "").toUpperCase().includes("DELIVERY") ||
          (f.type || f.name || "").toUpperCase().includes("FRETE") ||
          (f.type || f.name || "").toUpperCase().includes("FEE")
        );
        if (delFee) deliveryFeeValue = valorOpenDelivery(delFee.price ?? delFee.value);
      }

      // Descontos/benefits (completo)
      const benefits = orderData.benefits ?? [];
      let discountPlatform = 0, discountMerchant = 0, discountTotal = 0;
      const discountDetails: any[] = [];
      for (const benefit of benefits) {
        const value = benefit.value ?? 0;
        discountTotal += value;
        const sponsorships = Array.isArray(benefit.sponsorshipValues)
          ? benefit.sponsorshipValues
          : benefit.sponsorshipValues ? [benefit.sponsorshipValues] : [];
        let bPlatform = 0, bMerchant = 0;
        for (const sp of sponsorships) {
          const spName = (sp.name ?? sp.sponsorship ?? "").toUpperCase();
          const spValue = sp.value ?? 0;
          if (spName === "MERCHANT") bMerchant += spValue;
          else bPlatform += spValue;
        }
        if (sponsorships.length === 0 && value > 0) {
          if ((benefit.sponsorship ?? "").toUpperCase() === "MERCHANT") bMerchant += value;
          else bPlatform += value;
        }
        discountPlatform += bPlatform;
        discountMerchant += bMerchant;
        discountDetails.push({
          target: benefit.target ?? "CART",
          value, platform: bPlatform, merchant: bMerchant,
          description: benefit.campaign?.name ?? benefit.description ?? null,
        });
      }

      // ── CUPOM / DESCONTO ───────────────────────────────────────────────────
      // O JotaJá aplica cupom (ex.: HAKIM10, -10%) e manda o total já abatido,
      // mas nem sempre preenche `benefits` (padrão Open Delivery). O resultado
      // na comanda era um total menor que a soma dos itens, sem uma linha
      // dizendo por quê — a cozinha e o caixa viam "sumir" dinheiro.
      // Aqui: primeiro procuramos o cupom nos campos conhecidos; se não houver
      // valor de desconto, deduzimos pela diferença (itens + taxa − total),
      // que é aritmética e não depende do formato do payload.
      // Verificado contra a API real em 23/08/2026: o payload do JotaJá NÃO tem
      // `benefits` (o array que este código lia). O desconto vem em
      // `total.discount`, ao lado de itemsPrice / otherFees / orderAmount:
      //   total: { itemsPrice: {value}, otherFees: {value},
      //            discount: {value}, orderAmount: {value} }
      // Por isso o cupom (ex.: HAKIM10 -10%) sumia: o total chegava abatido, o
      // desconto ficava em zero e a comanda mostrava um total menor que a soma
      // dos itens, sem explicação. O código do cupom não vem no Open Delivery —
      // só o valor —, então mostramos o percentual.
      const cupomCodigo: string | null =
        orderData.coupon?.code ?? orderData.cupom?.codigo ?? orderData.voucher?.code ?? orderData.promoCode ?? null;

      if (discountTotal === 0) {
        const descontoDoPayload = valorOpenDelivery(orderData.total?.discount);
        const somaItens = valorOpenDelivery(orderData.total?.itemsPrice) ||
          items.reduce((s: number, it: any) => s + (it.price || 0) * (it.quantity || 1), 0);

        // Fonte primária: total.discount. Se vier ausente, deduz pela aritmética
        // (itens + taxa − total), que independe do formato do payload.
        const valor = descontoDoPayload > 0
          ? descontoDoPayload
          : Math.round((somaItens + deliveryFeeValue - total) * 100) / 100;

        if (valor > 0.01 && somaItens > 0) {
          discountTotal = Math.round(valor * 100) / 100;
          discountMerchant = discountTotal; // sem sponsorship no payload: é da loja
          const pct = Math.round((discountTotal / somaItens) * 100);
          discountDetails.push({
            target: "CART",
            value: discountTotal,
            platform: 0,
            merchant: discountTotal,
            description: cupomCodigo
              ? `Cupom ${String(cupomCodigo).toUpperCase()}${pct > 0 ? ` (-${pct}%)` : ""}`
              : `Cupom JotaJá${pct > 0 ? ` (-${pct}%)` : ""}`,
          });
        }
      } else if (cupomCodigo && discountDetails.length > 0 && !discountDetails[0].description) {
        discountDetails[0].description = `Cupom ${String(cupomCodigo).toUpperCase()}`;
      }

      // Se a taxa de entrega ainda veio 0 em pedido DELIVERY, calcula como a diferença entre total e subtotal
      if (deliveryFeeValue === 0 && (orderData.total?.orderAmount || orderData.totalPrice) && orderData.total?.subTotal) {
        const orderTotal = valorOpenDelivery(orderData.total?.orderAmount ?? orderData.totalPrice);
        const subTotal = valorOpenDelivery(orderData.total?.subTotal);
        const benefitsValue = discountTotal || 0;
        const calcFee = orderTotal - subTotal + benefitsValue;
        if (calcFee > 0 && calcFee < 100) {
          deliveryFeeValue = Math.round(calcFee * 100) / 100;
        }
      }
      // Data de entrega / Prazo limite do JotaJá
      const isTakeout =
        orderData.orderType === "TAKEOUT" ||
        Boolean(orderData.takeout) ||
        orderData.deliveryType === "TAKEOUT" ||
        orderData.deliveryType === "RETIRADA";

      const createdMs = orderData.createdAt ? new Date(orderData.createdAt).getTime() : Date.now();

      const isExplicitScheduled =
        orderData.orderTiming === "SCHEDULED" ||
        Boolean(orderData.schedule?.scheduledDatetimeEnd) ||
        Boolean(orderData.schedule?.scheduledDatetimeStart) ||
        orderData.takeout?.mode === "SCHEDULED" ||
        orderData.delivery?.mode === "SCHEDULED";

      let scheduledDatetime: Date | null = null;

      if (isExplicitScheduled) {
        const rawScheduled =
          orderData.schedule?.scheduledDatetimeEnd ??
          orderData.schedule?.scheduledDatetimeStart ??
          orderData.scheduledDatetime ??
          orderData.preparationStartDateTime;
        if (rawScheduled) {
          scheduledDatetime = new Date(rawScheduled);
        }
      } else {
        // Pedido Imediato: Se for Retirada no local, o prazo é 40 minutos a partir da criação
        if (isTakeout) {
          const rawTakeoutEnd = orderData.takeout?.estimatedTakeoutWindow?.end || orderData.takeout?.takeoutDeadline;
          if (rawTakeoutEnd && new Date(rawTakeoutEnd).getTime() > createdMs + 5 * 60000) {
            scheduledDatetime = new Date(rawTakeoutEnd);
          } else {
            scheduledDatetime = new Date(createdMs + 40 * 60000); // 40 minutos para Retirada
          }
        } else {
          const rawDeliveryEnd = orderData.delivery?.deliveryDeadline || orderData.delivery?.estimatedDeliveryWindow?.end;
          if (rawDeliveryEnd && new Date(rawDeliveryEnd).getTime() > createdMs + 5 * 60000) {
            scheduledDatetime = new Date(rawDeliveryEnd);
          } else {
            scheduledDatetime = new Date(createdMs + 50 * 60000); // 50 minutos para Entrega
          }
        }
      }
      const deliveryDeadline = scheduledDatetime;

      // Pagamento
      const { parseOrderPaymentInfo } = await import("@/lib/payment-parser");
      const parsedPay = parseOrderPaymentInfo(orderData, "JOTAJA");
      const resolvedPaymentMethod = parsedPay.paymentMethod;
      const changeAmount = parsedPay.changeAmount;

      const customerCpfCnpj = orderData.customer?.taxPayerIdentificationNumber ?? orderData.customer?.documentNumber ?? null;

      // Notas — customer observations prominent
      // `||`, não `??`: string vazia é o que vem quando não há recado.
      const customerNote = orderData.extraInfo || orderData.delivery?.observations || orderData.customer?.customerNote || null;
      const phone = orderData.customer?.phone;
      const phoneNumber = phone?.number ?? (typeof phone === "string" ? phone : "");
      const phoneLocalizer = phone?.localizer;

      // Collect item-level special instructions
      const itemNotes = rawItemsList
        .map((i: any) => ({ nome: i.name || i.productName || "Item", obs: observacaoDoItem(i) }))
        .filter((x: any) => x.obs)
        .map((x: any) => `${x.nome}: ${x.obs}`);

      const fusoDaLojaAlvo = await fusoDaLoja(franchiseeIdToUse);
      const notesArr = [
        `Pedido Jotajá #${(orderData.displayId ?? orderId.slice(-6)).toUpperCase()}`,
        (scheduledDatetime && isExplicitScheduled) ? `📅 AGENDADO para ${dataHoraDaLoja(scheduledDatetime, fusoDaLojaAlvo)}` : null,
        discountTotal > 0
          ? `🏷️ ${discountDetails[0]?.description || "Desconto"}: -R$${discountTotal.toFixed(2)}` +
            (discountPlatform > 0 ? ` (Plataforma: R$${discountPlatform.toFixed(2)} | Loja: R$${discountMerchant.toFixed(2)})` : "")
          : null,
        customerNote ? `📝 OBS: ${customerNote}` : null,
        ...itemNotes.map((n: string) => `📝 ${n}`),
      ].filter(Boolean).join("\n");

      // Status inicial
      let initialStatus = "NOVO";
      if (isConfirmed)   initialStatus = "ACEITO";
      else if (isPreparation)  initialStatus = "PREPARANDO";
      else if (isReadyPickup)  initialStatus = "PRONTO";
      else if (isDispatched)   initialStatus = "SAIU_ENTREGA";
      else if (isConcluded)    initialStatus = "ENTREGUE";

      const dByRaw = (
        orderData.delivery?.deliveredBy ||
        orderData.delivery?.deliveryBy ||
        orderData.deliveredBy ||
        orderData.deliveryBy ||
        orderData.logistics?.deliveryBy ||
        orderData.logistics?.deliveredBy ||
        ""
      ).toString().toUpperCase();

      const deliveryBy = (
        dByRaw.includes("PARTNER") ||
        dByRaw.includes("LOGISTICS") ||
        dByRaw.includes("JOTAJA")
      ) ? "JOTAJA" : "MERCHANT";

      const pickupCode = (
        orderData.delivery?.pickupCode ||
        orderData.pickupCode ||
        orderData.driver?.pickupCode ||
        orderData.logistics?.pickupCode ||
        null
      )?.toString().trim() || null;

      // === CRIAR PEDIDO COM RETRY (barreira anti-perda) ===
      let createSuccess = false;
      let lastCreateError: any = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await (prisma.customerOrder as any).create({
            data: {
              franchiseeId: franchiseeIdToUse,
              dailyOrderNumber,
              kdsStage: "PRODUCTION",
              kdsProductionAt: new Date(),
              openDeliveryOrderId: orderId,
              openDeliveryReference: orderData.displayId ?? undefined,
              openDeliveryChannel: "JOTAJA",
              scheduledDatetime: scheduledDatetime ?? deliveryDeadline,
              changeAmount,
              customerCpfCnpj,
              deliveryBy,
              ifoodPickupCode: pickupCode ?? undefined,
              discountTotal: discountTotal > 0 ? discountTotal : null,
              discountMerchant: discountMerchant > 0 ? discountMerchant : null,
              discountDetails: discountDetails.length > 0 ? discountDetails : undefined,
              source: "JOTAJA",
              customerName: orderData.customer?.name ?? "Cliente Jotajá",
              customerPhone: phoneLocalizer ? `${phoneNumber} ID: ${phoneLocalizer}` : phoneNumber,
              customerAddress: (() => {
                const addr = orderData.delivery?.deliveryAddress;
                if (!addr) return "";
                const formatted = addr.formattedAddress || "";
                const street = addr.streetName ? `${addr.streetName}${addr.streetNumber ? ` ${addr.streetNumber}` : ""}${addr.complement ? ` ${addr.complement}` : ""}` : formatted;
                const neighborhood = addr.neighborhood || "";
                const city = addr.city || "";
                const parts: string[] = [];
                if (street) parts.push(street);
                if (neighborhood && (!street || !street.toLowerCase().includes(neighborhood.toLowerCase()))) {
                  parts.push(neighborhood);
                }
                if (city) parts.push(city);
                return parts.join(" - ");
              })(),
              deliveryType: (() => {
                const ot = (orderData.orderType || "").toUpperCase();
                const dm = (orderData.deliveryMode || orderData.takeoutMode || "").toUpperCase();
                const isTakeout =
                  ot === "TAKEOUT" ||
                  ot === "TOGO" ||
                  ot === "PICKUP" ||
                  ot === "RETIRADA" ||
                  ot === "IN_STORE" ||
                  Boolean(orderData.takeout) ||
                  (dm !== "" && dm !== "DELIVERY") ||
                  (!orderData.delivery?.deliveryAddress?.streetName && !orderData.delivery?.deliveryAddress?.formattedAddress && deliveryFeeValue === 0);
                return isTakeout ? "RETIRADA" : "DELIVERY";
              })(),
              paymentMethod: resolvedPaymentMethod,
              totalAmount: Math.round(total * 100) / 100,
              deliveryFee: Math.round(deliveryFeeValue * 100) / 100,
              status: initialStatus,
              notes: notesArr || undefined,
              createdAt: new Date(),
              items: {
                create: items,
              },
            },
          });
          createSuccess = true;

          // ── BAIXA DE ESTOQUE ──────────────────────────────────────────────
          //
          // Não existia neste caminho (nem em nenhum outro de marketplace): o
          // pedido do Jotajá entrava e o estoque não sentia. O único gatilho
          // do sistema era a TRANSIÇÃO para ACEITO, e o pedido importado já
          // nasce no status final — nunca transita.
          //
          // A ficha técnica do produto-espelho é resolvida em src/lib/stock.ts
          // pelo nome do produto no cardápio. Idempotente por `sourceRef`, e
          // sem await para não segurar a importação.
          try {
            const criado = await prisma.customerOrder.findFirst({
              // O Jotajá grava em `openDeliveryOrderId` (o padrão Open
              // Delivery), não num campo próprio — é o mesmo campo que o
              // Brendi e o 99Food usam.
              where: { franchiseeId: franchisee.id, openDeliveryOrderId: orderId } as any,
              select: { id: true },
              orderBy: { createdAt: "desc" },
            });
            if (criado) {
              const { deductStockForOrder } = await import("@/lib/stock");
              deductStockForOrder(criado.id).catch((e) =>
                console.error(`[Jotaja] Baixa de estoque falhou para ${orderId}:`, e?.message)
              );
            }
          } catch (e: any) {
            console.error(`[Jotaja] Não consegui disparar a baixa de ${orderId}:`, e?.message);
          }

          break; // Sucesso — sai do loop de retry
        } catch (createErr: any) {
          lastCreateError = createErr;
          // Unique constraint = pedido já existe (race condition) — não é erro real
          if (createErr?.code === "P2002") {
            console.log(`[Jotaja] ℹ️ Pedido ${orderId} já existe (race condition detectada) — ok`);
            return { action: "skipped", orderId, message: "duplicata detectada via constraint" };
          }
          console.error(`[Jotaja] ❌ Tentativa ${attempt}/3 de criar pedido ${orderId} FALHOU:`, createErr?.message);
          if (attempt < 3) {
            await new Promise(res => setTimeout(res, 2000)); // Espera 2s antes de retry
          }
        }
      }

      if (!createSuccess) {
        // FALLBACK: Salvar dados mínimos do pedido para recuperação manual
        console.error(`[Jotaja] 🚨 PEDIDO PERDIDO APÓS 3 TENTATIVAS — orderId=${orderId}, cliente=${orderData.customer?.name}, total=${total}`);
        try {
          // Tenta criar com dados mínimos (sem itens complexos) como última barreira
          // Gerar novo número sequencial para o fallback (pode ter mudado desde o primeiro try)
          const recoveryDailyNumber = await generateDailyOrderNumber(franchiseeIdToUse);
          await (prisma.customerOrder as any).create({
            data: {
              franchiseeId: franchiseeIdToUse,
              dailyOrderNumber: recoveryDailyNumber,
              kdsStage: "PRODUCTION",
              kdsProductionAt: new Date(),
              openDeliveryOrderId: `${orderId}_recovered`,
              openDeliveryReference: orderData.displayId ?? undefined,
              openDeliveryChannel: "JOTAJA",
              source: "JOTAJA",
              customerName: orderData.customer?.name ?? "Cliente Jotajá (RECUPERADO)",
              customerPhone: phoneLocalizer ? `${phoneNumber} ID: ${phoneLocalizer}` : phoneNumber,
              customerAddress: orderData.delivery?.deliveryAddress?.formattedAddress || "",
              deliveryType: "DELIVERY",
              paymentMethod: resolvedPaymentMethod || "Verificar",
              totalAmount: total,
              deliveryFee: deliveryFeeValue,
              status: "NOVO",
              notes: `⚠️ PEDIDO RECUPERADO — Erro original: ${lastCreateError?.message?.slice(0, 200)}. Verifique itens manualmente.`,
              createdAt: new Date(),
              items: {
                create: [{
                  quantity: 1,
                  price: total,
                  menuProduct: {
                    connectOrCreate: {
                      where: { id: `jotaja-recovered-${orderId}` } as any,
                      create: {
                        id: `jotaja-recovered-${orderId}`,
                        franchiseeId: franchiseeIdToUse,
                        name: `Pedido JotaJá #${orderData.displayId || orderId.slice(-6)} (verificar itens)`,
                        description: "Pedido recuperado automaticamente",
                        price: total,
                        category: "Jotajá",
                        active: true,
                      } as any,
                    } as any,
                  },
                }],
              },
            },
          });
          console.log(`[Jotaja] 🛟 Pedido ${orderId} RECUPERADO com dados mínimos!`);
          return { action: "created", orderId, message: `RECUPERADO com dados mínimos após falha: ${lastCreateError?.message}` };
        } catch (fallbackErr: any) {
          console.error(`[Jotaja] 🚨🚨 FALHA TOTAL — nem o fallback funcionou para ${orderId}:`, fallbackErr?.message);
          return { action: "error", orderId, message: `FALHA TOTAL: ${lastCreateError?.message}` };
        }
      }

      // BROADCAST REMOVIDO — Esse bloco criava cópias do pedido para contas secundárias,
      // causando duplicatas massivas (7x por pedido). Cada pedido Jotajá deve existir
      // APENAS UMA VEZ, vinculado ao franchisee principal (contatohakim@gmail.com).

      // Auto-confirmar pedidos PLACED
      if (isPlaced) {
        try {
          await jotajaMutate(`/v1/orders/${orderId}/confirm`, { method: "POST" });
        } catch { /* não crítico */ }
      }
      // Auto-enfileira impressão térmica para novos pedidos do JotaJá — menos o
      // que já nasce ENTREGUE (o 1º evento visto foi o "concluído"): não há o
      // que preparar, e a comanda sairia do nada na cozinha.
      if (initialStatus !== "ENTREGUE") try {
        const fullOrder = await prisma.customerOrder.findFirst({
          where: { openDeliveryOrderId: orderId, franchiseeId: franchiseeIdToUse },
          include: {
            items: {
              include: { menuProduct: { select: { id: true, name: true, isBeverage: true } } }
            }
          }
        });
        if (fullOrder) {
          const { pushJobToPrintQueue } = await import("@/app/api/store/print-queue/route");
          pushJobToPrintQueue(franchiseeIdToUse, fullOrder, (franchisee as any).storeName || undefined);
        }
      } catch (printErr) {
        console.error("[Jotaja] Erro ao enfileirar auto-impressão:", printErr);
      }

      return { action: "created", orderId, message: `status=${initialStatus}` };

    } else {
      // ── ATUALIZAR pedido existente (Apenas avançar status, NUNCA retroceder) ─────────────────
      const FINAL_STATUSES = ["ENTREGUE", "ENCERRADO", "CANCELADO"];
      if (existing && FINAL_STATUSES.includes(existing.status)) {
        return { action: "skipped", orderId, message: `pedido já finalizado (${existing.status}) - mantido` };
      }

      let newStatus: string | null = null;
      if (isConfirmed)   newStatus = "ACEITO";
      else if (isPreparation) newStatus = "PREPARANDO";
      else if (isReadyPickup) newStatus = "PRONTO";
      else if (isDispatched)  newStatus = "SAIU_ENTREGA";
      else if (isConcluded)   newStatus = "ENTREGUE";

      if (newStatus) {
        const STATUS_RANK: Record<string, number> = {
          NOVO: 0, ACEITO: 1, PREPARANDO: 2, PRONTO: 3, SAIU_ENTREGA: 4, ENTREGUE: 5, ENCERRADO: 5, CANCELADO: 5
        };
        const currentRank = STATUS_RANK[existing?.status || "NOVO"] || 0;
        const newRank = STATUS_RANK[newStatus] || 0;

        if (newRank >= currentRank) {
          // Só nesta loja (a da credencial).
          const naLoja = {
            franchiseeId: targetFranchiseeId,
            OR: [
              { openDeliveryOrderId: orderId },
              { openDeliveryOrderId: { startsWith: `${orderId}_` } },
              { openDeliveryReference: orderId },
            ],
          };
          await (prisma.customerOrder as any).updateMany({
            where: naLoja as any,
            data: { status: newStatus },
          });
          // NFC-e: lib/fiscal-momento decide se este status é a hora; sem esta linha a nota só saía pela varredura do cron.
          import("./fiscal-automatico").then((m) => m.emitirNfceDosPedidos(naLoja as any)).catch(() => {});
          return { action: "updated", orderId, message: `→ ${newStatus}` };
        } else {
          return { action: "skipped", orderId, message: `ignorado regresso de status ${existing?.status} → ${newStatus}` };
        }
      }
      return { action: "skipped", orderId, message: "sem mudança de status" };
    }
  } catch (err: any) {
    console.error(`[Jotaja] ❌ Exceção processando ${orderId}:`, err?.message, err?.stack?.split("\n")[1]?.trim());
    return { action: "error", orderId, message: err.message };
  }
}
