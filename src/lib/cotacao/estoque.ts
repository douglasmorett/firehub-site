/**
 * O PEDIDO RECEBIDO VIRA ENTRADA NO ESTOQUE — a conversão da unidade de compra
 * (cx, fardo) para a unidade do insumo (un, kg). Puro.
 *
 * A entrada em si é a de sempre (lib/cmv/lancar-compra.ts: estoque + custo
 * gravado no movimento, numa transação). O que falta lá é saber que "1 cx" de
 * Coca são 12 latas: isso mora no produto de compra (`fatorDoInsumo`). Sem o
 * fator e sem conversão conhecida (kg → g), o item fica de fora e a tela diz
 * qual e por quê — lançar 1 caixa como 1 lata é o erro silencioso que a
 * lib/unidades.ts existe para impedir.
 */
import type { ItemDaCompra } from "@/lib/cmv/lancar-compra";
import { fatorDeConversao, normalizarUnidade } from "@/lib/unidades";

export type ItemRecebido = { produtoId: string; nome: string; unidade: string; quantidade: number; preco: number | null };
export type ProdutoComInsumo = { id: string; stockItemId: string | null; fatorDoInsumo: number | null };
export type Insumo = { id: string; unit: string };

const r2 = (n: number) => Math.round(n * 100) / 100;

export function itensParaOEstoque(
  itens: ItemRecebido[],
  produtos: ProdutoComInsumo[],
  insumos: Insumo[],
): { itens: ItemDaCompra[]; fora: string[] } {
  const prod = new Map(produtos.map((p) => [p.id, p]));
  const ins = new Map(insumos.map((i) => [i.id, i]));
  const saida: ItemDaCompra[] = [];
  const fora: string[] = [];
  for (const it of itens) {
    const p = prod.get(it.produtoId);
    const insumo = p?.stockItemId ? ins.get(p.stockItemId) : undefined;
    if (!p || !insumo) { fora.push(`${it.nome} (não está ligado a um insumo do estoque)`); continue; }
    const valorTotal = it.preco !== null ? r2(it.quantidade * it.preco) : undefined;
    const unidadeDoInsumo = normalizarUnidade(insumo.unit) || insumo.unit;
    if (p.fatorDoInsumo && p.fatorDoInsumo > 0) {
      saida.push({ stockItemId: insumo.id, nome: it.nome, quantidade: Number((it.quantidade * p.fatorDoInsumo).toFixed(6)), unidade: unidadeDoInsumo, valorTotal });
      continue;
    }
    if (fatorDeConversao(it.unidade, insumo.unit) === null) {
      fora.push(`${it.nome} (comprado em ${it.unidade}, estoque em ${unidadeDoInsumo}: diga quantos ${unidadeDoInsumo} vêm em 1 ${it.unidade} no produto)`);
      continue;
    }
    saida.push({ stockItemId: insumo.id, nome: it.nome, quantidade: it.quantidade, unidade: it.unidade, valorTotal });
  }
  return { itens: saida, fora };
}
