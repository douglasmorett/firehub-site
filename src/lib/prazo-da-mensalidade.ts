/**
 * src/lib/prazo-da-mensalidade.ts — AS DUAS DATAS DO BOLETO DA MENSALIDADE.
 *
 * O boleto do mês M VENCE no dia 5 de M+1 (é a data que o Asaas imprime). O
 * painel da loja só BLOQUEIA depois do dia 10: boleto pago no dia 5 leva um dia
 * útil para compensar, e a loja não pode travar em pleno movimento por isso.
 *
 * A folga é só do bloqueio — nunca aparece para a loja como prazo. Para ela o
 * prazo é o dia 5; depois dele o boleto já cobra juros (2% ao mês) e multa
 * (4%), o padrão da conta no Asaas (dono, 02/10/2026).
 *
 * Até 02/10/2026 o banco guardava só o bloqueio (fechamento + 10 dias, no
 * cron) e o painel, o robô de atendimento e a tela de bloqueio mostravam essa
 * data como vencimento: o boleto de setembro vencia em 05/10 e a loja lia
 * "faltam 9 dias", contando até 11/10. Dono: "se todos vencem dia 5, por que o
 * sistema fala que tem até dia 10?". `dueDate` continua sendo o bloqueio; o
 * vencimento sai sempre daqui, do `yearMonth`.
 *
 * Datas de Brasília (UTC−3, sem horário de verão desde 2019).
 */

const BRASILIA = 3; // horas a somar para ir de meia-noite em Brasília para UTC

/** "2026-09" → "2026-10". */
export function mesSeguinte(yearMonth: string): string {
  const [a, m] = yearMonth.split("-").map(Number);
  const total = a * 12 + (m - 1) + 1;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/** Fim do dia `dia` do mês seguinte a `yearMonth`, em Brasília (= início do dia seguinte). */
function fimDoDia(yearMonth: string, dia: number): Date {
  const [a, m] = mesSeguinte(yearMonth).split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, dia + 1, BRASILIA, 0, 0));
}

/**
 * Vencimento do boleto: dia 5 do mês seguinte. `vencidoDepoisDe` = fim do
 * dia 5 em Brasília (06/10 às 03:00 UTC para o boleto de setembro).
 */
export function vencimentoDoBoleto(yearMonth: string): { dia: string; vencidoDepoisDe: Date } {
  const [a, m] = mesSeguinte(yearMonth).split("-").map(Number);
  return {
    dia: `${a}-${String(m).padStart(2, "0")}-05`,
    vencidoDepoisDe: fimDoDia(yearMonth, 5),
  };
}

/**
 * Atraso: multa de 2% (uma vez) e juros de 1% ao mês, pro rata dia — o Asaas
 * calcula. É o teto que vale para qualquer lojista: CDC art. 52 §1º (multa) e
 * Lei de Usura (juros) seguram quem entra com CPF; entre empresas a Lei
 * 14.905/2024 tirou o teto dos juros, mas multa alta vira briga (CC art. 413).
 * É também o que o mercado cobra (termos do CardápioWeb, 3.8: 2% + 1% a.m.).
 * Sem isto no POST /payments o boleto saía com o padrão da conta no Asaas
 * (multa 4%, juros 2% a.m.), que é o da Icebox, não o do FireHub.
 */
export const MULTA_POR_ATRASO_PCT = 2;
export const JUROS_AO_MES_PCT = 1;

/** Dia do bloqueio: "pague até o dia 10". */
export const DIA_DO_BLOQUEIO = 10;

/**
 * A partir de quando o painel trava: fim do dia 10 do mês seguinte, em
 * Brasília. Fechamento atrasado (feito à mão depois do dia 5) ganha pelo
 * menos 5 dias a partir do fechamento, para a loja não ser travada no dia em
 * que recebe o boleto.
 */
export function bloqueioDaMensalidade(yearMonth: string, fechadoEm: Date = new Date()): Date {
  const doCalendario = fimDoDia(yearMonth, DIA_DO_BLOQUEIO);
  const minimo = new Date(fechadoEm.getTime() + 5 * 86_400_000);
  return doCalendario > minimo ? doCalendario : minimo;
}

/**
 * O bloqueio de um ciclo já fechado. Calculado pelo mês, NÃO lido do
 * `dueDate`: os ciclos de setembro/2026 gravaram "fechamento + 10 dias" (11/10
 * às 00h28) e a faixa diria "pague até 11/10". O `dueDate` fica só como
 * registro. Sem `closedAt`, vale o calendário puro.
 */
export function bloqueioDoCiclo(ciclo: { yearMonth: string; closedAt?: Date | string | null }): Date {
  return bloqueioDaMensalidade(ciclo.yearMonth, ciclo.closedAt ? new Date(ciclo.closedAt) : new Date(0));
}

/** "2026-10-05" → "05/10". */
export function diaEMes(isoDia: string): string {
  const [, m, d] = isoDia.slice(0, 10).split("-");
  return `${d}/${m}`;
}

/** O dia de Brasília de um instante: "2026-10-02". */
export function diaEmBrasilia(instante: Date): string {
  return new Date(instante.getTime() - BRASILIA * 3_600_000).toISOString().slice(0, 10);
}

/** Dias de calendário (Brasília) de hoje até `isoDia`; negativo se já passou. */
export function diasAte(isoDia: string, agora: Date = new Date()): number {
  const hoje = Date.parse(diaEmBrasilia(agora) + "T00:00:00Z");
  const alvo = Date.parse(isoDia.slice(0, 10) + "T00:00:00Z");
  return Math.round((alvo - hoje) / 86_400_000);
}
