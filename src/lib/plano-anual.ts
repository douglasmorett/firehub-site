/**
 * lib/plano-anual.ts — "pague o ano e economize 2 mensalidades", oferecido na
 * hora de pagar a fatura para quem paga a mensalidade máxima (R$ 400). Só
 * regra pura; banco e Asaas em lib/plano-anual-no-banco.ts. Teste:
 * scripts/teste-plano-anual.ts.
 *
 * Douglas, 20/11/2026: "oferecer para quem já paga 400,00 pagar o anual e
 * economizar 2 meses de mensalidade sempre que ele for pagar".
 *
 * ── A CONTA ────────────────────────────────────────────────────────────────
 *
 * A fatura em aberto JÁ TEM a mensalidade de R$ 400 daquele mês. O anual cobre
 * esse mês e os 11 seguintes: o lojista paga a fatura + R$ 3.600 (11 × 400 − 2
 * × 400), ou seja R$ 4.000 de mensalidade por 12 meses no lugar de R$ 4.800.
 * Módulos, lojas extras, tráfego e totem continuam cobrados todo mês, como no
 * anual da Black November (não fazem parte do plano). Quem pagou o anual não
 * recebe outra oferta enquanto ele valer.
 *
 * ── QUEM VÊ ────────────────────────────────────────────────────────────────
 *
 * Fatura com a mensalidade em R$ 400 — o teto do plano de 2% e a faixa de
 * cima do pré-pago. "Economize R$ 800" só é verdade para quem paga 400 (a
 * mesma razão da variante "teto" da Black November).
 *
 * ── O ANUAL PAGO ───────────────────────────────────────────────────────────
 *
 * Fica em `User.onboardingData.planoAnual.anual` = { de, ate } (meses AAAA-MM
 * do ciclo, inclusive). O mês do ciclo é o mês de USO no plano de 2% (a
 * fatura de novembro vence em 05/12) e o mês da renovação no pré-pago (uma
 * por mês) — nos dois, `de` é o ciclo da fatura que o anual pagou.
 */
import { anualCobreOMes as blackNovemberCobreOMes, lerEstado as lerBlackNovember, pagamentoConfirmado, pagamentoDesfeito, somarMeses } from "@/lib/black-november";

export const CHAVE_DO_PLANO_ANUAL = "planoAnual";
export const PREFIXO_DO_ANUAL = "anual:";

/** A mensalidade de quem recebe a oferta. */
export const MENSALIDADE_CHEIA = 400;
export const MESES_DO_ANUAL = 12;
export const MESES_PAGOS = 10;
export const VALOR_DO_ANUAL = MENSALIDADE_CHEIA * MESES_PAGOS; // 4.000
export const ECONOMIA_DO_ANUAL = MENSALIDADE_CHEIA * (MESES_DO_ANUAL - MESES_PAGOS); // 800

export type CobrancaDoAnual = {
  cicloId: string;
  yearMonth: string;
  asaasPaymentId: string;
  invoiceUrl: string;
  valor: number;
  criadaEm: string;
  status: "PENDENTE" | "PAGA" | "CANCELADA";
  pagaEm?: string | null;
};

export type EstadoDoPlanoAnual = {
  cobrancas?: CobrancaDoAnual[];
  anual?: {
    de: string;
    ate: string;
    cicloId: string;
    asaasPaymentId: string;
    valor: number;
    pagoEm: string;
    estornadoEm?: string | null;
  } | null;
};

export function lerPlanoAnual(onboardingData: unknown): EstadoDoPlanoAnual {
  const od = onboardingData && typeof onboardingData === "object" ? (onboardingData as Record<string, unknown>) : {};
  const e = od[CHAVE_DO_PLANO_ANUAL];
  return e && typeof e === "object" ? (e as EstadoDoPlanoAnual) : {};
}

/** Algum anual pago (este ou o da Black November) cobre a mensalidade deste mês? */
export function anualCobreOMes(onboardingData: unknown, anoMes: string): boolean {
  if (blackNovemberCobreOMes(onboardingData, anoMes)) return true;
  const a = lerPlanoAnual(onboardingData).anual;
  return !!a && !a.estornadoEm && anoMes >= a.de && anoMes <= a.ate;
}

/** Até que mês o anual vale, se cobre `anoMes` (para a tela dizer "pago até…"). */
export function anualAte(onboardingData: unknown, anoMes: string): string | null {
  const a = lerPlanoAnual(onboardingData).anual;
  if (a && !a.estornadoEm && anoMes >= a.de && anoMes <= a.ate) return a.ate;
  const bn = lerBlackNovember(onboardingData).anual;
  if (bn && !bn.estornadoEm && anoMes >= bn.de && anoMes <= bn.ate) return bn.ate;
  return null;
}

/** Tem um anual valendo agora ou para a frente — não oferece de novo. */
function temAnualValendo(onboardingData: unknown, anoMes: string): boolean {
  const a = lerPlanoAnual(onboardingData).anual;
  const bn = lerBlackNovember(onboardingData).anual;
  return (!!a && !a.estornadoEm && a.ate >= anoMes) || (!!bn && !bn.estornadoEm && bn.ate >= anoMes);
}

/** Valor da cobrança do anual em cima desta fatura: ela + 11 meses − 2 de presente. */
export function valorDoAnualNaFatura(valorDaFatura: number): number {
  return parseFloat((valorDaFatura + VALOR_DO_ANUAL - MENSALIDADE_CHEIA).toFixed(2));
}

export type OfertaDoAnual = { valor: number; economia: number; de: string; ate: string };

/**
 * A fatura em aberto mostra a oferta? Mensalidade (amountDue do ciclo) de
 * R$ 400, loja não isenta, sem anual valendo, e não é a ativação do pré-pago.
 */
export function ofertaDoAnual(f: {
  yearMonth: string;
  mensalidade: number;
  valorDaFatura: number;
  isenta: boolean;
  onboardingData: unknown;
  ativacao?: boolean;
}): OfertaDoAnual | null {
  if (f.isenta || f.ativacao) return null;
  if (f.mensalidade < MENSALIDADE_CHEIA) return null;
  if (temAnualValendo(f.onboardingData, f.yearMonth)) return null;
  return { valor: valorDoAnualNaFatura(f.valorDaFatura), economia: ECONOMIA_DO_ANUAL, de: f.yearMonth, ate: somarMeses(f.yearMonth, MESES_DO_ANUAL - 1) };
}

export function cicloDaReferenciaDoAnual(ref: string | null | undefined): string | null {
  const s = String(ref || "");
  return s.startsWith(PREFIXO_DO_ANUAL) ? s.slice(PREFIXO_DO_ANUAL.length) || null : null;
}

/**
 * O que o webhook faz com o estado ao saber de um pagamento do anual. Pura.
 * `cicloJaPagoPorOutra`: a fatura do mês já tinha sido paga pela cobrança
 * mensal — o anual então começa no mês SEGUINTE (o lojista não perde mês).
 */
export function aplicarPagamentoDoAnual(
  estado: EstadoDoPlanoAnual,
  pagamento: { id?: string | null; status?: string | null },
  evento: string | null | undefined,
  ctx: { agora: Date; cicloJaPagoPorOutra?: boolean },
): { estado: EstadoDoPlanoAnual | null; resultado: "PAGO" | "ESTORNADO" | "SEM_MUDANCA" | "SEM_COBRANCA"; cobranca?: CobrancaDoAnual } {
  const cobrancas = estado.cobrancas || [];
  const minha = cobrancas.find((c) => c.asaasPaymentId === pagamento.id);
  if (!minha) return { estado: null, resultado: "SEM_COBRANCA" };

  if (pagamentoConfirmado(evento, pagamento.status)) {
    if (estado.anual && !estado.anual.estornadoEm) return { estado: null, resultado: "SEM_MUDANCA", cobranca: minha };
    const quando = ctx.agora.toISOString();
    const de = ctx.cicloJaPagoPorOutra ? somarMeses(minha.yearMonth, 1) : minha.yearMonth;
    return {
      resultado: "PAGO",
      cobranca: minha,
      estado: {
        ...estado,
        cobrancas: cobrancas.map((c) => c === minha ? { ...c, status: "PAGA", pagaEm: quando } : c.status === "PENDENTE" ? { ...c, status: "CANCELADA" } : c),
        anual: { de, ate: somarMeses(de, MESES_DO_ANUAL - 1), cicloId: minha.cicloId, asaasPaymentId: minha.asaasPaymentId, valor: minha.valor, pagoEm: quando },
      },
    };
  }

  if (pagamentoDesfeito(evento, pagamento.status)) {
    if (minha.status === "PAGA" && estado.anual?.asaasPaymentId === minha.asaasPaymentId && !estado.anual.estornadoEm) {
      return { resultado: "ESTORNADO", cobranca: minha, estado: { ...estado, anual: { ...estado.anual, estornadoEm: ctx.agora.toISOString() } } };
    }
    if (minha.status === "PENDENTE") {
      return { resultado: "SEM_MUDANCA", cobranca: minha, estado: { ...estado, cobrancas: cobrancas.map((c) => c === minha ? { ...c, status: "CANCELADA" } : c) } };
    }
  }
  return { estado: null, resultado: "SEM_MUDANCA", cobranca: minha };
}
