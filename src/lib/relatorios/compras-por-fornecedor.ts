/**
 * COMPRAS POR FORNECEDOR — o "Compras" do SWFast: o que entrou pelas compras
 * lançadas (Estoque › Compras, nota lida pela IA, compra sem nota) no
 * período, por fornecedor e por insumo, com o preço médio. E o que o SWF não
 * mostra: o ALERTA do insumo que subiu de preço — a última compra comparada
 * com a compra anterior do mesmo insumo (mesmo que antes do período).
 *
 * O dia da compra é o dia em que a mercadoria entrou (`StockInvoice.dia`; a
 * compra antiga sem ele, o dia em que foi lançada), o mesmo do CMV. Compra
 * desfeita não entra. O valor é o que entrou no estoque (quantidade × custo
 * de cada entrada), não o total da nota: item ignorado na nota não é compra
 * de insumo.
 *
 * Puro. Testado em scripts/teste-estoque-relatorios.ts.
 */
import { c2 } from "@/lib/relatorios/base";

/** Subiu este tanto ou mais: alerta. */
export const ALTA_QUE_ALERTA_PCT = 5;
export const SEM_FORNECEDOR = "Sem fornecedor";

export type EntradaDeCompra = {
  compraId: string;
  dia: string;
  /** Desempate no mesmo dia (ms). */
  em: number;
  fornecedor: string | null;
  stockItemId: string;
  nome: string;
  unidade: string;
  quantidade: number;
  custoUnitario: number;
};

const chave = (f: string) => f.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * `entradas` traz o período E o histórico antes dele (para a compra
 * anterior). Só as de `de` a `ate` somam.
 */
export function comprasPorFornecedor(entradas: EntradaDeCompra[], de: string, ate: string) {
  const validas = entradas.filter((e) => e.quantidade > 0 && Number.isFinite(e.custoUnitario) && e.custoUnitario >= 0);
  const doPeriodo = validas.filter((e) => e.dia >= de && e.dia <= ate);

  type Forn = { fornecedor: string; compras: Set<string>; total: number; insumos: Set<string>; ultima: string };
  const fornecedores = new Map<string, Forn>();
  for (const e of doPeriodo) {
    const nome = String(e.fornecedor || "").trim() || SEM_FORNECEDOR;
    const k = chave(nome);
    let f = fornecedores.get(k);
    if (!f) { f = { fornecedor: nome, compras: new Set(), total: 0, insumos: new Set(), ultima: e.dia }; fornecedores.set(k, f); }
    f.compras.add(e.compraId);
    f.total += e.quantidade * e.custoUnitario;
    f.insumos.add(e.stockItemId);
    if (e.dia > f.ultima) f.ultima = e.dia;
  }

  // Por insumo: quantidade, valor, preço médio, e a variação da última compra.
  const historico = new Map<string, EntradaDeCompra[]>();
  for (const e of validas) {
    if (!historico.has(e.stockItemId)) historico.set(e.stockItemId, []);
    historico.get(e.stockItemId)!.push(e);
  }
  const insumos = [...new Set(doPeriodo.map((e) => e.stockItemId))].map((id) => {
    const todas = historico.get(id)!.sort((a, b) => a.dia.localeCompare(b.dia) || a.em - b.em);
    const noPeriodo = todas.filter((e) => e.dia >= de && e.dia <= ate);
    const quantidade = noPeriodo.reduce((s, e) => s + e.quantidade, 0);
    const valor = noPeriodo.reduce((s, e) => s + e.quantidade * e.custoUnitario, 0);
    const ultima = noPeriodo[noPeriodo.length - 1];
    const anterior = todas[todas.indexOf(ultima) - 1] ?? null;
    const variacaoPct = anterior && anterior.custoUnitario > 0 ? Math.round(((ultima.custoUnitario - anterior.custoUnitario) / anterior.custoUnitario) * 10000) / 100 : null;
    const fornecedoresDoInsumo = [...new Set(noPeriodo.map((e) => String(e.fornecedor || "").trim() || SEM_FORNECEDOR))];
    return {
      stockItemId: id, nome: ultima.nome, unidade: ultima.unidade,
      compras: noPeriodo.length,
      quantidade: Math.round(quantidade * 1000) / 1000,
      valor: c2(valor),
      precoMedio: quantidade > 0 ? Math.round((valor / quantidade) * 10000) / 10000 : null,
      ultimoPreco: ultima.custoUnitario,
      ultimoDia: ultima.dia,
      ultimoFornecedor: String(ultima.fornecedor || "").trim() || SEM_FORNECEDOR,
      precoAnterior: anterior?.custoUnitario ?? null,
      diaAnterior: anterior?.dia ?? null,
      fornecedorAnterior: anterior ? String(anterior.fornecedor || "").trim() || SEM_FORNECEDOR : null,
      variacaoPct,
      subiu: variacaoPct != null && variacaoPct >= ALTA_QUE_ALERTA_PCT,
      fornecedores: fornecedoresDoInsumo,
    };
  }).sort((a, b) => b.valor - a.valor || a.nome.localeCompare(b.nome, "pt-BR"));

  const total = c2(doPeriodo.reduce((s, e) => s + e.quantidade * e.custoUnitario, 0));
  return {
    fornecedores: [...fornecedores.values()]
      .map((f) => ({ fornecedor: f.fornecedor, compras: f.compras.size, insumos: f.insumos.size, total: c2(f.total), pct: total > 0 ? Math.round((f.total / total) * 10000) / 100 : 0, ultima: f.ultima }))
      .sort((a, b) => b.total - a.total),
    insumos,
    // Os que subiram, o maior aumento primeiro.
    alertas: insumos.filter((i) => i.subiu).sort((a, b) => (b.variacaoPct ?? 0) - (a.variacaoPct ?? 0)),
    totais: { total, compras: new Set(doPeriodo.map((e) => e.compraId)).size, insumos: insumos.length },
  };
}

export type ResultadoDasCompras = ReturnType<typeof comprasPorFornecedor>;
