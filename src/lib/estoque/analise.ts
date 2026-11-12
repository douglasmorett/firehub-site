/**
 * AS CONTAS DA TELA DO ESTOQUE — puras, para a tabela de insumos, o detalhe do
 * insumo, a visão geral e as fichas técnicas:
 *
 *   - consumo médio por dia: as saídas REAIS dos últimos dias (venda pela
 *     ficha, perda e saída à mão; AJUSTE de contagem e entrada não contam);
 *   - cobertura: quantos dias o saldo dura nesse ritmo ("acaba em ~3 dias");
 *   - curva ABC pelo valor consumido (A = os que somam 80% do dinheiro);
 *   - histórico de preço por compra, com a variação de uma para a outra;
 *   - margem da ficha: preço − custo, e o CMV % teórico (custo ÷ preço).
 *
 * Testado em scripts/teste-analise-do-estoque.ts.
 */

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Os tipos de movimento que são consumo de verdade (o que saiu da loja). */
export const TIPOS_DE_SAIDA = ["SALE", "WASTE", "OUTPUT"] as const;

export type SaidaDoInsumo = { stockItemId: string; tipo: string; quantidade: number; notes?: string | null };

/**
 * Σ das saídas de cada insumo ÷ dias. A devolução da venda cancelada (INPUT
 * "cancel id:") desconta a venda que ela desfaz.
 */
export function consumoMedioPorDia(movimentos: SaidaDoInsumo[], dias: number): Map<string, number> {
  const soma = new Map<string, number>();
  for (const m of movimentos) {
    const tipo = String(m.tipo || "").toUpperCase();
    let q = 0;
    if ((TIPOS_DE_SAIDA as readonly string[]).includes(tipo)) q = -m.quantidade;
    else if (tipo === "INPUT" && String(m.notes || "").includes("cancel id:")) q = -m.quantidade;
    else continue;
    soma.set(m.stockItemId, (soma.get(m.stockItemId) || 0) + q);
  }
  const d = Math.max(1, dias);
  return new Map([...soma].map(([id, q]) => [id, r3(Math.max(0, q) / d)]));
}

export type NivelDaCobertura = "acabou" | "critico" | "atencao" | "ok" | "semConsumo";

/** Quantos dias o saldo dura no ritmo de consumo. Nulo sem consumo. */
export function coberturaEmDias(saldo: number, consumoPorDia: number): number | null {
  if (!(consumoPorDia > 0)) return null;
  if (saldo <= 0) return 0;
  return r1(saldo / consumoPorDia);
}

/** Vermelho abaixo de 2 dias, amarelo abaixo de 5. */
export function nivelDaCobertura(saldo: number, dias: number | null): NivelDaCobertura {
  if (saldo <= 0 && dias !== null) return "acabou";
  if (dias == null) return saldo <= 0 ? "acabou" : "semConsumo";
  if (dias < 2) return "critico";
  if (dias < 5) return "atencao";
  return "ok";
}

export type Curva = "A" | "B" | "C";

/**
 * Curva ABC pelo valor consumido: em ordem do mais caro, o que leva a soma
 * até 80% é A, até 95% é B, o resto (e quem não consumiu nada) é C.
 */
export function curvaAbc(itens: { id: string; valor: number }[]): Map<string, Curva> {
  const saida = new Map<string, Curva>();
  const comValor = itens.filter((i) => i.valor > 0).sort((a, b) => b.valor - a.valor);
  const total = comValor.reduce((s, i) => s + i.valor, 0);
  let acumulado = 0;
  for (const i of comValor) {
    const antes = acumulado / total;
    acumulado += i.valor;
    saida.set(i.id, antes < 0.8 ? "A" : antes < 0.95 ? "B" : "C");
  }
  for (const i of itens) if (!saida.has(i.id)) saida.set(i.id, "C");
  return saida;
}

export type CompraDoInsumo = { dia: string; em: number; custo: number; quantidade: number; fornecedor: string | null };
export type PrecoNaCompra = CompraDoInsumo & { variacaoPct: number | null };

/** As compras em ordem, com a variação de preço para a compra anterior. */
export function historicoDePreco(compras: CompraDoInsumo[]): { compras: PrecoNaCompra[]; ultimaVariacao: number | null; variacaoNoPeriodo: number | null } {
  const ordem = [...compras].filter((c) => c.custo > 0).sort((a, b) => a.dia.localeCompare(b.dia) || a.em - b.em);
  const lista: PrecoNaCompra[] = ordem.map((c, i) => ({
    ...c, variacaoPct: i > 0 ? variacao(ordem[i - 1].custo, c.custo) : null,
  }));
  return {
    compras: lista,
    ultimaVariacao: lista.length > 1 ? lista[lista.length - 1].variacaoPct : null,
    variacaoNoPeriodo: lista.length > 1 ? variacao(lista[0].custo, lista[lista.length - 1].custo) : null,
  };
}

/** Variação % de `de` para `para`, com 1 casa. */
export function variacao(de: number, para: number): number | null {
  return de > 0 ? r1(((para - de) / de) * 100) : null;
}

export type MargemDaFicha = { margem: number; margemPct: number; cmvPct: number } | null;

/** Preço − custo e o CMV teórico (custo ÷ preço). Nulo sem preço ou sem custo. */
export function margemDaFicha(preco: number, custo: number | null): MargemDaFicha {
  if (!(preco > 0) || custo == null) return null;
  return { margem: r2(preco - custo), margemPct: r1(((preco - custo) / preco) * 100), cmvPct: r1((custo / preco) * 100) };
}

/** Margem baixa: CMV teórico acima do teto (padrão 40%) ou margem negativa. */
export function margemBaixa(m: MargemDaFicha, tetoDoCmv = 40): boolean {
  return m != null && (m.margem < 0 || m.cmvPct > tetoDoCmv);
}

/** Dias desde a última contagem (nulo = nunca contado). */
export function diasSemContar(ultimaContagem: string | null, hoje: string): number | null {
  if (!ultimaContagem) return null;
  return Math.round((Date.parse(`${hoje}T12:00:00Z`) - Date.parse(`${ultimaContagem}T12:00:00Z`)) / 86_400_000);
}
