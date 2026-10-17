/**
 * A gravação do "Entregue mesmo depois de cancelado" — a regra está em
 * lib/entregue-depois-de-cancelado.ts. Um caminho só para as três telas que
 * oferecem a ação: o detalhe do pedido no painel e a Conferência do motoboy
 * (api/store/orders/[id]/entregue-depois-de-cancelado), e o próprio motoboy no
 * app e na página web (api/motoboys/orders, PATCH).
 *
 * ── O que a gravação faz ───────────────────────────────────────────────────
 *
 *   1. Status ENTREGUE com a forma que a pessoa informou, numa escrita
 *      CONDICIONAL ("ainda cancelado"): dois toques, ou o motoboy e a loja ao
 *      mesmo tempo, gravam uma vez só — o segundo acha zero linhas.
 *   2. O estoque: `deductStockForOrder` (lib/stock.ts). O cancelado que já
 *      tinha sido produzido teve a baixa transformada em desperdício (WASTE);
 *      com o pedido fora do cancelado e `cancelledAt` gravado, a baixa volta a
 *      ser venda (SALE) e não baixa de novo. O cancelado antes da produção
 *      teve o insumo devolvido; a baixa vê a devolução e tira o insumo outra
 *      vez — a pizza foi feita e comida. Nos dois casos o insumo sai UMA vez.
 *
 * O resto do pedido de entregue (faturamento do ciclo, NFC-e automática) é de
 * quem chama, fora da resposta. O WhatsApp "seu pedido chegou" NÃO sai: o
 * cliente que cancelou recebeu o "pedido cancelado" e já está com a comida na
 * mão — mais uma mensagem só confunde.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { STATUS_CANCELADOS } from "@/lib/status-pedido";
import { empilharEdicao } from "@/lib/edicao-de-pedido";
import {
  foiEntregueDepoisDeCancelado,
  lerFormaDoEntregue,
  lerTrocoPara,
  podeMarcarEntregueDepoisDeCancelado,
  registroDoEntregueDepoisDeCancelado,
  type FormaDoEntregueDepoisDeCancelado,
} from "@/lib/entregue-depois-de-cancelado";

export type ResultadoDoEntregueDepoisDeCancelado =
  | {
      ok: true;
      /** Já estava marcado (segundo toque, ou a loja e o motoboy juntos). */
      jaEstava: boolean;
      pedido: { id: string; franchiseeId: string; dailyOrderNumber: number | null; motoboyId: string | null };
      forma: FormaDoEntregueDepoisDeCancelado | null;
    }
  | { ok: false; status: number; erro: string };

const CAMPOS = {
  id: true, franchiseeId: true, status: true, dailyOrderNumber: true, motoboyId: true,
  source: true, openDeliveryChannel: true, openDeliveryOrderId: true, ifoodOrderId: true, ifoodReference: true,
  tableSessionId: true, deliveryType: true,
  gatewayProvider: true, gatewayPaymentId: true, reposicao: true,
  cancelledAt: true, cancelReason: true, cancelledBy: true,
  totalAmount: true, paymentMethods: true, editHistory: true,
  franchisee: { select: { storeTimezone: true } },
} as const;

export async function marcarEntregueDepoisDeCancelado(opts: {
  pedidoId: string;
  /** As lojas de quem pede: o pedido tem de ser de uma delas. */
  lojaIds: string[];
  /** Pelo motoboy: só o pedido que está com ELE. */
  motoboyId?: string | null;
  forma: unknown;
  trocoPara?: unknown;
  /** Quem marcou, como vai no rastro: "Allan (dono)", "Motoboy João". */
  quem: string;
  agora?: Date;
}): Promise<ResultadoDoEntregueDepoisDeCancelado> {
  const forma = lerFormaDoEntregue(opts.forma);
  if (!forma) return { ok: false, status: 400, erro: "Escolha como o cliente pagou: Dinheiro, Cartão Crédito, Cartão Débito ou Pix." };

  const lojaIds = opts.lojaIds.filter(Boolean);
  if (!opts.pedidoId || lojaIds.length === 0) return { ok: false, status: 400, erro: "Pedido não informado." };

  const pedido = await prisma.customerOrder.findFirst({
    where: { id: opts.pedidoId, franchiseeId: { in: lojaIds }, ...(opts.motoboyId ? { motoboyId: opts.motoboyId } : {}) },
    select: CAMPOS,
  });
  if (!pedido) {
    return { ok: false, status: 404, erro: opts.motoboyId ? "Pedido não encontrado para este entregador nesta loja." : "Pedido não encontrado." };
  }
  const resumo = { id: pedido.id, franchiseeId: pedido.franchiseeId, dailyOrderNumber: pedido.dailyOrderNumber, motoboyId: pedido.motoboyId };

  // Segundo toque depois de gravado: responde como feito, sem gravar de novo.
  if (foiEntregueDepoisDeCancelado(pedido)) return { ok: true, jaEstava: true, pedido: resumo, forma: null };

  const avaliacao = podeMarcarEntregueDepoisDeCancelado(pedido);
  if (!avaliacao.pode) return { ok: false, status: 409, erro: avaliacao.motivo };

  const total = Number(pedido.totalAmount) || 0;
  const trocoPara = lerTrocoPara(forma, opts.trocoPara, total);
  const agora = opts.agora ?? new Date();
  const registro = registroDoEntregueDepoisDeCancelado({
    pedido, forma, trocoPara, quem: opts.quem, agora, tz: pedido.franchisee?.storeTimezone || "America/Sao_Paulo",
  });

  const escrita = await prisma.customerOrder.updateMany({
    where: { id: pedido.id, status: { in: [...STATUS_CANCELADOS] } },
    data: {
      status: "ENTREGUE",
      // A hora em que a loja (ou o motoboy) contou que entregou: a real não
      // se sabe, e é por ela que o app conta as "concluídas hoje".
      deliveredAt: agora,
      kdsStage: "FINISHED",
      kdsStationId: null,
      paymentMethod: forma,
      changeAmount: trocoPara,
      // Uma forma só, a que a pessoa acabou de dizer: divisão antiga sai.
      ...(pedido.paymentMethods != null ? { paymentMethods: Prisma.DbNull } : {}),
      editHistory: empilharEdicao(pedido.editHistory, registro) as unknown as Prisma.InputJsonValue,
      // `cancelledAt`, `cancelReason` e `cancelledBy` ficam: são o "foi
      // cancelado antes", e o `cancelledAt` é o que faz a baixa abaixo
      // desfazer o desperdício em vez de baixar de novo.
    },
  });
  if (escrita.count !== 1) {
    const agoraNoBanco = await prisma.customerOrder.findFirst({ where: { id: pedido.id }, select: { status: true, editHistory: true } });
    if (foiEntregueDepoisDeCancelado(agoraNoBanco)) return { ok: true, jaEstava: true, pedido: resumo, forma: null };
    return { ok: false, status: 409, erro: "O pedido mudou enquanto você marcava. Atualize a tela e confira." };
  }

  const { deductStockForOrder } = await import("@/lib/stock");
  await deductStockForOrder(pedido.id);

  console.log(`[Entregue depois de cancelado] pedido ${pedido.id} (#${pedido.dailyOrderNumber ?? "?"}) → ENTREGUE em ${forma} por ${registro.quem}`);
  return { ok: true, jaEstava: false, pedido: resumo, forma };
}

/**
 * Os efeitos de entregue que não seguram a resposta: o faturamento do ciclo
 * (como todo ENTREGUE em api/customer-order/status) e a NFC-e automática, se a
 * loja marcou esta forma (lib/fiscal-automatico decide; nota cancelada no
 * cancelamento não é reemitida sozinha).
 */
export function efeitosDoEntregueDepoisDeCancelado(pedidoId: string, lojaId: string) {
  import("@/lib/billing")
    .then(({ trackSaleForBilling }) => trackSaleForBilling(lojaId))
    .catch((e) => console.error("[Entregue depois de cancelado] faturamento do ciclo:", e?.message || e));
  import("@/lib/fiscal-automatico")
    .then(({ emitirNfceAutomatica }) => emitirNfceAutomatica(pedidoId))
    .catch((e) => console.error("[Entregue depois de cancelado] NFC-e automática:", e?.message || e));
}
