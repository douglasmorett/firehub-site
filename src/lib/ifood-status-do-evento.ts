/**
 * EVENTO DO IFOOD NUNCA LEVA O PEDIDO PARA TRÁS
 *
 * O FireHub fala com o iFood nos dois sentidos: o painel/KDS avisa o iFood
 * (readyToPickup, dispatch…) e o iFood devolve o evento daquela mudança pelo
 * webhook e pelo polling. O eco chega segundos depois — e o READY_TO_PICKUP
 * vira PREPARANDO aqui (o FireHub não tem "pronto" de delivery no status: o
 * pronto da cozinha mora no `kdsStage`).
 *
 * O cron e o webhook gravavam o status do evento por cima de qualquer coisa.
 * Então "Saiu" no painel → readyToPickup → eco RTP → PREPARANDO: o pedido
 * voltava para Em Produção, com o iFood mostrando pronto (Túlio Lanches,
 * 06/11/2026). Igual na retirada pronta no KDS (status SAIU_ENTREGA) e no
 * pedido ENTREGUE que o DISPATCHED atrasado devolvia para SAIU_ENTREGA. Em 7
 * dias, 1.355 de 3.301 pedidos do iFood tiveram o PREPARANDO regravado depois
 * do pronto — o que também reescrevia o `acceptedAt` dos relatórios.
 *
 * Só o painel de pedidos (api/customer-order/poll) tinha a trava. Agora as três
 * entradas usam a mesma ordem, a do CardápioWeb/Keeta: o evento só grava
 * status mais adiantado. CANCELADO é a exceção e passa sempre.
 */

const RANK_DO_FIREHUB: Record<string, number> = {
  NOVO: 0,
  ACEITO: 1,
  CONFIRMADO: 1,
  PREPARANDO: 2,
  EM_PREPARO: 2,
  PRONTO: 3,
  SAIU_ENTREGA: 4,
  SAIU_PARA_ENTREGA: 4,
  ENTREGUE: 5,
  ENCERRADO: 5,
  FINALIZADO: 5,
  CANCELADO: 9,
};

/**
 * O filtro do `updateMany` que grava `doEvento`: deixa de fora o pedido que já
 * está no mesmo passo ou adiante. Vai no WHERE, e não numa leitura antes,
 * porque o eco chega enquanto a rota de status ainda grava o clique da loja —
 * entre ler e gravar, o pedido pode ter andado.
 */
export function semRebaixar(doEvento: string): { status?: { notIn: string[] } } {
  if (doEvento === "CANCELADO") return {};
  const para = RANK_DO_FIREHUB[doEvento];
  if (para === undefined) return {};
  return { status: { notIn: Object.keys(RANK_DO_FIREHUB).filter((s) => RANK_DO_FIREHUB[s] >= para) } };
}
