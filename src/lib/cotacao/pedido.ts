/**
 * MONTAR O PEDIDO DE COMPRA — os itens marcados no comparativo, agrupados por
 * fornecedor, com o total, o pedido mínimo e o próximo dia de entrega. Puro.
 *
 * Douglas, 07/11/2026: "ele pode selecionar tudo o que quer comprar e a
 * quantidade e já enviar para esse fornecedor." O comparativo já sugere o mais
 * barato por item; o lojista pode trocar. Aqui só se agrupa e se confere —
 * o envio é da fila (./fila.ts).
 */
import { faltaParaOMinimo, proximaEntrega, type ProximaEntrega, type RegraDeEntrega } from "./entrega";

export type ItemEscolhido = { produtoId: string; fornecedorId: string; quantidade: number; preco: number | null };
export type FornecedorDoPedido = RegraDeEntrega & { id: string; nome: string; contato: string | null; pedidoMinimo: number | null };
export type ProdutoDoPedido = { id: string; nome: string; unidade: string };

export type ItemDoGrupo = { produtoId: string; nome: string; unidade: string; quantidade: number; preco: number | null; subtotal: number };
export type GrupoDoPedido = {
  fornecedor: FornecedorDoPedido;
  itens: ItemDoGrupo[];
  total: number;
  /** Quanto falta para o pedido mínimo (0 = atingiu). */
  falta: number;
  entrega: ProximaEntrega;
  /** Item sem preço conhecido: o total não fecha, e o texto pede o preço. */
  semPreco: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export function agruparPedido(
  escolhidos: ItemEscolhido[],
  produtos: ProdutoDoPedido[],
  fornecedores: FornecedorDoPedido[],
  agora: Date,
  tz: string,
): GrupoDoPedido[] {
  const prod = new Map(produtos.map((p) => [p.id, p]));
  const forn = new Map(fornecedores.map((f) => [f.id, f]));
  const grupos = new Map<string, GrupoDoPedido>();
  for (const e of escolhidos) {
    const p = prod.get(e.produtoId);
    const f = forn.get(e.fornecedorId);
    const q = Number(e.quantidade);
    if (!p || !f || !Number.isFinite(q) || q <= 0) continue;
    let g = grupos.get(f.id);
    if (!g) {
      g = { fornecedor: f, itens: [], total: 0, falta: 0, entrega: proximaEntrega(f, agora, tz), semPreco: 0 };
      grupos.set(f.id, g);
    }
    // O mesmo produto marcado duas vezes para o mesmo fornecedor soma.
    const ja = g.itens.find((i) => i.produtoId === p.id);
    const preco = e.preco !== null && Number.isFinite(Number(e.preco)) && Number(e.preco) > 0 ? r2(Number(e.preco)) : null;
    if (ja) {
      ja.quantidade = r2(ja.quantidade + q);
      ja.subtotal = ja.preco !== null ? r2(ja.quantidade * ja.preco) : 0;
    } else {
      g.itens.push({ produtoId: p.id, nome: p.nome, unidade: p.unidade, quantidade: r2(q), preco, subtotal: preco !== null ? r2(q * preco) : 0 });
    }
  }
  for (const g of grupos.values()) {
    g.total = r2(g.itens.reduce((s, i) => s + i.subtotal, 0));
    g.semPreco = g.itens.filter((i) => i.preco === null).length;
    g.falta = faltaParaOMinimo(g.total, g.fornecedor.pedidoMinimo);
  }
  return [...grupos.values()].sort((a, b) => b.total - a.total);
}
