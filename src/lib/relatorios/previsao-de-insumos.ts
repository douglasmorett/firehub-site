/**
 * A PREVISÃO DE INSUMOS DA SEMANA — o "Previsão de gastos com insumos" do
 * SWFast: para cada insumo, quanto vai sair em cada um dos próximos 7 dias.
 *
 * A conta: a MÉDIA do consumo do mesmo dia da semana nas últimas semanas
 * (vendas × ficha técnica de hoje, lib/relatorios/consumo-pela-ficha.ts). A
 * sexta que vem é a média das últimas sextas, não a média de todos os dias —
 * a hamburgueria vende o triplo na sexta. O dia da semana em que a loja não
 * abriu entra como zero: é o que ela gasta nesse dia.
 *
 * Mostra a média, −10% e +10% (a folga do SWF) e o custo previsto pelo custo
 * de hoje do insumo. Insumo sem custo aparece com a quantidade e fica fora do
 * custo — dito na tela, nunca como R$ 0.
 *
 * Puro. Testado em scripts/teste-previsao-de-insumos.ts.
 */
import { c2, DIAS_CURTOS, somarDias } from "@/lib/relatorios/base";

export type InsumoDaPrevisao = { id: string; nome: string; unidade: string; custo: number | null };

export type DiaDaPrevisao = {
  dia: string;
  /** 0 = domingo. */
  diaSemana: number;
  rotulo: string;
  /** Quantos dias deste dia da semana a base tem (a média é sobre eles). */
  amostras: number;
  /** Custo previsto do dia (média), só dos insumos com custo. */
  custo: number;
};

export type LinhaDaPrevisao = {
  id: string;
  nome: string;
  unidade: string;
  custoUnitario: number | null;
  /** A média prevista de cada dia, na ordem de `dias`. */
  porDia: number[];
  total: number;
  /** null = insumo sem custo. */
  custoTotal: number | null;
};

export type ResultadoDaPrevisao = {
  dias: DiaDaPrevisao[];
  linhas: LinhaDaPrevisao[];
  totais: { custo: number; insumosSemCusto: number };
};

const q3 = (n: number) => Math.round(n * 1000) / 1000;
/** Dia da semana de "AAAA-MM-DD" (o dia operacional já é a data da loja). */
export const diaDaSemana = (dia: string) => new Date(`${dia}T12:00:00Z`).getUTCDay();

/** Os `n` dias a partir de `primeiro`. */
export function proximosDias(primeiro: string, n = 7): string[] {
  return Array.from({ length: n }, (_, k) => somarDias(primeiro, k));
}

export function previsaoDeInsumos(e: {
  /** dia da base → insumoId → consumo (comprados, com o preparo descido; ou os preparos). */
  consumoPorDia: Map<string, Map<string, number>>;
  /** Todos os dias da base, inclusive os sem venda. */
  diasDaBase: string[];
  /** Os dias a prever. */
  dias: string[];
  insumos: InsumoDaPrevisao[];
}): ResultadoDaPrevisao {
  // Média de cada insumo por dia da semana.
  const amostras = new Array(7).fill(0) as number[];
  const somaPorSemana = Array.from({ length: 7 }, () => new Map<string, number>());
  for (const d of e.diasDaBase) {
    const w = diaDaSemana(d);
    amostras[w]++;
    for (const [id, q] of e.consumoPorDia.get(d) || []) somaPorSemana[w].set(id, (somaPorSemana[w].get(id) || 0) + q);
  }
  const media = (w: number, id: string) => (amostras[w] > 0 ? (somaPorSemana[w].get(id) || 0) / amostras[w] : 0);

  const custoPorDia = new Array(e.dias.length).fill(0) as number[];
  const linhas: LinhaDaPrevisao[] = [];
  for (const i of e.insumos) {
    const porDia = e.dias.map((d) => q3(media(diaDaSemana(d), i.id)));
    const total = q3(porDia.reduce((s, q) => s + q, 0));
    if (!(total > 0)) continue;
    const custo = i.custo != null && i.custo > 0 && Number.isFinite(i.custo) ? i.custo : null;
    if (custo != null) porDia.forEach((q, k) => { custoPorDia[k] += q * custo; });
    linhas.push({ id: i.id, nome: i.nome, unidade: i.unidade, custoUnitario: custo, porDia, total, custoTotal: custo != null ? c2(total * custo) : null });
  }
  linhas.sort((a, b) => (b.custoTotal ?? -1) - (a.custoTotal ?? -1) || b.total - a.total || a.nome.localeCompare(b.nome, "pt-BR"));

  const dias: DiaDaPrevisao[] = e.dias.map((d, k) => {
    const w = diaDaSemana(d);
    return { dia: d, diaSemana: w, rotulo: `${DIAS_CURTOS[w]} ${d.slice(8, 10)}/${d.slice(5, 7)}`, amostras: amostras[w], custo: c2(custoPorDia[k]) };
  });
  return {
    dias,
    linhas,
    totais: { custo: c2(custoPorDia.reduce((s, c) => s + c, 0)), insumosSemCusto: linhas.filter((l) => l.custoTotal == null).length },
  };
}

/** A folga do SWF: −10% e +10% sobre a média. */
export const FAIXAS = { menos10: 0.9, media: 1, mais10: 1.1 } as const;
export type Faixa = keyof typeof FAIXAS;
