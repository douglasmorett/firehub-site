/**
 * OS DOIS JEITOS DE PAGAR O FIREHUB — sem banco: a tela, os Termos, a landing
 * e o fechamento importam daqui.
 *
 * Douglas, 20/11/2026: "a cobrança é a pior parte: o cara faz 15 dias grátis e
 * depois leva mais uns 15 a 20 dias para ser cobrado". Decidiu:
 *
 * - Quem já usa fica como está (PERCENTUAL): 2% das vendas do mês, mínimo
 *   R$ 100, teto R$ 400, boleto no dia 1 com vencimento no dia 5
 *   (lib/firehub-billing.ts, lib/billing.ts).
 * - Conta criada a partir de 21/11/2026 (PRE_PAGO): "paga pra usar, não usa pra
 *   pagar". Acabou o teste, paga R$ 200 e libera o mês. A renovação é na MESMA
 *   DATA do mês seguinte ("não é todo dia 31 para pagar até o dia 5") e o valor
 *   sai do que a loja vendeu no ciclo que terminou: até R$ 10 mil, R$ 200;
 *   acima, R$ 400. Sem pagar, a loja não usa.
 *
 * A loja extra de uma conta (accountGroupId) segue a conta principal: o modelo
 * sai da data de criação da principal.
 */

/** 21/11/2026 00:00 em Brasília. Conta criada daqui em diante é pré-paga. */
export const VIRADA_DO_PRE_PAGO = new Date("2026-11-21T03:00:00.000Z");

export const PRE_PAGO = {
  /** Venda do ciclo ATÉ este valor paga o degrau de baixo. */
  LIMITE: 10_000,
  VALOR_ATE_O_LIMITE: 200,
  VALOR_ACIMA_DO_LIMITE: 400,
  /** A primeira cobrança, no fim do teste: ainda não há ciclo para medir. */
  VALOR_DA_ATIVACAO: 200,
} as const;

export type ModeloDeCobranca = "PERCENTUAL" | "PRE_PAGO";

/**
 * O modelo da loja. `criadaEm` é a data de criação da loja; `principalCriadaEm`,
 * a da loja principal da conta, quando a loja é extra (accountGroupId).
 */
export function modeloDaLoja(criadaEm: Date | string | null | undefined, principalCriadaEm?: Date | string | null): ModeloDeCobranca {
  const base = principalCriadaEm ?? criadaEm;
  if (!base) return "PERCENTUAL";
  return new Date(base).getTime() >= VIRADA_DO_PRE_PAGO.getTime() ? "PRE_PAGO" : "PERCENTUAL";
}

/** O valor da renovação, pela venda do ciclo que terminou. */
export function valorDaRenovacao(vendaDoCiclo: number): number {
  return vendaDoCiclo > PRE_PAGO.LIMITE ? PRE_PAGO.VALOR_ACIMA_DO_LIMITE : PRE_PAGO.VALOR_ATE_O_LIMITE;
}

/**
 * A mesma data no mês seguinte, no fuso da loja. Liberou dia 31 (ou 29/30) e o
 * mês seguinte não tem esse dia: renova no último dia do mês. A hora é a mesma.
 * `n` meses depois de `liberadaEm` (n = 1 é a primeira renovação).
 */
export function dataDaRenovacao(liberadaEm: Date | string, n = 1, timeZone = "America/Sao_Paulo"): Date {
  const d = new Date(liberadaEm);
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23" })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const ano = Number(partes.year), mes = Number(partes.month) - 1, dia = Number(partes.day);
  const alvoMes = mes + n;
  const ultimoDia = new Date(Date.UTC(ano, alvoMes + 1, 0)).getUTCDate();
  const diaAlvo = Math.min(dia, ultimoDia);
  // Mesmo horário de parede no fuso da loja: a diferença entre o relógio local e
  // o UTC de `liberadaEm` é o deslocamento (o Brasil não tem horário de verão).
  const comoUtc = Date.UTC(ano, mes, dia, Number(partes.hour), Number(partes.minute), Number(partes.second));
  const deslocamento = comoUtc - Math.floor(d.getTime() / 1000) * 1000;
  return new Date(Date.UTC(ano, alvoMes, diaAlvo, Number(partes.hour), Number(partes.minute), Number(partes.second)) - deslocamento);
}

/**
 * Conta pré-paga que terminou o teste e ainda não tem NENHUMA cobrança do
 * plano (nem emitida): fica travada até ativar — "paga pra usar". Isenta
 * (planPercent 0) nunca trava. Teste sem data = 15 dias do cadastro.
 */
export function prePagoSemAtivacao(loja: {
  criadaEm: Date | string;
  principalCriadaEm?: Date | string | null;
  trialEndsAt?: Date | string | null;
  planPercent?: number | null;
  temCobranca: boolean;
}, agora: Date = new Date()): boolean {
  if (loja.planPercent === 0) return false;
  if (modeloDaLoja(loja.criadaEm, loja.principalCriadaEm) !== "PRE_PAGO") return false;
  if (loja.temCobranca) return false;
  const fim = loja.trialEndsAt ? new Date(loja.trialEndsAt) : new Date(new Date(loja.criadaEm).getTime() + 15 * 86_400_000);
  return agora >= fim;
}

const reais = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const limite = `R$ ${PRE_PAGO.LIMITE.toLocaleString("pt-BR")}`;

/** O plano pré-pago em uma frase — landing, cadastro, robô e Termos dizem o mesmo. */
export const RESUMO_DO_PRE_PAGO = `${reais(PRE_PAGO.VALOR_ATE_O_LIMITE)} por mês para quem vende até ${limite} no mês, ${reais(PRE_PAGO.VALOR_ACIMA_DO_LIMITE)} para quem vende mais. Paga antes de usar: acabou o teste, paga ${reais(PRE_PAGO.VALOR_DA_ATIVACAO)} e libera o mês; renova na mesma data todo mês, pelo que vendeu no mês anterior.`;
