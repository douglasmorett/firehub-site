/**
 * lib/keeta/eventos.ts — um evento da Keeta (webhook ou polling) vira ação no FireHub.
 *
 * Devolve `confirmar: true` só quando é seguro dar ack (polling) / 204
 * (webhook): o pedido está gravado, ou o evento não precisa de nada. Pedido
 * que não gravou fica SEM ack e volta no próximo ciclo — a Keeta guarda o
 * evento por 4h10. Ack antes de gravar foi o pedido perdido para sempre do
 * JotaJá (23/08/2026).
 *
 * ── Por que o FireHub confirma na Keeta assim que grava ────────────────────
 *
 * Pedido não confirmado em 5 minutos é cancelado pela Keeta E a loja fica
 * fechada por um tempo (política da Keeta). O confirm sai na gravação, como na
 * Wabiz e na Brendi — é o "recebi". O status no FireHub continua seguindo o
 * aceite automático da loja (NOVO ou ACEITO); recusar depois é
 * `requestCancellation`, que a rota de status já manda.
 */
import { prisma } from "@/lib/prisma";
import { fusoDaLoja } from "@/lib/fuso-da-loja";
import { traduzirPedidoOpenDelivery, idDoPedidoNoBanco, type PedidoOD, type CanalOD } from "@/lib/open-delivery/traducao";
import { gravarPedidoOpenDelivery } from "@/lib/open-delivery/gravar";
import { guardarPayloadCru } from "@/lib/open-delivery/payload-cru";
import { buscarPedidoKeeta, decifrar, metadataDoEvento, acaoNoPedidoKeeta, type EventoKeeta } from "./api";
import { lojaDoMerchant } from "./lojas";
import { registrarAcaoPendente } from "./acoes-pendentes";
import { aceitaSozinhoAgora } from "@/lib/loja-sem-conexao-no-banco";

export const CANAL_KEETA: CanalOD = { chave: "KEETA", nome: "Keeta", prefixo: "keeta" };

export type ResultadoEvento = { confirmar: boolean; acao: string; mensagem?: string; pedidoId?: string };

/** Só avança: evento atrasado não leva pedido entregue de volta para "pronto". */
const RANK: Record<string, number> = { NOVO: 0, ACEITO: 1, PREPARANDO: 2, PRONTO: 3, SAIU_ENTREGA: 4, ENTREGUE: 5, CANCELADO: 9 };

/** Confirm só para pedido recente: depois de 5 min a Keeta já cancelou; mexer em fila velha é mexer na operação de outro. */
const JANELA_DO_CONFIRM_MS = 10 * 60_000;

const CAMPOS_CIFRADOS: Array<(p: any) => [any, string] | null> = [
  (p) => (p?.customer?.phone ? [p.customer.phone, "number"] : null),
  (p) => (p?.delivery?.deliveryAddress ? [p.delivery.deliveryAddress, "district"] : null),
  (p) => (p?.delivery?.deliveryAddress ? [p.delivery.deliveryAddress, "number"] : null),
  (p) => (p?.delivery?.deliveryAddress ? [p.delivery.deliveryAddress, "complement"] : null),
  (p) => (p?.delivery?.deliveryAddress ? [p.delivery.deliveryAddress, "formattedAddress"] : null),
];

/** Troca os `ENC_` pelo texto, quando a Keeta decifra (só entrega da loja). */
async function decifrarPedido(pedido: any): Promise<void> {
  const alvos = CAMPOS_CIFRADOS.map((f) => f(pedido)).filter((x): x is [any, string] => !!x && typeof x[0][x[1]] === "string" && x[0][x[1]].startsWith("ENC_"));
  if (alvos.length === 0) return;
  const mapa = await decifrar(alvos.map(([obj, campo]) => obj[campo]));
  for (const [obj, campo] of alvos) {
    const claro = mapa.get(obj[campo]);
    if (claro !== undefined) obj[campo] = claro;
  }
}

async function pedidoNoBanco(orderId: string) {
  return prisma.customerOrder.findFirst({
    where: { openDeliveryOrderId: idDoPedidoNoBanco(CANAL_KEETA, orderId) } as any,
    select: { id: true, status: true, notes: true, cancelledBy: true, deliveryBy: true, franchiseeId: true } as any,
  }) as Promise<any>;
}

async function alertar(loja: string, detalhe: string) {
  import("@/lib/server-monitor")
    .then((m) => m.alertarFalhaDeIntegracao("Keeta", loja, detalhe))
    .catch(() => {});
}

/** Busca, decifra, traduz, grava e confirma. */
async function importarPedido(evento: EventoKeeta, merchantDoCabecalho?: string | null): Promise<ResultadoEvento> {
  const r = await buscarPedidoKeeta(evento.orderId);
  if (!r.ok) {
    if (r.status === 404) {
      // Id que a Keeta não reconhece nunca vai existir: segurar o evento só
      // repetiria a falha por 4 h.
      console.error(`[Keeta] ❌ pedido ${evento.orderId} não existe na Keeta (404) — evento ${evento.eventType} descartado`);
      return { confirmar: true, acao: "descartado", mensagem: "404 na Keeta" };
    }
    return { confirmar: false, acao: "erro", mensagem: `não consegui buscar o pedido: ${r.erro}` };
  }
  const pedido = r.dados as PedidoOD & { lastEvent?: string };
  const merchantId = String(pedido?.merchant?.id || "");

  if (merchantDoCabecalho && merchantDoCabecalho !== merchantId) {
    await guardarPayloadCru({ canal: "KEETA", tipo: "pedido", idNoParceiro: evento.orderId, payload: pedido, avisos: [`merchant do cabeçalho ${merchantDoCabecalho} ≠ do pedido ${merchantId}`] });
    console.error(`[Keeta] ❌ ${evento.orderId}: o webhook diz loja ${merchantDoCabecalho} e o pedido diz ${merchantId} — não gravado`);
    return { confirmar: false, acao: "recusado", mensagem: "loja do webhook diferente da loja do pedido" };
  }

  const loja = await lojaDoMerchant(merchantId);
  if (!loja) {
    // Sem vínculo ativo NÃO grava em loja nenhuma. Fica sem ack: se o vínculo
    // for feito nas próximas 4 h, o pedido entra no ciclo seguinte.
    await guardarPayloadCru({ canal: "KEETA", tipo: "pedido", idNoParceiro: evento.orderId, payload: pedido, avisos: [`merchant ${merchantId} sem vínculo ativo`] });
    await alertar(merchantId || "(sem merchant)", `pedido ${pedido?.displayId || evento.orderId} de loja sem vínculo ativo no FireHub`);
    return { confirmar: false, acao: "sem-loja", mensagem: `merchant ${merchantId} sem vínculo ativo` };
  }

  // Pedido que a Keeta já cancelou não entra na cozinha.
  if (String(pedido.lastEvent || "").toUpperCase() === "CANCELLED") {
    await guardarPayloadCru({ canal: "KEETA", tipo: "pedido", idNoParceiro: evento.orderId, franchiseeId: loja.franchiseeId, payload: pedido, avisos: ["já cancelado na Keeta — não gravado"] });
    return { confirmar: true, acao: "ja-cancelado" };
  }

  const entregaDaLoja = String(pedido?.delivery?.deliveredBy || "").toUpperCase() === "MERCHANT" || String(pedido?.type || "").toUpperCase() !== "DELIVERY";
  if (entregaDaLoja) await decifrarPedido(pedido);

  const dono = await prisma.user.findUnique({ where: { id: loja.franchiseeId }, select: { id: true, storeName: true, autoAcceptOrders: true } });
  if (!dono) return { confirmar: false, acao: "erro", mensagem: `loja ${loja.franchiseeId} não existe` };

  const traducao = traduzirPedidoOpenDelivery(pedido, {
    lojaId: dono.id,
    fuso: await fusoDaLoja(dono.id),
    // Loja SEM CONEXÃO: o pedido não nasce aceito (lib/loja-sem-conexao-no-banco.ts).
    autoAcceptOrders: await aceitaSozinhoAgora(dono),
    canal: CANAL_KEETA,
  });
  await guardarPayloadCru({ canal: "KEETA", tipo: "pedido", idNoParceiro: evento.orderId, franchiseeId: dono.id, payload: pedido, avisos: traducao.avisos });
  if (traducao.avisos.length > 0) console.warn(`[Keeta] ⚠️ ${pedido.displayId || evento.orderId}: ${traducao.avisos.join(" | ")}`);

  const gravado = await gravarPedidoOpenDelivery(traducao, "Keeta");
  if (gravado.action === "error") {
    await alertar(dono.storeName || dono.id, `#${pedido.displayId || evento.orderId}: ${gravado.message}`);
    return { confirmar: false, acao: "erro", mensagem: gravado.message };
  }

  // ── O "recebi" para a Keeta (prazo de 5 min) ────────────────────────────
  const criadoNaKeeta = new Date(String(pedido.createdAt || "")).getTime();
  const recente = Number.isFinite(criadoNaKeeta) ? Date.now() - criadoNaKeeta < JANELA_DO_CONFIRM_MS : true;
  const aindaNaoConfirmado = ["", "CREATED"].includes(String(pedido.lastEvent || "").toUpperCase());
  if (gravado.pedidoId && recente && aindaNaoConfirmado) {
    const numero = await prisma.customerOrder.findUnique({ where: { id: gravado.pedidoId }, select: { dailyOrderNumber: true } }).catch(() => null);
    const corpo = {
      reason: "Recebido pelo FireHub",
      createdAt: new Date().toISOString(),
      orderExternalCode: numero?.dailyOrderNumber ? `#${numero.dailyOrderNumber}` : gravado.pedidoId,
    };
    const c = await acaoNoPedidoKeeta(dono.id, "confirm", evento.orderId, corpo);
    if (!c.ok) {
      console.error(`[Keeta] ❌ confirm de ${pedido.displayId || evento.orderId} falhou: ${c.erro}`);
      if (c.repetir) await registrarAcaoPendente(idDoPedidoNoBanco(CANAL_KEETA, evento.orderId), "confirm", corpo, c.erro || "");
      await alertar(dono.storeName || dono.id, `#${pedido.displayId}: gravado, mas a Keeta recusou o confirm (${c.erro}). Confirme no Portal da Keeta em até 5 min.`);
    }
  }
  return { confirmar: true, acao: gravado.action, pedidoId: gravado.pedidoId };
}

function linhaNasNotas(notes: string | null | undefined, linha: string): string {
  const atual = String(notes || "");
  return atual.includes(linha) ? atual : [atual, linha].filter(Boolean).join("\n");
}

export async function processarEventoKeeta(evento: EventoKeeta, opts: { merchantDoCabecalho?: string | null } = {}): Promise<ResultadoEvento> {
  if (!evento?.orderId || !evento?.eventType) return { confirmar: true, acao: "ignorado", mensagem: "evento sem orderId/eventType" };
  const tipo = String(evento.eventType).toUpperCase();
  const meta = metadataDoEvento(evento);
  const existente = await pedidoNoBanco(evento.orderId);

  // ── Cancelado pela Keeta (cliente antes do aceite, timeout, sem entregador, suporte) ──
  if (tipo === "CANCELLED") {
    if (!existente) return { confirmar: true, acao: "ignorado", mensagem: "cancelado antes de entrar" };
    if (existente.status === "CANCELADO") return { confirmar: true, acao: "ja-cancelado" };
    const motivo = String(meta.cancelReason || meta.reason || "Cancelado pela Keeta");
    await (prisma.customerOrder as any).update({
      where: { id: existente.id },
      data: {
        status: "CANCELADO",
        cancelledAt: new Date(),
        cancelReason: motivo,
        // Quem cancelou primeiro foi a loja (requestCancellation) → continua LOJA,
        // senão o relatório culpa o canal errado (regra da Brendi).
        ...(existente.cancelledBy === "LOJA" ? {} : { cancelledBy: "KEETA" }),
        cancelDispute: { pending: false },
        notes: linhaNasNotas(existente.notes, `❌ Cancelado na Keeta: ${motivo}`),
      },
    });
    import("@/lib/fiscal-automatico").then((m) => m.alertarCancelamentoComNota({ id: existente.id }, "Keeta")).catch(() => {});
    return { confirmar: true, acao: "cancelado", pedidoId: existente.id };
  }

  // ── Reembolso: a loja responde no Portal da Keeta (tela no FireHub ainda não existe) ──
  if (tipo === "USER_REFUND_REQUEST" || tipo === "REFUNDED" || tipo === "REFUND_FAILED") {
    if (existente) {
      const reais = Number(meta.money) > 0 ? ` R$ ${(Number(meta.money) / 100).toFixed(2)}` : ""; // metadata em CENTAVOS
      const linha =
        tipo === "USER_REFUND_REQUEST"
          ? `⚠️ Cliente pediu reembolso${reais} na Keeta (${meta.applyReason || "sem motivo"}) — responda no Portal da Keeta`
          : tipo === "REFUNDED"
          ? `↩️ Reembolso${reais} feito pela Keeta`
          : `✋ Reembolso recusado na Keeta`;
      await (prisma.customerOrder as any).update({ where: { id: existente.id }, data: { notes: linhaNasNotas(existente.notes, linha) } });
      console.log(`[Keeta] ${tipo} em ${evento.orderId}: ${linha}`);
    }
    return { confirmar: true, acao: tipo.toLowerCase() };
  }

  // Eventos que nós mesmos geramos ou que são só informativos.
  if (["CANCELLATION_REQUESTED", "CONFIRMED", "PICKUP_ONGOING", "RIDER_ARRIVED_AT_STORE", "RECOMMENDED_PREPARATION_START", "PICKED_UP"].includes(tipo)) {
    if (!existente && tipo === "CONFIRMED") return importarPedido(evento, opts.merchantDoCabecalho);
    return { confirmar: true, acao: "informativo" };
  }

  // ── Pedido novo (ou evento de pedido que perdemos o CREATED) ──────────────
  if (!existente) return importarPedido(evento, opts.merchantDoCabecalho);
  if (tipo === "CREATED") return { confirmar: true, acao: "exists", pedidoId: existente.id };

  // ── Avanço de status vindo da Keeta (só para frente) ─────────────────────
  const entregadorDaKeeta = String(existente.deliveryBy || "").toUpperCase() === "LOGISTICS";
  const alvo =
    tipo === "READY_FOR_PICKUP" ? "PRONTO"
    : tipo === "DISPATCHED" ? "SAIU_ENTREGA"
    : tipo === "ORDER_COLLECTED" && entregadorDaKeeta ? "SAIU_ENTREGA"
    : tipo === "DELIVERED" || tipo === "CONCLUDED" ? "ENTREGUE"
    : null;
  if (!alvo) return { confirmar: true, acao: "informativo" };
  if ((RANK[existente.status] ?? 0) >= RANK[alvo]) return { confirmar: true, acao: "sem-mudanca" };
  await (prisma.customerOrder as any).update({ where: { id: existente.id }, data: { status: alvo } });
  return { confirmar: true, acao: `status-${alvo}`, pedidoId: existente.id };
}
