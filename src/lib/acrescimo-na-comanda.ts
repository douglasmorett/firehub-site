/**
 * /src/lib/acrescimo-na-comanda.ts
 *
 * O acréscimo de marketplace na COMANDA: um papel só, com o pedido inteiro.
 *
 * No banco o acréscimo continua sendo um pedido colado (`parentOrderId`) — o
 * pedido do iFood/Brendi tem que continuar valendo o repasse, e o que o
 * cliente paga à parte passa pelo caixa como venda da loja (ver
 * api/store/orders/[id]/itens). Na COZINHA, não: é o mesmo pedido.
 *
 * ── O caso (Frangoso, 30/09 e 02/10/2026) ───────────────────────────────────
 *
 * "Pedido 10, o cara pediu uma lata; agora quer outra." Saía a 2a via do 10
 * (sem a lata nova) e um "pedido 11" só com a lata, como se fosse venda nova.
 * Na hora de juntar os papéis para despachar, errava. O que o dono pediu: "tem
 * que imprimir todo o pedido que teve, com a bebida. Só que um só."
 *
 * Então: o pedido colado nunca imprime sozinho (fila da nuvem, ouvinte do
 * navegador e auto-print da tela o pulam), e todo papel do pedido principal
 * leva os itens dos acréscimos dele, marcados, com o valor a cobrar à parte.
 *
 * O NOME do item não muda — é por ele que a impressão acha a categoria e a
 * impressora (lib/categoria-do-item.ts). A marca vai na observação do item.
 */

const CANCELADOS = new Set(["CANCELADO", "CANCELLED", "CANCELED"]);

export const MARCA_DO_ACRESCIMO = "➕ ACRÉSCIMO";

type PedidoComItens = {
  id: string;
  parentOrderId?: string | null;
  status?: string | null;
  totalAmount?: number | null;
  paymentMethod?: string | null;
  notes?: string | null;
  items?: any[] | null;
};

const reais = (v: number) => `R$ ${(Number(v) || 0).toFixed(2).replace(".", ",")}`;

/** Os acréscimos vivos deste pedido, na ordem em que estão na lista. */
export function acrescimosDoPedido<T extends PedidoComItens>(pedido: { id: string }, todos: readonly T[]): T[] {
  return todos.filter(
    (o) => o.parentOrderId === pedido.id && !CANCELADOS.has(String(o.status || "").toUpperCase()),
  );
}

/**
 * O pedido principal com os itens dos acréscimos dentro, pronto para virar
 * comanda. Sem acréscimo, devolve o próprio pedido (mesmo objeto).
 *
 * A linha de cobrança vai em `notes`, a observação que TODA versão do
 * Assistente imprime em destaque — campo novo só sairia nas lojas atualizadas.
 */
export function pedidoComAcrescimos<T extends PedidoComItens>(pai: T, todos: readonly PedidoComItens[]): T {
  // Já juntado (a tela junta com a lista recém-relida e o handlePrint, com a
  // dela, que pode estar atrasada): juntar de novo duplicaria os itens.
  if ((pai as any).__comAcrescimos) return pai;
  const filhos = acrescimosDoPedido(pai, todos);
  if (filhos.length === 0) return pai;

  const itensDosFilhos = filhos.flatMap((f) =>
    (f.items || []).map((i: any) => ({
      ...i,
      notes: [MARCA_DO_ACRESCIMO, String(i.notes || "").trim()].filter(Boolean).join(" - "),
    })),
  );

  const cobrancas = filhos.map((f) => {
    // "Crédito (Cobrar na Entrega)" → "Crédito": o "cobrar" já está na frase.
    const forma = String(f.paymentMethod || "").replace(/\s*\([^)]*\)\s*$/, "").trim();
    return `${MARCA_DO_ACRESCIMO}: ${reais(Number(f.totalAmount) || 0)} COBRAR À PARTE${forma ? ` (${forma})` : ""}`;
  });

  const original = String(pai.notes || "").trim();
  return {
    ...pai,
    __comAcrescimos: true,
    items: [...(pai.items || []), ...itensDosFilhos],
    notes: [...cobrancas, original].filter(Boolean).join("\n"),
  };
}
