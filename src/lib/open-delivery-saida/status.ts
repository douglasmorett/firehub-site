/**
 * lib/open-delivery-saida/status.ts — a logística devolvendo o andamento.
 *
 * POST /v1/orders/{id}/readyForPickup | dispatch | delivered (corpo vazio). Cada
 * um faz o que o caminho do FireHub para a mesma etapa faz, só para pedido de
 * canal PRÓPRIO (o único que vai para a logística — `vaiParaALogistica`), então
 * não há parceiro (iFood, 99, Brendi...) para avisar:
 *
 *   readyForPickup → PRONTO        (nenhum aviso ao cliente: em entrega, o
 *                                    "pronto" é da loja; o aviso dele é o "saiu")
 *   dispatch       → SAIU_ENTREGA  (WhatsApp "saiu para entrega" — o botão
 *                                    "Saiu" do painel e o QR do motoboy)
 *   delivered      → ENTREGUE      (WhatsApp "chegou", faturamento, KDS
 *                                    encerrado — a baixa do app do motoboy)
 *
 * Em todos: NFC-e automática (lib/fiscal-automatico decide se é a hora) e, se o
 * pedido pulou o aceite (NOVO direto para pronto/saiu), a baixa de estoque que
 * o ACEITO faria — `deductStockForOrder` é idempotente.
 *
 * Escrita CONDICIONAL (updateMany com o status de partida), como o app do
 * motoboy: dois POSTs iguais, ou a logística e o painel ao mesmo tempo, mudam
 * uma vez só e os efeitos rodam uma vez só. Status não regride: "pronto" com o
 * pedido já na rua responde ok e não mexe em nada. Cancelado → 422.
 */
import { prisma } from "@/lib/prisma";
import { STATUS_ANTES_DE_SAIR, STATUS_CANCELADOS, STATUS_FINALIZADOS } from "@/lib/status-pedido";

export type AcaoDaLogistica = "readyForPickup" | "dispatch" | "delivered";

export const ACOES_DA_LOGISTICA: readonly string[] = ["readyForPickup", "dispatch", "delivered"];

/** O que a ação faz a partir do status atual (puro). */
export function planoDaAcao(
  acao: AcaoDaLogistica,
  statusAtual: string,
): { tipo: "mudar"; para: string; de: string[] } | { tipo: "nada" } | { tipo: "cancelado" } {
  const s = String(statusAtual || "").toUpperCase();
  if ((STATUS_CANCELADOS as readonly string[]).includes(s)) return { tipo: "cancelado" };
  const antes = [...STATUS_ANTES_DE_SAIR] as string[];
  if (acao === "readyForPickup") {
    const de = antes.filter((x) => x !== "PRONTO");
    return de.includes(s) ? { tipo: "mudar", para: "PRONTO", de } : { tipo: "nada" };
  }
  if (acao === "dispatch") {
    return antes.includes(s) ? { tipo: "mudar", para: "SAIU_ENTREGA", de: antes } : { tipo: "nada" };
  }
  // delivered: de qualquer status que ainda não fechou.
  if ((STATUS_FINALIZADOS as readonly string[]).includes(s)) return { tipo: "nada" };
  const de = [...antes, "SAIU_ENTREGA", "SAIU_PARA_ENTREGA", "EM_ROTA"];
  return de.includes(s) ? { tipo: "mudar", para: "ENTREGUE", de } : { tipo: "nada" };
}

export type ResultadoDaAcao = { ok: true; mudou: boolean; status: string } | { ok: false; status: 404 | 422; motivo: string };

export async function aplicarAcaoDaLogistica(
  pedido: { id: string; franchiseeId: string; status: string; acceptedAt?: Date | null; deliveryType?: string | null },
  acao: AcaoDaLogistica,
  parceiro: string,
): Promise<ResultadoDaAcao> {
  const plano = planoDaAcao(acao, pedido.status);
  if (plano.tipo === "cancelado") return { ok: false, status: 422, motivo: "Pedido cancelado." };
  if (plano.tipo === "nada") return { ok: true, mudou: false, status: pedido.status };

  const data: Record<string, unknown> = { status: plano.para };
  if (plano.para === "ENTREGUE") {
    data.kdsStage = "FINISHED";
    data.kdsStationId = null;
  }
  const escrita = await prisma.customerOrder.updateMany({
    where: { id: pedido.id, franchiseeId: pedido.franchiseeId, status: { in: plano.de } },
    data,
  });
  if (escrita.count === 0) {
    // Outro caminho mexeu no meio: relê e responde pelo que ficou.
    const agora = await prisma.customerOrder.findUnique({ where: { id: pedido.id }, select: { status: true } });
    if (agora && (STATUS_CANCELADOS as readonly string[]).includes(String(agora.status).toUpperCase())) {
      return { ok: false, status: 422, motivo: "Pedido cancelado." };
    }
    return { ok: true, mudou: false, status: agora?.status ?? pedido.status };
  }

  console.log(`[Open Delivery saída] ${parceiro} ${acao} ${pedido.id}: ${pedido.status} → ${plano.para}`);

  // ── Efeitos, em segundo plano (cada um falha sozinho e vira log) ──────────
  const id = pedido.id;
  void (async () => {
    if (!pedido.acceptedAt) {
      try {
        const { deductStockForOrder } = await import("@/lib/stock");
        await deductStockForOrder(id);
      } catch (e: any) {
        console.warn(`[Open Delivery saída] estoque ${id}:`, e?.message);
      }
    }
    try {
      const { sendOrderNotification } = await import("@/lib/order-notifications");
      if (plano.para === "SAIU_ENTREGA") sendOrderNotification(id, "SAIU_ENTREGA").catch(() => {});
      if (plano.para === "ENTREGUE") sendOrderNotification(id, "ENTREGUE").catch(() => {});
    } catch {}
    if (plano.para === "ENTREGUE") {
      try {
        const { trackSaleForBilling } = await import("@/lib/billing");
        trackSaleForBilling(pedido.franchiseeId).catch(() => {});
      } catch {}
    }
    try {
      const { emitirNfceAutomatica } = await import("@/lib/fiscal-automatico");
      emitirNfceAutomatica(id).catch(() => {});
    } catch {}
  })();

  return { ok: true, mudou: true, status: plano.para };
}
