/**
 * /src/lib/selecao-de-impressao.ts
 *
 * "Selecionar itens para impressão" na mesa aberta: o atendente marca quais
 * itens da conta quer imprimir (ou reimprimir) e manda. Pedido do Douglas a
 * partir da Delícia de Casa (02/10/2026), para todas as lojas.
 *
 * Esta é a parte PURA: conferir o que foi marcado contra os pedidos da mesa.
 * Quem monta o papel e põe na fila é api/store/table-sessions/[id]/imprimir-itens.
 *
 * ── Por que recusar em vez de imprimir "o que deu" ─────────────────────────
 *
 * Item marcado que não está mais na mesa (outro garçom removeu, o pedido foi
 * cancelado, a conta mudou de mesa) recusa a seleção inteira: imprimir MENOS
 * do que a pessoa conferiu na tela é o papel que a cozinha não questiona —
 * mesma escolha do lançamento (lib/lancar-na-mesa.ts).
 */

/** Teto de itens numa seleção: a mesa mais cheia da Pastel da Paulista tinha ~60. */
export const LIMITE_DA_SELECAO = 200;

const CANCELADOS = new Set(["CANCELADO", "CANCELED", "CANCELLED"]);

export type PedidoDaSelecao<I extends { id: string }> = {
  id: string;
  dailyOrderNumber?: number | string | null;
  status?: string | null;
  createdAt?: Date | string | null;
  items: I[];
};

export type ResultadoDaSelecao<I extends { id: string }, P extends PedidoDaSelecao<I>> =
  | { ok: true; itens: { item: I; pedido: P }[]; pedidos: P[]; numeros: string }
  | { ok: false; erro: string };

/**
 * Os itens marcados, na ordem em que estão na mesa (pedido mais antigo
 * primeiro, e a ordem do item dentro dele) — não na ordem dos cliques.
 *
 * `numeros` é o número do pedido para o topo do papel: um pedido só, o
 * número dele ("12"); vários, todos ("12/14"), para a cozinha achar as
 * comandas de origem.
 */
export function escolherItensDaMesa<I extends { id: string }, P extends PedidoDaSelecao<I>>(
  pedidos: P[],
  marcados: unknown
): ResultadoDaSelecao<I, P> {
  if (!Array.isArray(marcados)) return { ok: false, erro: "Marque pelo menos um item." };
  const ids = new Set(marcados.map((v) => String(v ?? "").trim()).filter(Boolean));
  if (ids.size === 0) return { ok: false, erro: "Marque pelo menos um item." };
  if (ids.size > LIMITE_DA_SELECAO) return { ok: false, erro: `Dá para imprimir até ${LIMITE_DA_SELECAO} itens de uma vez.` };

  const ordenados = [...(pedidos || [])].sort(
    (a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime()
  );

  const itens: { item: I; pedido: P }[] = [];
  const achados = new Set<string>();
  for (const pedido of ordenados) {
    if (CANCELADOS.has(String(pedido.status || "").toUpperCase())) continue;
    for (const item of pedido.items || []) {
      if (!ids.has(item.id) || achados.has(item.id)) continue;
      achados.add(item.id);
      itens.push({ item, pedido });
    }
  }

  if (achados.size !== ids.size) {
    return {
      ok: false,
      erro: "Algum item marcado não está mais nesta mesa (removido, cancelado ou a conta mudou). Atualize a tela e marque de novo.",
    };
  }

  const usados: P[] = [];
  for (const { pedido } of itens) if (!usados.includes(pedido)) usados.push(pedido);
  const numeros = usados
    .map((p) => String(p.dailyOrderNumber ?? "").trim())
    .filter(Boolean)
    .filter((n, i, todos) => todos.indexOf(n) === i)
    .join("/");

  return { ok: true, itens, pedidos: usados, numeros: numeros || "—" };
}
