/**
 * lib/food99-status-do-evento.ts — evento de status do 99Food (orderCancel,
 * orderFinish, confirmed…) aplicado num pedido que já existe.
 *
 * Saiu de dentro de api/99food/webhook para dar para testar sem o resto da
 * rota. Duas travas (auditoria de 23/10/2026, F67/F96):
 *
 *   - só pedido do 99Food (`openDeliveryChannel`): o update casava só pelo id,
 *     de qualquer canal;
 *   - evento sem assinatura (FOOD99_WEBHOOK_SECRET ainda não existe) relê o
 *     pedido no `order/detail` com o token da loja DONA antes de mexer nele
 *     (lib/evento-sem-assinatura.ts).
 */
import { prisma } from "@/lib/prisma";
import { buscarPedido99 } from "@/lib/food99-status";
import { aplicarEventoSemAssinatura, estadoDoPedido99, type Pretendido } from "@/lib/evento-sem-assinatura";

export async function aplicarStatusDoEvento99(
  orderId: string,
  newStatus: string,
  evento: string,
  conferirNaApi: boolean,
): Promise<{ aplicado: number; ignorado?: boolean }> {
  // ── Não ressuscitar pedido encerrado ────────────────────────────────────
  //
  // O 99Food reenvia evento quando não recebe o ACK em 6s, e reenvio não chega
  // na ordem original. Sem guarda, um `deliveryStatus` atrasado rebaixa para
  // SAIU_ENTREGA um pedido que já foi ENTREGUE, e a comanda volta para a tela
  // da cozinha depois de fechada. Pior: um `orderFinish` atrasado marcaria como
  // entregue um pedido que a loja cancelou.
  //
  // CANCELADO é a exceção e passa por cima de tudo: cancelamento depois da
  // entrega é estorno, e a loja precisa ficar sabendo.
  const where = {
    openDeliveryOrderId: orderId,
    openDeliveryChannel: "99FOOD",
    ...(newStatus === "CANCELADO" ? {} : { status: { notIn: ["ENTREGUE", "CANCELADO"] } }),
  };

  if (conferirNaApi) {
    const pedido: any = await (prisma.customerOrder as any).findFirst({
      where,
      select: { franchiseeId: true, food99AppShopId: true },
    });
    if (!pedido) return { aplicado: 0 };
    const aplica = await aplicarEventoSemAssinatura("99Food", orderId, evento, newStatus as Pretendido, async () => {
      const r = await buscarPedido99(pedido.franchiseeId, orderId, pedido.food99AppShopId);
      if (!r.ok) return { ok: false, motivo: `${r.errno} ${r.errmsg}` };
      return { ok: true, estado: estadoDoPedido99(r.data), bruto: r.data?.status ?? r.data?.order_status ?? null };
    });
    if (!aplica) return { aplicado: 0, ignorado: true };
  }

  const r = await (prisma.customerOrder as any).updateMany({ where, data: { status: newStatus } });
  const aplicado = r?.count ?? 0;
  // NFC-e: no avanço, lib/fiscal-momento decide se é a hora; no cancelamento, avisa na tela fiscal se havia nota (não trava).
  const doPedido = { openDeliveryOrderId: orderId, openDeliveryChannel: "99FOOD" };
  if (aplicado > 0) import("@/lib/fiscal-automatico").then(async (m) => { if (newStatus === "CANCELADO") await m.alertarCancelamentoComNota(doPedido, "99Food"); else await m.emitirNfceDosPedidos(doPedido); }).catch(() => {});
  return { aplicado };
}
