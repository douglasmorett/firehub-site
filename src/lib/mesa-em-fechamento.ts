/**
 * Mesa em fechamento: o cliente pediu a conta e a mesa está para vagar.
 *
 * Pedido da Ragnar (Fabiano, 09/10/2026): "quando solicitar a conta, que o
 * quadradinho da mesa mude de cor, para todo mundo saber que ela está em
 * fechamento" — com fila na porta, saber que três ou quatro mesas já estão
 * fechando é o que deixa a recepção segurar o cliente que espera. Livre é
 * verde, ocupada é vermelha, em fechamento é ROXA (combinado com ele).
 *
 * "Pedir a conta" no FireHub é imprimir a conta da mesa (POST
 * /api/store/table-sessions/[id]/imprimir-conta), que grava um PrintRequest
 * CONTA_DA_MESA com o tableSessionId. Não há coluna nova: a marca é esse
 * registro, e ela some sozinha quando a mesa fecha (só a sessão aberta conta).
 *
 * Se lançarem pedido DEPOIS da conta impressa, a mesa volta a ser só ocupada:
 * o papel que o cliente tem na mão já não é a conta, e quem pediu mais uma
 * cerveja não está saindo. Imprimir a conta de novo pinta de roxo outra vez.
 */
export function contaPedidaEm(
  ultimaContaImpressa: Date | string | null | undefined,
  pedidosDaMesa: { createdAt: Date | string; status?: string | null }[]
): string | null {
  if (!ultimaContaImpressa) return null;
  const conta = new Date(ultimaContaImpressa).getTime();
  if (!Number.isFinite(conta)) return null;
  const pedidoDepois = pedidosDaMesa.some((p) => {
    const s = p.status || "";
    if (s === "CANCELADO" || s === "CANCELED" || s === "CANCELLED") return false;
    return new Date(p.createdAt).getTime() > conta;
  });
  return pedidoDepois ? null : new Date(conta).toISOString();
}

/** As cores da mesa em fechamento, as mesmas nas duas telas de mesas. */
export const ROXO_DA_CONTA = {
  forte: "#7C3AED",
  fundo: "#F5F3FF",
  borda: "#C4B5FD",
  texto: "#6D28D9",
} as const;
