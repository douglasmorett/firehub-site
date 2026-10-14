/**
 * PEDIDO CANCELADO SÓ VIRA DESPERDÍCIO SE JÁ FOI PRODUZIDO
 *
 * Victor (Pizzaria 17, 14/10/2026), pelo Douglas: o CMV tem de ficar exato. A
 * pizza cancelada depois de sair do forno foi para o lixo — o insumo saiu e
 * é custo. A cancelada antes de alguém fazer não gastou nada: o insumo
 * continua na prateleira e não pode pesar no CMV.
 *
 * Até aqui o estoque não olhava isso: o cancelamento pelo painel devolvia
 * SEMPRE o que a baixa tirou (até a pizza que já tinha saído para entrega), e
 * o do iFood/99/Brendi/Keeta NUNCA devolvia (até o pedido que ninguém fez).
 *
 * Esta é a regra única, pura, lida pelo estoque (lib/stock.ts,
 * `tratarEstoqueDoCancelamento`), pelo DRE e pelo painel do CMV. Os campos são
 * os carimbos que o pedido já tem, gravados em qualquer caminho (extensão do
 * Prisma em lib/prisma.ts e o KDS em api/kds) — o pedido de integração segue a
 * mesma regra pelos mesmos campos.
 *
 *   1. SAIU PARA ENTREGA: `dispatchedAt` (status SAIU_ENTREGA) ou `deliveredAt`.
 *   2. FINALIZADO: o KDS deu o pedido por pronto (`kdsFinishedAt`, `kdsStage`
 *      FINISHED) ou o painel marcou PRONTO (`readyAt`). Na retirada o
 *      finish_order já vira SAIU_ENTREGA, que cai no item 1.
 *   3. SAIU DA TELA DE PRODUÇÃO: a produção do KDS deu baixa em algum item
 *      (`CustomerOrderItem.prontoEm`) — é a baixa da produção que leva o
 *      pedido para a finalização (`kdsStage` FINISHING). O desfazer do KDS
 *      apaga o `prontoEm`, então pedido desfeito volta a "não foi feito".
 *
 * O pedido é um só: com duas telas de produção (pizza e esfiha), basta uma
 * ter dado baixa para o pedido contar como produzido. Separar item a item não
 * dá: a baixa de estoque é por (pedido, insumo), não por item.
 *
 * Carimbo DEPOIS do cancelamento não conta (a ordem é o que a regra pergunta):
 * só um pedido reaberto ganha carimbo novo, e aí ele não está cancelado.
 */
import { STATUS_CANCELADOS } from "@/lib/status-pedido";

type Instante = Date | string | null | undefined;

export type PedidoParaDesperdicio = {
  status?: string | null;
  cancelledAt?: Instante;
  dispatchedAt?: Instante;
  deliveredAt?: Instante;
  readyAt?: Instante;
  kdsFinishedAt?: Instante;
  kdsStage?: string | null;
  items?: { prontoEm?: Instante }[] | null;
};

/** Até onde o pedido chegou antes de ser cancelado. Nulo = não foi feito. */
export type EtapaDoDesperdicio = "SAIU_PARA_ENTREGA" | "FINALIZADO" | "PRODUZIDO";

export const ROTULO_DA_ETAPA: Record<EtapaDoDesperdicio, string> = {
  SAIU_PARA_ENTREGA: "já tinha saído para entrega",
  FINALIZADO: "já estava pronto (finalizado)",
  PRODUZIDO: "já tinha saído da tela de produção",
};

const ms = (v: Instante): number | null => {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
};

/** Os carimbos chegam por caminhos diferentes no mesmo segundo: 1 min de folga. */
const FOLGA_MS = 60_000;

export function ehPedidoCancelado(status: string | null | undefined): boolean {
  return (STATUS_CANCELADOS as readonly string[]).includes(String(status || "").toUpperCase());
}

/**
 * Até onde o pedido chegou antes do cancelamento, ou null se ele foi cancelado
 * antes de sair da produção. Não confere o status: serve também para o pedido
 * que acabou de ser cancelado e ainda está sendo lido.
 */
export function etapaAntesDoCancelamento(p: PedidoParaDesperdicio): EtapaDoDesperdicio | null {
  const cancelou = ms(p.cancelledAt);
  const antes = (v: Instante) => {
    const t = ms(v);
    if (t == null) return false;
    return cancelou == null || t <= cancelou + FOLGA_MS;
  };

  if (antes(p.dispatchedAt) || antes(p.deliveredAt)) return "SAIU_PARA_ENTREGA";

  const estagio = String(p.kdsStage || "").toUpperCase();
  // `kdsStage` não tem hora: FINISHED só vale sem carimbo nenhum (pedido de
  // antes dos carimbos) — com `kdsFinishedAt`, é ele que diz quando.
  if (antes(p.kdsFinishedAt) || antes(p.readyAt) || (estagio === "FINISHED" && !p.kdsFinishedAt && !p.readyAt)) return "FINALIZADO";

  if ((p.items || []).some((i) => antes(i?.prontoEm))) return "PRODUZIDO";

  return null;
}

/**
 * O cancelado conta como desperdício (o insumo saiu e é custo)? Só se está
 * cancelado E foi cancelado depois de sair da produção.
 */
export function canceladoViraDesperdicio(p: PedidoParaDesperdicio): boolean {
  return ehPedidoCancelado(p.status) && etapaAntesDoCancelamento(p) != null;
}

// ── A marca na movimentação de estoque ────────────────────────────────────
//
// A baixa da venda (SALE) do pedido cancelado já produzido vira WASTE com esta
// marca na nota. É por ela que o reaberto volta a ser venda (lib/stock.ts) e
// que o painel do CMV separa este desperdício do lançado à mão.

export const marcaDoDesperdicio = (pedidoId: string) => `desperdicio id: ${pedidoId}`;

/** O id do pedido na nota de um WASTE de cancelado, ou null. */
export function pedidoDaMarca(notas: string | null | undefined): string | null {
  const m = String(notas || "").match(/desperdicio id: ([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}
