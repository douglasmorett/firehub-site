/**
 * lib/processBrendiEvent.ts
 * Lógica centralizada de processamento de eventos Open Delivery (Brendi).
 * Usada por: webhook, cron-poll, dashboard-poll e import manual — UM processador,
 * nunca três cópias (três cópias é onde uma diverge em silêncio).
 *
 * Clone estrutural de processJotajaEvent.ts — a Brendi fala o MESMO contrato
 * Open Delivery (Abrasel) do JotaJá, então o esqueleto testado em produção é
 * reaproveitado inteiro. As diferenças deliberadas:
 *
 *   1. As credenciais são POR LOJA e resolvidas dentro de @/lib/brendi-api
 *      (brendiFetch recebe o storeId) — por isso a assinatura aqui é
 *      processBrendiEvent(evento, opcoes?) em vez de receber fetchers.
 *   2. Os campos brendi* do User NÃO existem no Prisma Client (coluna garantida
 *      no boot ANTES do schema — regra da casa de migração sem quebrar
 *      produção). Todo acesso a eles é SQL cru parametrizado, como
 *      food99-lojas.ts faz.
 *   3. Modo { apenasPrever: true }: devolve { traduzido, cru } SEM gravar nada.
 *      Foi esse modo que, no 99Food, pegou o parser lendo campo errado com
 *      total zero ANTES de entrar em produção.
 */
import { prisma } from "@/lib/prisma";
import { dataHoraDaLoja } from "@/lib/fuso";
import { fusoDaLoja } from "@/lib/fuso-da-loja";
import { isBeverageName } from "@/lib/beverage";
import { generateDailyOrderNumber } from "@/lib/order-number";
import { brendiFetch, confirmarPedidoBrendi } from "@/lib/brendi-api";

export interface BrendiEvent {
  id?: string;
  eventId?: string;
  code?: string;
  fullCode?: string;
  eventType?: string;
  orderId: string;
  /** Alguns originadores Open Delivery mandam o merchant já no evento do feed. */
  merchantId?: string;
  displayId?: string | number;
  orderSeqNumber?: string | number;
  metadata?: Record<string, any>;
}

export interface ProcessBrendiOptions {
  /**
   * Loja cujo feed produziu o evento (cron/dashboard-poll sabem; webhook não).
   * Usada para autenticar o GET do pedido e como candidata na resolução de
   * loja — mas NUNCA vence um merchant.id divergente (multi-tenant estrito).
   */
  targetFranchiseeId?: string;
  /** true = traduz e devolve { traduzido, cru } sem tocar no banco. */
  apenasPrever?: boolean;
}

export interface ProcessResult {
  action: "created" | "updated" | "cancelled" | "dispute" | "skipped" | "error";
  orderId: string;
  message?: string;
  /**
   * Só para `action: "error"`: reenviar este evento tem chance de dar certo?
   *
   * Banco fora, rede até a Brendi, GET que falhou — sim, e é por isso que o
   * webhook responde 500 nesses casos, para a Brendi mandar de novo.
   *
   * "Não existe loja com este merchant" — não. Reenviar em 30 s encontra
   * exatamente o mesmo nada, e o 500 ainda faz a Brendi marcar nosso endpoint
   * como quebrado. Foi o que aconteceu enquanto nenhuma loja estava conectada:
   * TODO evento virava 500, inclusive a validação da URL no cadastro da
   * integração. Estes casos respondem 200, ficam registrados no diagnóstico, e
   * o evento continua na fila do polling (não é ackado) para entrar sozinho
   * assim que a loja for conectada.
   *
   * Ausente = true, que é o comportamento antigo para todo erro não listado.
   */
  reenviarAdianta?: boolean;
  /** Presentes apenas no modo apenasPrever. */
  traduzido?: any;
  cru?: any;
}

/**
 * Linha do User com os campos brendi* — que estão FORA do schema.prisma
 * (colunas garantidas no boot por brendi-colunas.ts). Por isso o shape é
 * declarado à mão e as buscas abaixo são $queryRaw parametrizado.
 */
interface LojaBrendi {
  id: string;
  ownerId: string | null;
  storeName: string | null;
  brendiMerchantId: string | null;
}

// LEFT(email, 8) em vez de LIKE 'deleted_%': o underscore é curinga no LIKE e
// o escape dele dentro de template literal do Prisma é armadilha — LEFT não tem
// pattern nenhum para escapar.
/**
 * Guarda os `send*` do pedido — quais chamadas de status a Brendi espera de
 * volta desta vez.
 *
 * Nunca lança e nunca bloqueia: pedido gravado sem as flags simplesmente cai
 * no comportamento anterior em `brendi-status.ts`. A coluna é garantida no
 * boot e não está no schema.prisma, daí o SQL cru.
 */
async function gravarSendFlags(orderId: string, orderData: any): Promise<void> {
  try {
    const flags: Record<string, boolean> = {};
    for (const chave of ["sendPreparing", "sendDelivered", "sendPickedUp", "sendTracking"]) {
      if (typeof orderData?.[chave] === "boolean") flags[chave] = orderData[chave];
    }
    if (Object.keys(flags).length === 0) return;
    await prisma.$executeRaw`
      UPDATE "CustomerOrder"
      SET "brendiSendFlags" = ${JSON.stringify(flags)}::jsonb
      WHERE "openDeliveryOrderId" = ${orderId}
    `;
  } catch (e: any) {
    console.warn(`[Brendi] flags de status não gravadas para ${orderId}: ${e?.message}`);
  }
}

async function lojaBrendiPorMerchantId(merchantId: string): Promise<LojaBrendi | null> {
  const rows = await prisma.$queryRaw<LojaBrendi[]>`
    SELECT "id", "ownerId", "storeName", "brendiMerchantId"
    FROM "User"
    WHERE "brendiMerchantId" = ${merchantId}
      AND LEFT("email", 8) <> 'deleted_'
    LIMIT 1
  `;
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

/**
 * Grava o `merchant.id` aprendido no primeiro pedido.
 *
 * Só grava se NENHUMA outra loja já reivindicou esse id — pedido caindo na
 * cozinha errada é pior que pedido recusado com log, e essa é a mesma trava
 * que a tela de Integrações aplica. Falha aqui não derruba o pedido: a loja
 * segue sem o id e o fallback de "única loja conectada" continua valendo.
 */
async function adotarMerchantId(lojaId: string, merchantId: string): Promise<void> {
  try {
    const dono = await prisma.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "User" WHERE "brendiMerchantId" = ${merchantId} AND "id" <> ${lojaId} LIMIT 1
    `;
    if (Array.isArray(dono) && dono.length > 0) {
      console.warn(`[Brendi] merchant ${merchantId} já pertence à loja ${dono[0].id} — não adotado por ${lojaId}`);
      return;
    }
    await prisma.$executeRaw`
      UPDATE "User" SET "brendiMerchantId" = ${merchantId}
      WHERE "id" = ${lojaId} AND "brendiMerchantId" IS NULL
    `;
    console.log(`[Brendi] ✅ loja ${lojaId} adotou o merchant ${merchantId} (aprendido no pedido)`);
  } catch (e: any) {
    console.warn(`[Brendi] não consegui gravar o merchant ${merchantId} na loja ${lojaId}: ${e?.message}`);
  }
}

async function lojaBrendiPorId(id: string): Promise<LojaBrendi | null> {
  const rows = await prisma.$queryRaw<LojaBrendi[]>`
    SELECT "id", "ownerId", "storeName", "brendiMerchantId"
    FROM "User"
    WHERE "id" = ${id}
    LIMIT 1
  `;
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

/**
 * Lojas Brendi realmente conectadas (flag + credenciais presentes).
 * LIMIT 2 de propósito: só precisamos distinguir 0 / exatamente-1 / 2+.
 * Com 2+ NUNCA adivinhamos a dona — pedido na cozinha errada é pior que
 * pedido recusado com log.
 */
async function lojasBrendiConectadas(): Promise<LojaBrendi[]> {
  const rows = await prisma.$queryRaw<LojaBrendi[]>`
    SELECT "id", "ownerId", "storeName", "brendiMerchantId"
    FROM "User"
    WHERE "brendiConnected" = true
      AND "brendiClientId" IS NOT NULL
      AND "brendiClientSecret" IS NOT NULL
      AND LEFT("email", 8) <> 'deleted_'
    LIMIT 2
  `;
  return Array.isArray(rows) ? rows : [];
}

/**
 * Derruba máscaras de privacidade que originadores mandam no lugar do dado
 * real ("privacy protection", "protected", etc.). Melhor campo vazio — que a
 * comanda mostra como ausente — do que a cozinha gritando por um cliente
 * chamado "Privacy Protection".
 */
function derrubarMascaraPrivacidade(valor: any): string {
  const s = (valor ?? "").toString().trim();
  if (!s) return "";
  if (/privacy\s*protect|privacidade|protected|anonymized|anonimizado/i.test(s)) return "";
  return s;
}

/**
 * Processa um único evento Open Delivery da Brendi.
 * Retorna o resultado do processamento (mesma forma do processJotajaEvent).
 * Auto-confirma pedidos CREATED via API (originadores Open Delivery cancelam
 * pedido não confirmado).
 *
 * IMPORTANTE para quem chama: 'error' significa que o evento NÃO deve ser
 * ackado — o polling reentrega e essa é a semântica natural de retry.
 */
export async function processBrendiEvent(
  evento: BrendiEvent,
  opcoes?: ProcessBrendiOptions,
): Promise<ProcessResult> {
  const orderId = evento?.orderId ?? "";
  if (!orderId) return { action: "skipped", orderId: "", message: "sem orderId" };

  const targetFranchiseeId = opcoes?.targetFranchiseeId;
  const apenasPrever = opcoes?.apenasPrever === true;

  // A Brendi manda eventType (padrão Open Delivery); code/fullCode entram como
  // tolerância defensiva — spec e realidade divergem, lição JotaJá.
  const et = (evento.eventType ?? evento.fullCode ?? evento.code ?? "").toString().toUpperCase();
  const isCreated        = et === "CREATED" || et === "PLACED";
  const isConfirmed      = et === "CONFIRMED";
  const isPreparing      = et === "PREPARING" || et === "IN_PREPARATION" || et === "PREPARATION_STARTED";
  const isReadyPickup    = et === "READY_FOR_PICKUP" || et === "READY_TO_PICKUP";
  const isDispatched     = et === "DISPATCHED" || et === "PICKED_UP";
  const isDelivered      = et === "DELIVERED" || et === "CONCLUDED";
  const isPickupArea     = et === "PICKUP_AREA_ASSIGNED";
  const isCancelRequest  = et === "CANCELLATION_REQUESTED" || et === "HANDSHAKE_DISPUTE";
  const isCancelDenied   = et === "CANCELLATION_REQUEST_DENIED";
  const isCancelled      = et === "CANCELLED";

  try {
    // ── Eventos que atuam sobre pedido JÁ EXISTENTE ────────────────────────
    // No modo apenasPrever nada disso roda: o objetivo é ver a tradução, não
    // mexer no banco.

    // Logística de retirada (PICKUP_AREA_ASSIGNED): só registro, NUNCA muda
    // status — mesmo tratamento do deliveryStatus do 99Food. Mudar status por
    // evento de logística foi o que embaralhava o KDS.
    if (isPickupArea && !apenasPrever) {
      console.log(`[Brendi] ℹ️ ${orderId}: PICKUP_AREA_ASSIGNED registrado (logística; sem mudança de status)`);
      return { action: "skipped", orderId, message: "logística registrada — sem mudança de status" };
    }

    // Negociação de cancelamento: grava a disputa; o modal do dashboard já
    // existe e aponta para /api/customer-order/brendi-action.
    if (isCancelRequest && !apenasPrever) {
      const meta = evento.metadata || {};
      const disputeData = {
        pending: true,
        disputeId: meta.disputeId || meta.cancellationId || evento.eventId || evento.id || "",
        reason: meta.reason || meta.message || meta.cancellationReason || meta.cancelCodeDescription || "Cliente solicitou cancelamento",
        handshakeType: meta.handshakeType || "",
        expiresAt: meta.expiresAt || "",
        requestedAt: meta.createdAt || new Date().toISOString(),
      };
      // startsWith cobre o registro de fallback '{uuid}_recovered' — a disputa
      // tem que alcançar o pedido mesmo quando ele entrou pela via de resgate.
      await (prisma.customerOrder as any).updateMany({
        where: {
          OR: [
            { openDeliveryOrderId: orderId },
            { openDeliveryOrderId: { startsWith: `${orderId}_` } },
          ],
        } as any,
        data: { cancelDispute: disputeData },
      });
      return { action: "dispute", orderId, message: `disputeId=${disputeData.disputeId}` };
    }

    // Negativa de cancelamento: encerra a disputa e deixa rastro na comanda —
    // sem a nota, o lojista via a disputa sumir e não sabia o desfecho.
    if (isCancelDenied && !apenasPrever) {
      const pedido: any = await prisma.customerOrder.findFirst({
        where: {
          OR: [
            { openDeliveryOrderId: orderId },
            { openDeliveryOrderId: { startsWith: `${orderId}_` } },
          ],
        } as any,
        select: { id: true, notes: true } as any,
      });
      if (!pedido) {
        return { action: "skipped", orderId, message: "negativa de cancelamento para pedido desconhecido" };
      }
      await (prisma.customerOrder as any).update({
        where: { id: pedido.id },
        data: {
          cancelDispute: { pending: false, denied: true, deniedAt: new Date().toISOString() },
          notes: [pedido.notes || "", "❌ Solicitação de cancelamento NEGADA (Brendi)"].filter(Boolean).join("\n"),
        },
      });
      return { action: "updated", orderId, message: "cancelamento negado — disputa encerrada" };
    }

    // Cancelamento definitivo: CANCELLED passa por cima até de status final
    // (estorno, regra 99Food) — mas preserva cancelledBy='LOJA' quando a
    // própria loja já tinha cancelado, senão o relatório culpa o canal errado.
    if (isCancelled && !apenasPrever) {
      const existente: any = await prisma.customerOrder.findFirst({
        where: {
          OR: [
            { openDeliveryOrderId: orderId },
            { openDeliveryOrderId: { startsWith: `${orderId}_` } },
          ],
        } as any,
        select: { cancelledBy: true } as any,
      });
      const cancelData: any = { status: "CANCELADO", cancelDispute: { pending: false } };
      if (!existente?.cancelledBy || existente.cancelledBy !== "LOJA") {
        cancelData.cancelledBy = "BRENDI";
      }
      await (prisma.customerOrder as any).updateMany({
        where: {
          OR: [
            { openDeliveryOrderId: orderId },
            { openDeliveryOrderId: { startsWith: `${orderId}_` } },
          ],
        } as any,
        data: cancelData,
      });
      return { action: "cancelled", orderId };
    }

    // ── 1ª barreira de idempotência ────────────────────────────────────────
    // openDeliveryOrderId é globalmente único (@unique no schema) — busca global.
    // openDeliveryReference NÃO é único (só @@index) e é gravado também por
    // JotaJá, 99Food, API v1 e import manual. Casar só por ele encontrava o
    // pedido de OUTRO canal, o evento virava "sem mudança de status", vinha o
    // ACK e o pedido novo sumia. Por isso a condição por reference exige
    // loja + canal ('BRENDI') juntos.
    const idempotencyConditions: any[] = [
      { openDeliveryOrderId: orderId },
      { openDeliveryOrderId: { startsWith: `${orderId}_` } },
    ];
    if (targetFranchiseeId) {
      idempotencyConditions.push({
        openDeliveryReference: orderId,
        franchiseeId: targetFranchiseeId,
        openDeliveryChannel: "BRENDI",
      });
      const displayRef = evento.displayId || evento.orderSeqNumber;
      if (displayRef) {
        idempotencyConditions.push({
          openDeliveryReference: String(displayRef),
          franchiseeId: targetFranchiseeId,
          openDeliveryChannel: "BRENDI",
        });
      }
    }
    const existing = await prisma.customerOrder.findFirst({
      where: { OR: idempotencyConditions } as any,
    });

    if (!existing || apenasPrever) {
      // ── CRIAR pedido novo (ou apenas PREVER a tradução) ──────────────────

      // Loja para AUTENTICAR o GET do pedido (as credenciais são por loja).
      // Ordem: merchant do próprio evento → loja do feed que trouxe o evento →
      // única loja conectada. Sem loja = erro (sem ACK; o polling reentrega).
      const merchantIdDoEvento = evento.merchantId || (evento as any).merchant?.id || null;
      let lojaCredencial: LojaBrendi | null = null;
      if (merchantIdDoEvento) {
        lojaCredencial = await lojaBrendiPorMerchantId(String(merchantIdDoEvento));
      }
      if (!lojaCredencial && targetFranchiseeId) {
        lojaCredencial = await lojaBrendiPorId(targetFranchiseeId);
      }
      if (!lojaCredencial) {
        const conectadas = await lojasBrendiConectadas();
        if (conectadas.length === 1) lojaCredencial = conectadas[0];
      }
      if (!lojaCredencial) {
        const msg = `nenhuma loja para autenticar o GET do pedido (merchant evento: ${merchantIdDoEvento || "N/A"})`;
        console.error(`[Brendi] ❌ ${orderId}: ${msg}`);
        // Sem credencial nenhuma no banco não há o que reenviar resolva.
        return { action: "error", orderId, message: msg, reenviarAdianta: false };
      }

      // GET /v1/orders/{uuid} com até 3 tentativas resilientes — a Brendi não
      // tem (até prova em contrário) endpoint de listagem/recuperação; perder
      // esta janela é perder a venda.
      let orderRes: Response | null = null;
      let ultimoErro = "";
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const res = await brendiFetch(`/v1/orders/${orderId}`, lojaCredencial.id);
          if (res.ok) { orderRes = res; break; }
          ultimoErro = `HTTP ${res.status}`;
        } catch (e: any) {
          ultimoErro = e?.message || "erro de rede";
        }
        if (attempt < 3) await new Promise(r => setTimeout(r, 500));
      }

      if (!orderRes || !orderRes.ok) {
        const msg = `GET /orders falhou após 3 tentativas (${ultimoErro || "network error"})`;
        // Sem log, este era o caminho em que o pedido sumia sem deixar rastro.
        console.error(`[Brendi] ❌ ${orderId}: ${msg}`);
        return { action: "error", orderId, message: msg };
      }
      const orderData = await orderRes.json();

      // ── Resolução de loja ESTRITA (multi-tenant) ─────────────────────────
      // A dona do pedido é quem tem brendiMerchantId == merchant.id do PEDIDO
      // (fonte da verdade, não o evento). targetFranchiseeId só vale quando o
      // merchant.id não veio ou bate. Fallback SÓ com EXATAMENTE 1 loja
      // conectada; 2+ = recusa registrada — nunca adivinhar a dona.
      const eventMerchantId = orderData.merchant?.id ? String(orderData.merchant.id) : null;
      let franchisee: LojaBrendi | null = null;

      // 1. Prioridade absoluta: a loja que possui exatamente o merchantId do pedido
      if (eventMerchantId) {
        franchisee = await lojaBrendiPorMerchantId(eventMerchantId);
      }

      // 2. Loja alvo do chamador — aceita se compatível com o merchant.id, OU
      //    se ela ainda não tem merchant nenhum (e aí aprende o dela).
      //
      // ── POR QUE O "ainda não tem" IMPORTA: A SEGUNDA LOJA ─────────────────
      //
      // `targetFranchiseeId` é a loja cujo PRÓPRIO feed produziu este evento —
      // o cron e o poll do painel buscam loja a loja, autenticados com a
      // credencial de cada uma, então um evento vindo do feed da loja B só
      // pode ser da loja B. É evidência mais forte que a comparação de id.
      //
      // Sem o segundo ramo, a segunda loja a conectar NUNCA recebia pedido: ela
      // nasce sem `brendiMerchantId`, a comparação com o merchant do pedido dá
      // falso, e o fallback do passo 3 recusa porque já há 2+ conectadas. E não
      // era um tropeço só no primeiro pedido — como ela nunca aprendia o
      // merchant, TODO pedido dela seria recusado, para sempre, com a loja
      // aparecendo "conectada" na tela. Exatamente o cenário que começa no dia
      // em que o segundo cliente ligar a integração.
      if (!franchisee && targetFranchiseeId) {
        const candidata = await lojaBrendiPorId(targetFranchiseeId);
        const compativel = candidata && (!eventMerchantId || candidata.brendiMerchantId === eventMerchantId);
        const semMerchantAinda = candidata && !candidata.brendiMerchantId && !!eventMerchantId;
        if (compativel || semMerchantAinda) {
          franchisee = candidata;
          if (semMerchantAinda) {
            await adotarMerchantId(candidata!.id, eventMerchantId!);
            candidata!.brendiMerchantId = eventMerchantId!;
            console.log(`[Brendi] ${orderId}: loja ${candidata!.id} aprendeu o merchant pelo próprio feed`);
          }
        }
      }

      // 3. Fallback do sistema de UMA loja: sem ambiguidade possível.
      //    Com 2+ conectadas a recusa é proposital — pedido na cozinha errada
      //    é pior que pedido recusado com log (o evento fica na fila).
      if (!franchisee) {
        const conectadas = await lojasBrendiConectadas();
        if (conectadas.length === 1) {
          franchisee = conectadas[0];
          console.warn(
            `[Brendi] ⚠️ ${orderId}: merchant ${eventMerchantId || "N/A"} sem loja correspondente — usando a ÚNICA loja conectada (${franchisee.id})`
          );
          // ── E APRENDE O MERCHANT ID AQUI ────────────────────────────────
          //
          // O suporte da Brendi (05/09/2026): o `merchant.id` "é um
          // identificador interno da BRENDI pro restaurante", não tem relação
          // com o Client ID, o endpoint `/v1/merchants` não é público e o
          // painel não o exibe. A orientação foi textual: "armazene o
          // merchant.id que vier na resposta dos pedidos".
          //
          // Este é o único momento em que dá para aprendê-lo com segurança:
          // há exatamente UMA loja conectada, então o pedido só pode ser dela.
          // A partir daqui a resolução é estrita e o fallback deixa de ser
          // necessário — que é o que faz a segunda loja poder conectar sem
          // pedido nenhum cair na cozinha errada.
          if (eventMerchantId && !franchisee.brendiMerchantId) {
            await adotarMerchantId(franchisee.id, eventMerchantId);
            franchisee.brendiMerchantId = eventMerchantId;
          }
        } else if (conectadas.length > 1) {
          const msg = `merchant ${eventMerchantId || "N/A"} não bate com nenhuma loja e há ${conectadas.length}+ conectadas — recusado para não adivinhar a dona`;
          console.error(`[Brendi] ❌ ${orderId}: ${msg}`);
          // A recusa é proposital e estável: reenviar traz a mesma recusa.
          return { action: "error", orderId, message: msg, reenviarAdianta: false };
        }
      }

      if (!franchisee) {
        const msg = `Nenhuma loja com merchantId correspondente (merchant: ${eventMerchantId || "N/A"})`;
        console.error(`[Brendi] ❌ ${orderId}: ${msg}`);
        // Pedido de restaurante que não é cliente nosso, ou merchantId ainda
        // não preenchido na tela de Integrações. Reenvio não muda nenhum dos dois.
        return { action: "error", orderId, message: msg, reenviarAdianta: false };
      }

      const franchiseeIdToUse = franchisee.ownerId || franchisee.id;

      // ── 2ª barreira de idempotência: pelo NÚMERO do pedido na Brendi ──────
      // O evento do feed traz só o UUID. O número que o lojista vê (displayId)
      // aparece agora, no corpo do pedido — e é por ele que casam os pedidos
      // que entraram por outro caminho: import manual ou resgate de um pedido
      // que o feed não entregou. Sem esta checagem o mesmo pedido vai duas
      // vezes para a cozinha. (Pulada no apenasPrever: prever não grava nada.)
      const displayIdReal = orderData.displayId ?? orderData.orderSeqNumber ?? null;
      if (displayIdReal && !apenasPrever) {
        const jaImportado = await prisma.customerOrder.findFirst({
          where: {
            franchiseeId: franchiseeIdToUse,
            openDeliveryChannel: "BRENDI",
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
          console.log(`[Brendi] ℹ️ ${orderId} já existe como #${jaImportado.dailyOrderNumber} (entrou por outro caminho) — não duplicado`);
          return { action: "updated", orderId, message: `já existia como #${jaImportado.dailyOrderNumber}; UUID vinculado` };
        }
      }

      // Helper: extrai valor numérico de preço — a Brendi (Open Delivery) pode
      // mandar número puro OU objeto {value, currency}; tratar os dois é o que
      // impede total zero silencioso.
      const priceVal = (p: any): number => typeof p === "object" && p !== null ? (p.value ?? 0) : (p ?? 0);

      // Helper: extrai recursivamente todas as opções / subitens / sabores /
      // adições de um item — os originadores Open Delivery variam o nome do
      // array entre versões, então aceitamos todos os formatos conhecidos.
      const extractBrendiOptions = (item: any): any[] => {
        if (!item || typeof item !== "object") return [];
        const rawList =
          (Array.isArray(item.options) && item.options.length > 0 ? item.options : null) ??
          (Array.isArray(item.subItems) && item.subItems.length > 0 ? item.subItems : null) ??
          (Array.isArray(item.sub_items) && item.sub_items.length > 0 ? item.sub_items : null) ??
          (Array.isArray(item.garnishItems) && item.garnishItems.length > 0 ? item.garnishItems : null) ??
          (Array.isArray(item.choices) && item.choices.length > 0 ? item.choices : null) ??
          (Array.isArray(item.items) && item.items.length > 0 ? item.items : null) ??
          (Array.isArray(item.additions) && item.additions.length > 0 ? item.additions : null) ??
          (Array.isArray(item.customizations) && item.customizations.length > 0 ? item.customizations : null) ??
          (Array.isArray(item.toppings) && item.toppings.length > 0 ? item.toppings : null) ??
          [];

        const extracted: any[] = [];
        for (const o of rawList) {
          const nested = extractBrendiOptions(o);
          if (nested.length > 0) {
            extracted.push(...nested);
          } else {
            const name = o.name || o.productName || o.label || o.optionName || o.description || o.nameOption || "";
            if (name) {
              extracted.push({
                id: o.id || `opt-${Math.random().toString(36).slice(2)}`,
                name,
                quantity: o.quantity ?? o.qty ?? 1,
                price: priceVal(o.unitPrice) || priceVal(o.price) || priceVal(o.totalPrice) || priceVal(o.addition) || 0,
              });
            }
          }
        }
        return extracted;
      };

      // Itens — suporte a todos os formatos de payload do Open Delivery
      const rawItemsList = (
        (Array.isArray(orderData.items) && orderData.items.length > 0 ? orderData.items : null) ??
        (Array.isArray(orderData.orderItems) && orderData.orderItems.length > 0 ? orderData.orderItems : null) ??
        (Array.isArray(orderData.order?.items) && orderData.order?.items.length > 0 ? orderData.order?.items : null) ??
        (Array.isArray(orderData.products) && orderData.products.length > 0 ? orderData.products : null) ??
        (Array.isArray(orderData.cart?.items) && orderData.cart?.items.length > 0 ? orderData.cart?.items : null) ??
        []
      );

      const items = rawItemsList.map((i: any) => {
        const itemName = i.name || i.productName || i.title || i.label || "Item Brendi";
        const options = extractBrendiOptions(i);
        const optionNames = options.map((o: any) => `${o.quantity > 1 ? o.quantity + 'x ' : ''}${o.name}`);
        const fullName = optionNames.length > 0
          ? `${itemName} | ${optionNames.join(" | ")}`
          : itemName;
        const qty = i.quantity ?? i.qty ?? 1;
        const rawUnit = priceVal(i.unitPrice) || priceVal(i.price) || 0;
        const rawTotal = priceVal(i.totalPrice) || priceVal(i.total) || 0;

        // Preço do item:
        // 1. Se totalPrice disponível → usar direto (já inclui opções pagas)
        // 2. Senão, calcular: unitPrice base + soma de opções que são ADIÇÕES
        let itemPrice = 0;
        if (rawTotal > 0 && qty > 0) {
          // totalPrice no Open Delivery já inclui tudo (base + opções cobradas)
          itemPrice = rawTotal / qty;
        } else if (rawUnit > 0) {
          // Sem totalPrice — somar manualmente apenas adições
          const additionsSum = options.reduce(
            (sum: number, o: any) => sum + (priceVal(o.addition) || 0) * (o.quantity || 1),
            0
          );
          itemPrice = rawUnit + additionsSum;
        } else {
          // Fallback: usar soma de opções como preço total
          const optionsSum = options.reduce(
            (sum: number, o: any) => sum + (priceVal(o.price) || priceVal(o.addition) || priceVal(o.unitPrice) || 0) * (o.quantity || 1),
            0
          );
          itemPrice = optionsSum;
        }

        const comboSelsList = options.length > 0 ? options.map((o: any) => ({
          id: o.id,
          name: o.name,
          quantity: o.quantity ?? 1,
          price: priceVal(o.price) || 0,
        })) : null;

        const comboSelectionsJson = comboSelsList ? JSON.stringify(comboSelsList) : null;
        const itemId = i.id || i.externalId || `item-${Math.random().toString(36).slice(2)}`;

        return {
          price: Math.round(itemPrice * 100) / 100,
          quantity: qty,
          productName: fullName,
          comboSelections: comboSelectionsJson,
          menuProduct: {
            // Produto fantasma: existe só para a comanda/relatório referenciar;
            // active:false para nunca aparecer no cardápio da loja.
            connectOrCreate: {
              where: { id: `brendi-${itemId}` } as any,
              create: {
                id: `brendi-${itemId}`,
                franchiseeId: franchisee!.id,
                name: fullName,
                description: i.specialInstructions || i.observations || i.notes || "",
                price: itemPrice,
                category: i.category || "Brendi",
                isBeverage: isBeverageName(fullName) || options.some((o: any) => isBeverageName(o.name)),
                active: false,
              } as any,
            } as any,
          },
        };
      });

      // Totais — aceita número puro ou objetos {value, currency}
      const rawTotal = orderData.total?.orderAmount ?? orderData.total?.subTotal ?? orderData.totalPrice ?? orderData.total;
      const total = priceVal(rawTotal);

      // Taxa de entrega — total.deliveryFee ou array otherFees
      let deliveryFeeValue = priceVal(orderData.total?.deliveryFee) || priceVal(orderData.delivery?.deliveryFee) || priceVal(orderData.deliveryFee) || 0;
      if (!deliveryFeeValue && Array.isArray(orderData.otherFees)) {
        const delFee = orderData.otherFees.find((f: any) =>
          (f.type || f.name || "").toUpperCase().includes("DELIVERY") ||
          (f.type || f.name || "").toUpperCase().includes("FRETE") ||
          (f.type || f.name || "").toUpperCase().includes("FEE")
        );
        if (delFee) deliveryFeeValue = priceVal(delFee.price ?? delFee.value);
      }

      // Descontos/benefits (padrão Open Delivery completo)
      const benefits = orderData.benefits ?? [];
      let discountPlatform = 0, discountMerchant = 0, discountTotal = 0;
      const discountDetails: any[] = [];
      for (const benefit of benefits) {
        const value = priceVal(benefit.value);
        discountTotal += value;
        const sponsorships = Array.isArray(benefit.sponsorshipValues)
          ? benefit.sponsorshipValues
          : benefit.sponsorshipValues ? [benefit.sponsorshipValues] : [];
        let bPlatform = 0, bMerchant = 0;
        for (const sp of sponsorships) {
          const spName = (sp.name ?? sp.sponsorship ?? "").toUpperCase();
          const spValue = priceVal(sp.value);
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
      // Lição do JotaJá (verificada contra a API real em 23/08/2026): o
      // originador aplica o cupom, manda o total já abatido, e nem sempre
      // preenche `benefits` — o desconto pode vir em `total.discount`. Sem esta
      // dedução a comanda mostrava um total menor que a soma dos itens, sem
      // linha explicando, e caixa/cozinha viam "sumir" dinheiro. Primeiro
      // procuramos o desconto nos campos conhecidos; se não houver, deduzimos
      // pela aritmética (itens + taxa − total), que independe do formato.
      const cupomCodigo: string | null =
        orderData.coupon?.code ?? orderData.cupom?.codigo ?? orderData.voucher?.code ?? orderData.promoCode ?? null;

      if (discountTotal === 0) {
        const descontoDoPayload = priceVal(orderData.total?.discount);
        const somaItens = priceVal(orderData.total?.itemsPrice) ||
          items.reduce((s: number, it: any) => s + (it.price || 0) * (it.quantity || 1), 0);

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
              : `Cupom Brendi${pct > 0 ? ` (-${pct}%)` : ""}`,
          });
        }
      } else if (cupomCodigo && discountDetails.length > 0 && !discountDetails[0].description) {
        discountDetails[0].description = `Cupom ${String(cupomCodigo).toUpperCase()}`;
      }

      // Se a taxa de entrega ainda veio 0 em pedido DELIVERY, deduz pela
      // diferença entre total e subtotal (mesma aritmética defensiva do JotaJá)
      if (deliveryFeeValue === 0 && (orderData.total?.orderAmount || orderData.totalPrice) && orderData.total?.subTotal) {
        const orderTotal = priceVal(orderData.total?.orderAmount ?? orderData.totalPrice);
        const subTotal = priceVal(orderData.total?.subTotal);
        const benefitsValue = discountTotal || 0;
        const calcFee = orderTotal - subTotal + benefitsValue;
        if (calcFee > 0 && calcFee < 100) {
          deliveryFeeValue = Math.round(calcFee * 100) / 100;
        }
      }

      // Data de entrega / prazo limite
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
        // Pedido imediato: retirada 40min, entrega 50min — a menos que o
        // payload traga um prazo explícito e plausível (>5min da criação)
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

      // Pagamento — errar aqui cobra o cliente 2x, por isso o parser é central
      // e compartilhado. O union do payment-parser ganha 'BRENDI' em mudança
      // paralela; o cast mantém este arquivo compilável em qualquer ordem de
      // merge sem afetar o runtime.
      const { parseOrderPaymentInfo } = await import("@/lib/payment-parser");
      const parsedPay = parseOrderPaymentInfo(orderData, "BRENDI" as any);
      const resolvedPaymentMethod = parsedPay.paymentMethod;
      const changeAmount = parsedPay.changeAmount;

      const customerCpfCnpj = orderData.customer?.taxPayerIdentificationNumber ?? orderData.customer?.documentNumber ?? null;

      // Cliente — derruba máscaras de privacidade antes de qualquer uso
      const customerName = derrubarMascaraPrivacidade(orderData.customer?.name) || "Cliente Brendi";
      const phone = orderData.customer?.phone;
      const phoneNumber = derrubarMascaraPrivacidade(phone?.number ?? (typeof phone === "string" ? phone : ""));
      const phoneLocalizer = phone?.localizer;

      // Notas — observações do cliente em destaque
      const customerNote = orderData.extraInfo ?? orderData.delivery?.observations ?? orderData.customer?.customerNote ?? null;

      // Observações por item
      const itemNotes = rawItemsList
        .filter((i: any) => i.specialInstructions?.trim())
        .map((i: any) => `${i.name || i.productName || 'Item'}: ${i.specialInstructions.trim()}`);

      const fusoDaLojaAlvo = await fusoDaLoja(franchiseeIdToUse);
      const notesArr = [
        `Pedido Brendi #${String(displayIdReal ?? orderId.slice(-6)).toUpperCase()}`,
        (scheduledDatetime && isExplicitScheduled) ? `📅 AGENDADO para ${dataHoraDaLoja(scheduledDatetime, fusoDaLojaAlvo)}` : null,
        discountTotal > 0
          ? `🏷️ ${discountDetails[0]?.description || "Desconto"}: -R$${discountTotal.toFixed(2)}` +
            (discountPlatform > 0 ? ` (Plataforma: R$${discountPlatform.toFixed(2)} | Loja: R$${discountMerchant.toFixed(2)})` : "")
          : null,
        customerNote ? `📝 OBS: ${customerNote}` : null,
        ...itemNotes.map((n: string) => `📝 ${n}`),
      ].filter(Boolean).join("\n");

      // Status inicial — mapa evento→status da tabela do blueprint
      let initialStatus = "NOVO";
      if (isConfirmed)        initialStatus = "ACEITO";
      else if (isPreparing)   initialStatus = "PREPARANDO";
      else if (isReadyPickup) initialStatus = "PRONTO";
      else if (isDispatched)  initialStatus = "SAIU_ENTREGA";
      else if (isDelivered)   initialStatus = "ENTREGUE";
      else if (isCancelled)   initialStatus = "CANCELADO"; // só alcançável no apenasPrever

      // Quem entrega — condiciona o envio futuro de dispatch/delivered
      // (se a logística é da Brendi, não é a loja quem "entregou")
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
        dByRaw.includes("BRENDI")
      ) ? "BRENDI" : "MERCHANT";

      const pickupCode = (
        orderData.delivery?.pickupCode ||
        orderData.pickupCode ||
        orderData.driver?.pickupCode ||
        orderData.logistics?.pickupCode ||
        null
      )?.toString().trim() || null;

      const customerAddress = (() => {
        const addr = orderData.delivery?.deliveryAddress;
        if (!addr) return "";
        // ── OS NOMES QUE A BRENDI USA DE VERDADE ──────────────────────────
        //
        // Estes campos vinham da spec Open Delivery (`streetName`,
        // `streetNumber`, `neighborhood`). O payload real, medido no pedido
        // B-6002 da sandbox em 05/09/2026, usa `street`, `number` e
        // `district`. Nenhum casava: o endereço caía inteiro no
        // `formattedAddress` e a comanda do motoboy saía SEM BAIRRO e SEM
        // COMPLEMENTO — que é justamente o que ele precisa para achar a porta.
        // Os dois conjuntos ficam aceitos: quebrar o JotaJá para consertar a
        // Brendi seria trocar um defeito por outro.
        const formatted = addr.formattedAddress || "";
        const via = addr.street || addr.streetName || "";
        const numero = addr.number || addr.streetNumber || "";
        const complemento = addr.complement || "";
        const bairro = addr.district || addr.neighborhood || "";
        const city = addr.city || "";

        const rua = via
          ? `${via}${numero ? `, ${numero}` : ""}${complemento ? ` - ${complemento}` : ""}`
          : formatted;

        const parts: string[] = [];
        if (rua) parts.push(rua);
        // Dedup: não repetir o bairro quando já veio embutido na rua formatada
        if (bairro && (!rua || !rua.toLowerCase().includes(bairro.toLowerCase()))) {
          parts.push(bairro);
        }
        if (city) parts.push(city);
        return parts.join(" - ");
      })();

      const deliveryType = (() => {
        // `type` é o campo REAL da Brendi ("DELIVERY" / "TAKEOUT"), confirmado
        // nos dois pedidos de teste. Antes a decisão dependia de `orderType`
        // (que nunca vem) e caía nos sinais indiretos abaixo — acertando por
        // sorte: TAKEOUT pelo objeto `takeout` presente, DELIVERY por ter
        // endereço formatado. Um pedido de entrega com taxa zero e endereço
        // só em `street` teria virado RETIRADA, e a comanda sairia sem
        // endereço nenhum.
        const tipoDireto = String(orderData.type || "").toUpperCase();
        if (tipoDireto === "DELIVERY") return "DELIVERY";
        if (tipoDireto === "TAKEOUT" || tipoDireto === "TOGO" || tipoDireto === "PICKUP") return "RETIRADA";

        const ot = (orderData.orderType || "").toUpperCase();
        const dm = (orderData.deliveryMode || orderData.takeoutMode || "").toUpperCase();
        const takeout =
          ot === "TAKEOUT" ||
          ot === "TOGO" ||
          ot === "PICKUP" ||
          ot === "RETIRADA" ||
          ot === "IN_STORE" ||
          Boolean(orderData.takeout) ||
          (dm !== "" && dm !== "DELIVERY") ||
          (!orderData.delivery?.deliveryAddress?.streetName && !orderData.delivery?.deliveryAddress?.formattedAddress && deliveryFeeValue === 0);
        return takeout ? "RETIRADA" : "DELIVERY";
      })();

      // ── MODO PREVISÃO: devolve tradução + payload cru SEM gravar ─────────
      // Sem dailyOrderNumber de propósito: gerar número aqui queimaria a
      // sequência do dia sem pedido correspondente (lição documentada em
      // order-number.ts — números 95 e 97 sumiram na Hakim Centro).
      if (apenasPrever) {
        const traduzido = {
          franchiseeId: franchiseeIdToUse,
          dailyOrderNumber: null,
          source: "BRENDI",
          openDeliveryChannel: "BRENDI",
          openDeliveryOrderId: orderId,
          openDeliveryReference: displayIdReal != null ? String(displayIdReal) : null,
          status: initialStatus,
          customerName,
          customerPhone: phoneLocalizer ? `${phoneNumber} ID: ${phoneLocalizer}` : phoneNumber,
          customerAddress,
          customerCpfCnpj,
          deliveryType,
          deliveryBy,
          pickupCode,
          paymentMethod: resolvedPaymentMethod,
          changeAmount,
          totalAmount: Math.round(total * 100) / 100,
          deliveryFee: Math.round(deliveryFeeValue * 100) / 100,
          discountTotal: discountTotal > 0 ? discountTotal : null,
          discountMerchant: discountMerchant > 0 ? discountMerchant : null,
          discountDetails: discountDetails.length > 0 ? discountDetails : null,
          scheduledDatetime,
          notes: notesArr || null,
          itens: items.map((it: any) => ({
            productName: it.productName,
            quantity: it.quantity,
            price: it.price,
            comboSelections: it.comboSelections,
          })),
        };
        return {
          action: "skipped",
          orderId,
          message: existing ? "apenasPrever (pedido JÁ existe no banco — criação seria deduplicada)" : "apenasPrever (nada gravado)",
          traduzido,
          cru: orderData,
        };
      }

      // REGRA DE OURO: gerar dailyOrderNumber sequencial — o pedido entra no
      // FINAL da fila sem mexer em nada existente
      const dailyOrderNumber = await generateDailyOrderNumber(franchiseeIdToUse);

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
              openDeliveryReference: displayIdReal != null ? String(displayIdReal) : undefined,
              openDeliveryChannel: "BRENDI",
              scheduledDatetime: scheduledDatetime ?? deliveryDeadline,
              changeAmount,
              customerCpfCnpj,
              deliveryBy,
              ifoodPickupCode: pickupCode ?? undefined,
              discountTotal: discountTotal > 0 ? discountTotal : null,
              discountMerchant: discountMerchant > 0 ? discountMerchant : null,
              discountDetails: discountDetails.length > 0 ? discountDetails : undefined,
              source: "BRENDI",
              customerName,
              customerPhone: phoneLocalizer ? `${phoneNumber} ID: ${phoneLocalizer}` : phoneNumber,
              customerAddress,
              deliveryType,
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
          // Não existia neste caminho. O único gatilho do sistema era a
          // TRANSIÇÃO para ACEITO, e o pedido importado já nasce no status
          // final — nunca transita. A ficha técnica do produto-espelho é
          // resolvida em src/lib/stock.ts pelo nome no cardápio. Idempotente
          // por `sourceRef`, e sem await para não segurar a importação.
          try {
            const criado = await prisma.customerOrder.findFirst({
              where: { franchiseeId: franchisee.id, openDeliveryOrderId: orderId } as any,
              select: { id: true },
              orderBy: { createdAt: "desc" },
            });
            if (criado) {
              const { deductStockForOrder } = await import("@/lib/stock");
              deductStockForOrder(criado.id).catch((e) =>
                console.error(`[Brendi] Baixa de estoque falhou para ${orderId}:`, e?.message)
              );
            }
          } catch (e: any) {
            console.error(`[Brendi] Não consegui disparar a baixa de ${orderId}:`, e?.message);
          }

          break; // Sucesso — sai do loop de retry
        } catch (createErr: any) {
          lastCreateError = createErr;
          // Unique constraint = pedido já existe (corrida entre webhook/cron/
          // dashboard chegando juntos) — é o resultado esperado, não erro real
          if (createErr?.code === "P2002") {
            console.log(`[Brendi] ℹ️ Pedido ${orderId} já existe (race condition detectada) — ok`);
            return { action: "skipped", orderId, message: "duplicata detectada via constraint" };
          }
          console.error(`[Brendi] ❌ Tentativa ${attempt}/3 de criar pedido ${orderId} FALHOU:`, createErr?.message);
          if (attempt < 3) {
            await new Promise(res => setTimeout(res, 2000)); // Espera 2s antes de retry
          }
        }
      }

      if (!createSuccess) {
        // FALLBACK: gravar dados mínimos como última barreira — nunca perder
        // venda. O sufixo _recovered mantém o UUID rastreável e a dupla
        // barreira de idempotência (startsWith) reconhece este registro.
        console.error(`[Brendi] 🚨 PEDIDO PERDIDO APÓS 3 TENTATIVAS — orderId=${orderId}, cliente=${customerName}, total=${total}`);
        try {
          // Gerar novo número sequencial para o fallback (pode ter mudado desde o primeiro try)
          const recoveryDailyNumber = await generateDailyOrderNumber(franchiseeIdToUse);
          await (prisma.customerOrder as any).create({
            data: {
              franchiseeId: franchiseeIdToUse,
              dailyOrderNumber: recoveryDailyNumber,
              kdsStage: "PRODUCTION",
              kdsProductionAt: new Date(),
              openDeliveryOrderId: `${orderId}_recovered`,
              openDeliveryReference: displayIdReal != null ? String(displayIdReal) : undefined,
              openDeliveryChannel: "BRENDI",
              source: "BRENDI",
              customerName: `${customerName} (RECUPERADO)`,
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
                      where: { id: `brendi-recovered-${orderId}` } as any,
                      create: {
                        id: `brendi-recovered-${orderId}`,
                        franchiseeId: franchiseeIdToUse,
                        name: `Pedido Brendi #${displayIdReal || orderId.slice(-6)} (verificar itens)`,
                        description: "Pedido recuperado automaticamente",
                        price: total,
                        category: "Brendi",
                        active: true,
                      } as any,
                    } as any,
                  },
                }],
              },
            },
          });
          console.log(`[Brendi] 🛟 Pedido ${orderId} RECUPERADO com dados mínimos!`);
          return { action: "created", orderId, message: `RECUPERADO com dados mínimos após falha: ${lastCreateError?.message}` };
        } catch (fallbackErr: any) {
          console.error(`[Brendi] 🚨🚨 FALHA TOTAL — nem o fallback funcionou para ${orderId}:`, fallbackErr?.message);
          return { action: "error", orderId, message: `FALHA TOTAL: ${lastCreateError?.message}` };
        }
      }

      // ── QUAIS AVISOS ESTE PEDIDO ESPERA DE VOLTA ─────────────────────────
      //
      // O pedido diz, ele mesmo, quais chamadas de status a loja deve mandar:
      // `sendPreparing`, `sendDelivered`, `sendPickedUp`, `sendTracking`.
      // Guardar isso é o que permite `brendi-status.ts` parar de adivinhar o
      // `delivered` por `deliveryBy` (ver lib/brendi-status.ts).
      //
      // SQL cru porque `brendiSendFlags` é garantida no boot e ainda não está
      // no schema.prisma — regra da casa. E fora do caminho crítico: pedido
      // gravado sem as flags cai no comportamento antigo, que é seguro.
      await gravarSendFlags(orderId, orderData);

      // Auto-confirmar pedidos CREATED — originadores Open Delivery cancelam
      // pedido não confirmado dentro do SLA deles. Falha aqui não é crítica:
      // o Auto-aceitar do dashboard (NOVO→ACEITO via PUT /status) propaga o
      // confirm de novo pelo sincronizarBrendi.
      if (isCreated) {
        try {
          await confirmarPedidoBrendi(orderId, franchisee.id);
        } catch { /* não crítico */ }
      }

      // Auto-enfileira impressão térmica para novos pedidos da Brendi
      try {
        const fullOrder = await prisma.customerOrder.findFirst({
          where: { openDeliveryOrderId: orderId },
          include: {
            items: {
              include: { menuProduct: { select: { id: true, name: true, isBeverage: true } } }
            }
          }
        });
        if (fullOrder) {
          const { pushJobToPrintQueue } = await import("@/app/api/store/print-queue/route");
          pushJobToPrintQueue(franchisee.id, fullOrder, franchisee.storeName || "HAKIM RIO DAS OSTRAS");
        }
      } catch (printErr) {
        console.error("[Brendi] Erro ao enfileirar auto-impressão:", printErr);
      }

      return { action: "created", orderId, message: `status=${initialStatus}` };

    } else {
      // ── ATUALIZAR pedido existente (apenas AVANÇAR status, NUNCA retroceder) ─
      const FINAL_STATUSES = ["ENTREGUE", "ENCERRADO", "CANCELADO"];
      if (existing && FINAL_STATUSES.includes(existing.status)) {
        // CANCELLED por cima de status final (estorno) já foi tratado antes de
        // chegar aqui — o resto dos eventos não mexe em pedido finalizado.
        return { action: "skipped", orderId, message: `pedido já finalizado (${existing.status}) - mantido` };
      }

      let newStatus: string | null = null;
      if (isConfirmed)        newStatus = "ACEITO";
      else if (isPreparing)   newStatus = "PREPARANDO";
      else if (isReadyPickup) newStatus = "PRONTO";
      else if (isDispatched)  newStatus = "SAIU_ENTREGA";
      else if (isDelivered)   newStatus = "ENTREGUE";

      if (newStatus) {
        const STATUS_RANK: Record<string, number> = {
          NOVO: 0, ACEITO: 1, PREPARANDO: 2, PRONTO: 3, SAIU_ENTREGA: 4, ENTREGUE: 5, ENCERRADO: 5, CANCELADO: 5
        };
        const currentRank = STATUS_RANK[existing?.status || "NOVO"] || 0;
        const newRank = STATUS_RANK[newStatus] || 0;

        if (newRank >= currentRank) {
          const updateConditions: any[] = [
            { openDeliveryOrderId: orderId },
            { openDeliveryOrderId: { startsWith: `${orderId}_` } },
          ];
          if (targetFranchiseeId) {
            // O canal na condição por reference é obrigatório: sem ele o update
            // alcançava pedido de OUTRO canal com o mesmo número (reference não
            // é único no schema — lição da 1ª barreira).
            updateConditions.push({
              openDeliveryReference: orderId,
              franchiseeId: targetFranchiseeId,
              openDeliveryChannel: "BRENDI",
            });
          }
          await (prisma.customerOrder as any).updateMany({
            where: { OR: updateConditions } as any,
            data: { status: newStatus },
          });
          return { action: "updated", orderId, message: `→ ${newStatus}` };
        } else {
          return { action: "skipped", orderId, message: `ignorado regresso de status ${existing?.status} → ${newStatus}` };
        }
      }
      return { action: "skipped", orderId, message: "sem mudança de status" };
    }
  } catch (err: any) {
    console.error(`[Brendi] ❌ Exceção processando ${orderId}:`, err?.message, err?.stack?.split("\n")[1]?.trim());
    return { action: "error", orderId, message: err.message };
  }
}
