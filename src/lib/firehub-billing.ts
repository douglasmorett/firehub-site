/**
 * FireHub — Modelo de Mensalidade "Pay as You Grow"
 * 
 * Regras:
 *  - Faturamento = 0 e sem uso ativo → R$0 (sem cobrança)
 *  - Faturamento = 0 com uso ativo   → mínimo de R$100/mês
 *  - Faturamento < R$40.000/mês      → 1% do faturamento (mín R$100)
 *  - Faturamento ≥ R$40.000/mês      → R$400 fixo (teto máximo)
 *  - TODO pedido gravado no sistema conta: cardápio digital, WhatsApp, mesa,
 *    balcão, totem e as integrações de iFood, 99Food e Jotajá. Só fica de fora
 *    o que está CANCELADO. Ver a base de cálculo em lib/billing.ts.
 *  - 1ª cobrança: após trial de 15 dias
 *  - Abatimento automático dos pagamentos online recebidos
 *  - Se saldo insuficiente: gera link boleto/PIX dia 1 do mês seguinte
 *
 * ✅ Diferencial: Concorrência cobra 4% — FireHub cobra apenas 1%
 *    mantendo piso de R$100 e teto de R$400.
 */

export const FIREHUB_PLAN = {
  PERCENT_RATE: 1,          // 1% sobre o faturamento
  MIN_MONTHLY: 100,         // Mínimo R$100/mês
  MAX_MONTHLY: 400,         // Teto R$400/mês
  THRESHOLD: 40000,         // A partir de R$40.000, vai pro teto fixo
  TRIAL_DAYS: 15,           // Dias de trial gratuito
  // Marketplace: a primeira loja integrada é gratuita; cada loja adicional
  // ligada na MESMA conta custa isto por mês. Vale para iFood e 99Food.
  EXTRA_STORE_FEE: 50,
  PIX_RATE: 0.005,          // 0,5% por transação PIX
  PIX_FIXED: 0.40,          // R$0,40 fixo por transação PIX
  CREDIT_RATE: 0.0399,      // 3,99% cartão crédito (spread MDR)
  DEBIT_RATE: 0.0149,       // 1,49% débito
  VOUCHER_RATE: 0.0249,     // 2,49% voucher VR
  SPLIT_PLATFORM: 0.01,     // 1% do faturamento = mensalidade via split
};

/**
 * Calcula a mensalidade do mês com base no faturamento FireHub
 * 
 * Regra especial:
 * - Se faturamento = 0 e a conta não tem uso ativo → cobra R$0
 * - Se faturamento > 0 ou tiver uso ativo → mínimo de R$100 se aplica
 */
export function calcMensalidade(faturamentoMes: number, hasActiveUsage: boolean = false): {
  mensalidade: number;
  modelo: "zero" | "percentual" | "fixo";
  faturamento: number;
  economia: number; // Quanto economiza vs concorrência (que cobra 4%)
  economiaAnual: number;
} {
  let mensalidade: number;
  let modelo: "zero" | "percentual" | "fixo";

  // REGRA PRINCIPAL: sem vendas E sem uso ativo = sem cobrança
  if (faturamentoMes === 0 && !hasActiveUsage) {
    mensalidade = 0;
    modelo = "zero";
  } else if (faturamentoMes >= FIREHUB_PLAN.THRESHOLD) {
    mensalidade = FIREHUB_PLAN.MAX_MONTHLY; // R$400 fixo
    modelo = "fixo";
  } else {
    // 1% do faturamento, com mínimo de R$100
    mensalidade = Math.max(
      FIREHUB_PLAN.MIN_MONTHLY,
      faturamentoMes * (FIREHUB_PLAN.PERCENT_RATE / 100)
    );
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
