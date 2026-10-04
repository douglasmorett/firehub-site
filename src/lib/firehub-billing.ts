/**
 * FireHub — Modelo de Mensalidade "Pay as You Grow"
 * 
 * Regras:
 *  - Faturamento = 0 e sem uso ativo → R$0 (sem cobrança)
 *  - Faturamento = 0 com uso ativo   → mínimo de R$100/mês
 *  - 2% do faturamento, no mínimo R$100 e no máximo R$400/mês
 *    (o teto chega em R$20.000 de faturamento)
 *  - TODO pedido gravado no sistema conta: cardápio digital, WhatsApp, mesa,
 *    balcão, totem e as integrações de iFood, 99Food e Jotajá. Só fica de fora
 *    o que está CANCELADO. Ver a base de cálculo em lib/billing.ts.
 *  - 1ª cobrança: após trial de 15 dias
 *  - Abatimento automático dos pagamentos online recebidos
 *  - Se saldo insuficiente: gera link boleto/PIX dia 1 do mês seguinte
 *
 * ── A taxa é do MÊS cobrado, não do dia em que a conta roda ─────────────────
 *
 * Até 03/10/2026 a taxa era 1% (teto em R$40.000). Desde 04/10/2026 é 2% —
 * mesmo piso e mesmo teto, só que o teto chega com metade do faturamento. O
 * fechamento de um mês roda DEPOIS que ele acaba (e um ciclo pode ser
 * recalculado/fechado dias depois), então usar a taxa "de hoje" cobraria
 * setembro a 2%. Quem calcula um mês específico passa o `yearMonth` dele para
 * `calcMensalidade`; sem mês, vale a taxa atual.
 *
 * Outubro/2026 é o mês da virada (dono, 04/10: "a partir de hoje dia 04"): as
 * vendas de 01 a 03/10 entram a 1% e as de 04/10 em diante a 2%, e o piso e o
 * teto valem sobre a SOMA do mês. Quem calcula outubro passa também
 * `vendasAntesDaVirada` (lib/billing.ts soma essa parte à parte).
 */

/** Mês (AAAA-MM) em que os 2% começam. Antes dele, 1%. */
export const MES_DOS_2_POR_CENTO = "2026-10";

/** Instante em que os 2% começam: 04/10/2026, meia-noite de Brasília. */
export const VIRADA_DOS_2_POR_CENTO = new Date("2026-10-04T00:00:00-03:00");

export const FIREHUB_PLAN = {
  PERCENT_RATE: 2,          // 2% sobre o faturamento (desde 2026-10)
  MIN_MONTHLY: 100,         // Mínimo R$100/mês
  MAX_MONTHLY: 400,         // Teto R$400/mês
  THRESHOLD: 20000,         // Faturamento em que os 2% chegam no teto
  TRIAL_DAYS: 15,           // Dias de trial gratuito
  // Marketplace: a primeira loja integrada é gratuita; cada loja adicional
  // ligada na MESMA conta custa isto por mês. Vale para iFood e 99Food.
  EXTRA_STORE_FEE: 50,
  PIX_RATE: 0.005,          // 0,5% por transação PIX
  PIX_FIXED: 0.40,          // R$0,40 fixo por transação PIX
  CREDIT_RATE: 0.0399,      // 3,99% cartão crédito (spread MDR)
  DEBIT_RATE: 0.0149,       // 1,49% débito
  VOUCHER_RATE: 0.0249,     // 2,49% voucher VR
  SPLIT_PLATFORM: 0.02,     // 2% do faturamento = mensalidade via split
};

/**
 * Percentual de um mês (AAAA-MM) — o que vale para o mês daqui em diante, para
 * mostrar na tela. Sem mês = o atual. Em outubro/2026 as vendas de 01 a 03
 * ainda são 1%: para a conta de verdade, `calcMensalidade` com
 * `vendasAntesDaVirada`; para uma venda só, `percentualDaVenda`.
 */
export function percentualDoMes(yearMonth?: string | null): number {
  if (yearMonth && yearMonth < MES_DOS_2_POR_CENTO) return 1;
  return FIREHUB_PLAN.PERCENT_RATE;
}

/** Percentual que incide sobre uma venda feita em `quando`. */
export function percentualDaVenda(quando: Date | string): number {
  return new Date(quando) < VIRADA_DOS_2_POR_CENTO ? 1 : FIREHUB_PLAN.PERCENT_RATE;
}

/**
 * Calcula a mensalidade do mês com base no faturamento FireHub
 * 
 * Regra especial:
 * - Se faturamento = 0 e a conta não tem uso ativo → cobra R$0
 * - Se faturamento > 0 ou tiver uso ativo → mínimo de R$100 se aplica
 *
 * `yearMonth` é o mês que está sendo cobrado (ver MES_DOS_2_POR_CENTO).
 * `vendasAntesDaVirada` é a parte de `faturamentoMes` feita antes de
 * 04/10/2026, cobrada a 1% (só existe em outubro/2026).
 */
export function calcMensalidade(faturamentoMes: number, hasActiveUsage: boolean = false, yearMonth?: string | null, vendasAntesDaVirada: number = 0): {
  mensalidade: number;
  modelo: "zero" | "percentual" | "fixo";
  faturamento: number;
  economia: number; // Quanto economiza vs concorrência (que cobra 4%)
  economiaAnual: number;
} {
  let mensalidade: number;
  let modelo: "zero" | "percentual" | "fixo";

  const percentual = percentualDoMes(yearMonth);
  const aUmPorCento = percentual > 1 ? Math.min(Math.max(0, vendasAntesDaVirada), faturamentoMes) : 0;
  const bruto = (faturamentoMes - aUmPorCento) * (percentual / 100) + aUmPorCento * 0.01;

  // REGRA PRINCIPAL: sem vendas E sem uso ativo = sem cobrança
  if (faturamentoMes === 0 && !hasActiveUsage) {
    mensalidade = 0;
    modelo = "zero";
  } else if (bruto >= FIREHUB_PLAN.MAX_MONTHLY) {
    mensalidade = FIREHUB_PLAN.MAX_MONTHLY; // R$400 fixo
    modelo = "fixo";
  } else {
    // Percentual do faturamento, com mínimo de R$100
    mensalidade = Math.max(FIREHUB_PLAN.MIN_MONTHLY, bruto);
    modelo = "percentual";
  }

  // Economia vs concorrência (que cobra 4% com teto diferente)
  const concorrenciaMensalidade = faturamentoMes === 0 ? 0
    : Math.min(
        Math.max(60, faturamentoMes * 0.04), // 4% com mín R$60
        500                                   // teto da concorrência
      );

  const economia = concorrenciaMensalidade - mensalidade;
  const economiaAnual = economia * 12;

  return { mensalidade, modelo, faturamento: faturamentoMes, economia, economiaAnual };
}

/**
 * Calcula quanto deve ser cobrado considerando dívida acumulada de meses anteriores
 * Se o lojista não vendeu nos meses anteriores mas teve mísero meses com cobrança,
 * o sistema tenta cobrar a dívida acumulada junto com o mês atual.
 */
export function calcCobrancaComAcumulado(
  faturamentoMes: number,
  dividaAcumulada: number = 0,
  hasActiveUsage: boolean = false
): {
  mensalidadeBase: number;    // Cobrança do mês atual
  dividaAnterior: number;      // Dívida de meses anteriores
  totalDevido: number;         // Total a cobrar (base + dívida)
  modelo: "zero" | "percentual" | "fixo";
} {
  const { mensalidade, modelo } = calcMensalidade(faturamentoMes, hasActiveUsage);
  const totalDevido = mensalidade + dividaAcumulada;
  return {
    mensalidadeBase: mensalidade,
    dividaAnterior: dividaAcumulada,
    totalDevido,
    modelo,
  };
}

/**
 * Calcula taxa por transação PIX
 */
export function calcTaxaPix(valorPedido: number): number {
  return valorPedido * FIREHUB_PLAN.PIX_RATE + FIREHUB_PLAN.PIX_FIXED;
}

/**
 * Calcula taxa por transação cartão
 */
export function calcTaxaCartao(
  valorPedido: number,
  metodo: "credit_card" | "debit_card" | "voucher"
): number {
  const rate = metodo === "credit_card"
    ? FIREHUB_PLAN.CREDIT_RATE
    : metodo === "debit_card"
    ? FIREHUB_PLAN.DEBIT_RATE
    : FIREHUB_PLAN.VOUCHER_RATE;
  return valorPedido * rate;
}

/**
 * Simula o extrato mensal do restaurante
 */
export function simularExtrato(faturamento: number, pedidosPix: number, ticketMedio: number) {
  // Na simulação assumimos que a conta tem uso se faturou > 0
  const { mensalidade, modelo } = calcMensalidade(faturamento, faturamento > 0);
  const totalTaxasPix = pedidosPix * calcTaxaPix(ticketMedio);
  const liquido = faturamento - mensalidade - totalTaxasPix;

  return {
    faturamentoBruto: faturamento,
    mensalidade,
    modelo,
    totalTaxasPix,
    liquido,
    percentualTotal: ((mensalidade + totalTaxasPix) / (faturamento || 1) * 100).toFixed(1),
  };
}
