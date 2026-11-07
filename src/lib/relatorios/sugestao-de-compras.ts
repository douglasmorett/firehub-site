/**
 * A LISTA DE COMPRAS — o "Sugestão de compras" do SWFast, feito para o lojista
 * usar no celular, na hora de ligar para o fornecedor.
 *
 * Para cada insumo: o saldo de hoje, o mínimo, o IDEAL (quanto ele quer ter
 * na prateleira depois de comprar), o consumo médio por dia (vendas das
 * últimas semanas × ficha técnica de hoje, lib/relatorios/consumo-pela-
 * ficha.ts), quantos dias o saldo dura e QUANTO COMPRAR.
 *
 * ── Quanto comprar ──────────────────────────────────────────────────────────
 *
 * Dois jeitos, o lojista escolhe:
 *   - "até o ideal": compra o que falta do saldo até o ideal. Sem ideal
 *     cadastrado, o sistema SUGERE um: o consumo de DIAS_DO_IDEAL_SUGERIDO
 *     dias (nunca abaixo do mínimo) — o SWF só deixa a coluna vazia;
 *   - "para N dias": compra o que cobre N dias de consumo (nunca abaixo do
 *     mínimo), menos o saldo.
 * Saldo negativo (vendeu mais do que entrou no sistema) conta como zero: a
 * prateleira não tem estoque negativo, e somar o buraco inflaria a compra.
 * A quantidade sobe para um número redondo de pedir (10 g, 0,1 kg, 1 un).
 *
 * ── Fornecedor ──────────────────────────────────────────────────────────────
 *
 * Agrupado pelo texto `StockItem.supplier` (o fornecedor da última nota). Cada
 * fornecedor sai com o texto do pedido pronto para o WhatsApp.
 *
 * Puro. Testado em scripts/teste-sugestao-de-compras.ts.
 */
import { c2 } from "@/lib/relatorios/base";
import { quantidadeLegivel } from "@/lib/relatorios/consumo-pela-ficha";

/** Quantos dias de consumo o ideal sugerido cobre: uma semana, o ciclo de compra comum. */
export const DIAS_DO_IDEAL_SUGERIDO = 7;
export const SEM_FORNECEDOR = "Sem fornecedor";

export type InsumoDaLista = {
  id: string;
  nome: string;
  unidade: string;
  lojaId: string;
  saldo: number;
  minimo: number | null;
  ideal: number | null;
  /** Custo de hoje por unidade (última compra, cadastro ou preparo); null = sem custo. */
  custo: number | null;
  fornecedor: string | null;
};

export type ModoDaLista = { modo: "ideal" } | { modo: "dias"; dias: number };

export type SituacaoDoInsumo = "acabou" | "abaixoDoMinimo" | "comprar" | "ok" | "semUso";

export type LinhaDaLista = {
  id: string;
  nome: string;
  unidade: string;
  lojaId: string;
  fornecedor: string;
  saldo: number;
  minimo: number | null;
  ideal: number | null;
  /** O ideal que o consumo sugere (só quando não há ideal cadastrado). */
  idealSugerido: number | null;
  consumoPorDia: number;
  /** Quantos dias o saldo dura no ritmo de hoje; null = sem consumo. */
  duraDias: number | null;
  /** Até quanto a compra leva o saldo; null = não há como dizer (sem consumo, mínimo nem ideal). */
  alvo: number | null;
  comprar: number;
  custoUnitario: number | null;
  /** null = sem custo cadastrado (fora do total). */
  custoDaCompra: number | null;
  situacao: SituacaoDoInsumo;
};

export type GrupoDoFornecedor = {
  fornecedor: string;
  itens: LinhaDaLista[];
  /** Soma só do que tem custo; `itensSemCusto` diz quantos ficaram fora. */
  total: number;
  itensSemCusto: number;
  /** O pedido pronto para colar no WhatsApp. */
  texto: string;
};

export type ResultadoDaLista = {
  linhas: LinhaDaLista[];
  fornecedores: GrupoDoFornecedor[];
  totais: { aComprar: number; itens: number; itensSemCusto: number; acabaram: number; abaixoDoMinimo: number; valorDoEstoque: number; insumosSemCusto: number };
};

const q3 = (n: number) => Math.round(n * 1000) / 1000;

/** Sobe para um número redondo de pedir: 10 g/ml, 0,1 kg/l, 1 un (e o que não tem família). */
export function arredondarCompra(q: number, unidade: string): number {
  if (!(q > 0)) return 0;
  const u = String(unidade || "").toLowerCase();
  const passo = u === "g" || u === "ml" ? 10 : u === "kg" || u === "l" ? 0.1 : 1;
  return q3(Math.ceil(q / passo - 1e-9) * passo);
}

const ORDEM: Record<SituacaoDoInsumo, number> = { acabou: 0, abaixoDoMinimo: 1, comprar: 2, ok: 3, semUso: 4 };

export function linhaDaLista(i: InsumoDaLista, consumoNaBase: number, diasDaBase: number, modo: ModoDaLista): LinhaDaLista {
  const consumoPorDia = diasDaBase > 0 ? Math.max(0, consumoNaBase) / diasDaBase : 0;
  const saldo = Number(i.saldo) || 0;
  const naPrateleira = Math.max(0, saldo);
  const minimo = i.minimo != null && Number.isFinite(i.minimo) ? i.minimo : null;
  const ideal = i.ideal != null && Number.isFinite(i.ideal) && i.ideal > 0 ? i.ideal : null;
  const idealSugerido = ideal == null && consumoPorDia > 0
    ? arredondarCompra(Math.max(minimo ?? 0, consumoPorDia * DIAS_DO_IDEAL_SUGERIDO), i.unidade)
    : null;

  let alvo: number | null;
  if (modo.modo === "ideal") alvo = ideal ?? idealSugerido ?? minimo;
  else alvo = consumoPorDia > 0 ? Math.max(consumoPorDia * Math.max(1, modo.dias), minimo ?? 0) : minimo;

  const comprar = alvo != null ? arredondarCompra(alvo - naPrateleira, i.unidade) : 0;
  const custo = i.custo != null && i.custo > 0 && Number.isFinite(i.custo) ? i.custo : null;

  const usado = consumoPorDia > 0 || minimo != null || ideal != null;
  const situacao: SituacaoDoInsumo = !usado ? "semUso"
    : saldo <= 0 ? "acabou"
    : minimo != null && saldo <= minimo ? "abaixoDoMinimo"
    : comprar > 0 ? "comprar"
    : "ok";

  return {
    id: i.id, nome: i.nome, unidade: i.unidade, lojaId: i.lojaId,
    fornecedor: String(i.fornecedor || "").trim() || SEM_FORNECEDOR,
    saldo: q3(saldo), minimo, ideal, idealSugerido,
    consumoPorDia: q3(consumoPorDia),
    duraDias: consumoPorDia > 0 ? Math.round((naPrateleira / consumoPorDia) * 10) / 10 : null,
    alvo: alvo == null ? null : q3(alvo),
    comprar,
    custoUnitario: custo,
    custoDaCompra: comprar > 0 && custo != null ? c2(comprar * custo) : comprar > 0 ? null : 0,
    situacao,
  };
}

/** O texto do pedido para o fornecedor. `*` é negrito no WhatsApp. */
export function textoDoPedido(loja: string, itens: Pick<LinhaDaLista, "nome" | "comprar" | "unidade">[]): string {
  const linhas = itens.filter((i) => i.comprar > 0).map((i) => `• ${quantidadeLegivel(i.comprar, i.unidade)} — ${i.nome}`);
  return [`Olá! Pedido da *${loja}*:`, "", ...linhas, "", "Obrigado!"].join("\n");
}

export function listaDeCompras(e: {
  insumos: InsumoDaLista[];
  /** insumoId → consumo somado na base (comprados, com o preparo já descido). */
  consumo: Map<string, number>;
  diasDaBase: number;
  modo: ModoDaLista;
  loja: string;
}): ResultadoDaLista {
  const linhas = e.insumos
    .map((i) => linhaDaLista(i, e.consumo.get(i.id) || 0, e.diasDaBase, e.modo))
    .sort((a, b) => ORDEM[a.situacao] - ORDEM[b.situacao] || a.nome.localeCompare(b.nome, "pt-BR"));

  // O mesmo fornecedor escrito de dois jeitos ("Atacadão" e "atacadao ") é um só.
  const chave = (f: string) => f.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  const grupos = new Map<string, GrupoDoFornecedor>();
  for (const l of linhas) {
    if (!(l.comprar > 0)) continue;
    const k = chave(l.fornecedor);
    let g = grupos.get(k);
    if (!g) { g = { fornecedor: l.fornecedor, itens: [], total: 0, itensSemCusto: 0, texto: "" }; grupos.set(k, g); }
    g.itens.push(l);
    if (l.custoDaCompra == null) g.itensSemCusto++;
    else g.total += l.custoDaCompra;
  }
  const fornecedores = [...grupos.values()]
    .map((g) => ({ ...g, total: c2(g.total), texto: textoDoPedido(e.loja, g.itens) }))
    // "Sem fornecedor" por último; os outros pelo valor da compra.
    .sort((a, b) => Number(a.fornecedor === SEM_FORNECEDOR) - Number(b.fornecedor === SEM_FORNECEDOR) || b.total - a.total || a.fornecedor.localeCompare(b.fornecedor, "pt-BR"));

  const aComprar = linhas.filter((l) => l.comprar > 0);
  return {
    linhas,
    fornecedores,
    totais: {
      aComprar: c2(aComprar.reduce((s, l) => s + (l.custoDaCompra || 0), 0)),
      itens: aComprar.length,
      itensSemCusto: aComprar.filter((l) => l.custoDaCompra == null).length,
      acabaram: linhas.filter((l) => l.situacao === "acabou").length,
      abaixoDoMinimo: linhas.filter((l) => l.situacao === "abaixoDoMinimo").length,
      // Valor do estoque: saldo positivo × custo de hoje. Sem custo fica fora (e contado).
      valorDoEstoque: c2(e.insumos.reduce((s, i) => s + (i.saldo > 0 && i.custo != null && i.custo > 0 ? i.saldo * i.custo : 0), 0)),
      insumosSemCusto: e.insumos.filter((i) => i.saldo > 0 && !(i.custo != null && i.custo > 0)).length,
    },
  };
}
