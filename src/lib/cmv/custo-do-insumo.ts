/**
 * Quanto vale cada insumo num dia: a base para valorizar a contagem.
 *
 * ── Insumo comprado ─────────────────────────────────────────────────────────
 *
 * O custo é o da ÚLTIMA COMPRA lançada até aquele dia (custo de reposição). Sem
 * compra lançada, vale o custo do cadastro (`StockItem.unitCost`), que é como o
 * estoque trabalhava até aqui. `unitCost` sozinho não serve para o passado: a
 * nota de hoje sobrescreve, e a contagem da semana passada seria revalorizada
 * pelo preço de hoje. Por isso cada entrada de compra guarda o custo dela
 * (StockTransaction.unitCost).
 *
 * ── Preparo (massa, recheio) ────────────────────────────────────────────────
 *
 * Não tem nota. Custa a soma dos componentes de UM lote ÷ o rendimento do lote:
 * 1 kg de carne + 200 g de tomate + ... rende 1.315 g de recheio, então o grama
 * do recheio pronto custa (Σ componentes) ÷ 1.315. Um preparo pode usar outro
 * (a mistura de 3 queijos no recheio), até 5 níveis; um ciclo (A usa B que usa
 * A) não trava a conta: o componente do ciclo entra sem custo e o preparo sai
 * marcado como incompleto.
 *
 * Puro: quem busca no banco é src/lib/cmv/painel.ts e a rota da contagem.
 */

export type InsumoParaCusto = {
  id: string;
  nome: string;
  unidade: string;
  /** "PREPARO" ou outra coisa (insumo comprado). */
  tipo: string | null;
  rendimento: number | null;
  /** O custo do cadastro: o da última nota, ou o digitado à mão. */
  unitCost: number | null;
  componentes: { insumoId: string; quantidade: number }[];
};

/**
 * Uma entrada de compra com o custo daquela hora. `em` desempata no mesmo dia.
 * `custoAnterior` é o custo do cadastro logo ANTES desta compra.
 */
export type EntradaComCusto = { stockItemId: string; dia: string; em: number; unitCost: number; custoAnterior?: number | null };

export type FonteDoCusto = "COMPRA" | "CADASTRO" | "PREPARO" | "SEM_CUSTO";

export type CustoNoDia = {
  custo: number | null;
  fonte: FonteDoCusto;
  /** Preparo com componente sem custo, sem rendimento ou em ciclo. */
  incompleto: boolean;
};

export const ehPreparo = (i: { tipo: string | null | undefined }) => String(i.tipo || "").toUpperCase() === "PREPARO";

/** O custo da última compra de cada insumo até o dia (inclusive). */
export function ultimaCompraAte(entradas: EntradaComCusto[], dia: string): Map<string, number> {
  const ultima = new Map<string, { dia: string; em: number; custo: number }>();
  for (const e of entradas) {
    if (!(e.unitCost > 0) || !Number.isFinite(e.unitCost)) continue;
    if (e.dia > dia) continue;
    const atual = ultima.get(e.stockItemId);
    if (!atual || e.dia > atual.dia || (e.dia === atual.dia && e.em >= atual.em)) {
      ultima.set(e.stockItemId, { dia: e.dia, em: e.em, custo: e.unitCost });
    }
  }
  return new Map([...ultima].map(([id, v]) => [id, v.custo]));
}

const PROFUNDIDADE_MAXIMA = 5;

/**
 * O custo de cada insumo no dia. Preparos pela receita, comprados pela última
 * compra até o dia, senão pelo cadastro.
 */
export function custosNoDia(insumos: InsumoParaCusto[], entradas: EntradaComCusto[], dia: string): Map<string, CustoNoDia> {
  const porId = new Map(insumos.map((i) => [i.id, i]));
  const compra = ultimaCompraAte(entradas, dia);
  // Sem compra até o dia, o custo do cadastro de HOJE pode já ter sido trocado
  // por uma compra posterior. A primeira compra depois do dia guardou o custo
  // que o cadastro tinha antes dela: é esse que valia no dia.
  const cadastroNoDia = new Map<string, number>();
  const primeiraDepois = new Map<string, EntradaComCusto>();
  for (const en of entradas) {
    if (en.dia <= dia || en.custoAnterior === undefined) continue;
    const atual = primeiraDepois.get(en.stockItemId);
    if (!atual || en.dia < atual.dia || (en.dia === atual.dia && en.em < atual.em)) primeiraDepois.set(en.stockItemId, en);
  }
  for (const [id, en] of primeiraDepois) if (en.custoAnterior != null && en.custoAnterior > 0) cadastroNoDia.set(id, en.custoAnterior);
  const saida = new Map<string, CustoNoDia>();

  const custoDe = (id: string, caminho: string[]): CustoNoDia => {
    const pronto = saida.get(id);
    if (pronto) return pronto;
    const insumo = porId.get(id);
    if (!insumo) return { custo: null, fonte: "SEM_CUSTO", incompleto: true };

    if (!ehPreparo(insumo)) {
      const c = compra.get(id);
      if (c != null) return { custo: c, fonte: "COMPRA", incompleto: false };
      const doDia = cadastroNoDia.get(id);
      if (doDia != null) return { custo: doDia, fonte: "CADASTRO", incompleto: false };
      if (primeiraDepois.has(id)) return { custo: null, fonte: "SEM_CUSTO", incompleto: false };
      if (insumo.unitCost != null && insumo.unitCost > 0 && Number.isFinite(insumo.unitCost)) {
        return { custo: insumo.unitCost, fonte: "CADASTRO", incompleto: false };
      }
      return { custo: null, fonte: "SEM_CUSTO", incompleto: false };
    }

    // Preparo sem receita ainda: vale o custo digitado à mão, se houver.
    const rendimento = Number(insumo.rendimento);
    if (!insumo.componentes.length || !(rendimento > 0)) {
      if (insumo.unitCost != null && insumo.unitCost > 0) return { custo: insumo.unitCost, fonte: "CADASTRO", incompleto: true };
      return { custo: null, fonte: "SEM_CUSTO", incompleto: true };
    }

    let total = 0;
    let incompleto = false;
    for (const comp of insumo.componentes) {
      const q = Number(comp.quantidade);
      if (!(q > 0)) continue;
      if (caminho.includes(comp.insumoId) || caminho.length >= PROFUNDIDADE_MAXIMA) { incompleto = true; continue; }
      const c = custoDe(comp.insumoId, [...caminho, comp.insumoId]);
      if (c.custo == null) { incompleto = true; continue; }
      if (c.incompleto) incompleto = true;
      total += q * c.custo;
    }
    return { custo: total > 0 ? total / rendimento : null, fonte: total > 0 ? "PREPARO" : "SEM_CUSTO", incompleto };
  };

  for (const i of insumos) saida.set(i.id, custoDe(i.id, [i.id]));
  return saida;
}

/**
 * Quanto de cada insumo COMPRADO existe dentro de uma quantidade de preparo:
 * 1.315 g de recheio de carne "contém" 1 kg de carne moída. Serve para mostrar
 * o consumo do insumo de verdade (o que se compra) quando o estoque está em
 * forma de recheio pronto.
 */
export function explodirPreparo(
  insumos: InsumoParaCusto[],
  preparoId: string,
  quantidade: number,
): Map<string, number> {
  const porId = new Map(insumos.map((i) => [i.id, i]));
  const saida = new Map<string, number>();
  const descer = (id: string, q: number, caminho: string[]) => {
    const i = porId.get(id);
    if (!i) return;
    const rend = Number(i.rendimento);
    if (!ehPreparo(i) || !i.componentes.length || !(rend > 0) || caminho.length >= PROFUNDIDADE_MAXIMA) {
      saida.set(id, (saida.get(id) || 0) + q);
      return;
    }
    for (const c of i.componentes) {
      if (caminho.includes(c.insumoId)) continue;
      descer(c.insumoId, (q * Number(c.quantidade)) / rend, [...caminho, c.insumoId]);
    }
  };
  descer(preparoId, quantidade, [preparoId]);
  return saida;
}
