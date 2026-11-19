/**
 * lib/black-november.ts — a regra da janela "Black November FireHub" no painel
 * (components/customer/BlackNovember.tsx). Só regra pura: o banco e o Asaas
 * ficam em lib/black-november-no-banco.ts. Teste: scripts/teste-black-november.ts.
 *
 * A oferta (vault: Projetos/FireHub - Black November (nov-2026).md): 1 ano de
 * FireHub por R$ 4.000, em 12x de R$ 333,33 sem juros no cartão ou Pix à
 * vista, até 30/11/2026, plano anual sem devolução.
 *
 * ── A COPY MUDA POR LOJA, PARA SER VERDADE ─────────────────────────────────
 *
 * "Economize R$ 800 / 2 meses grátis" só é verdade para quem paga o teto:
 * 12 × R$ 400 = R$ 4.800. Quem paga menos não economiza nada no anual — para
 * essa loja o argumento é o valor fechado ("venda quanto quiser, a
 * mensalidade não sobe"). A variante "teto" sai das vendas que contam para a
 * mensalidade (lib/billing.ts, `vendasQueContam`): R$ 20 mil é onde os 2%
 * chegam nos R$ 400 (FIREHUB_PLAN.THRESHOLD).
 *
 * ── QUANTAS VEZES APARECE (Douglas, 19/11/2026) ───────────────────────────
 *
 * No máximo 1 vez por dia por loja (dia de Brasília, `ultimaExibicao`), até a
 * loja clicar em "Não ver mais" (`naoVerMais`) ou pagar o anual. Fechar no X,
 * Esc ou clique fora fecha só por agora; clicar para pagar e não pagar também
 * não para — volta no dia seguinte.
 *
 * ── O ANUAL PAGO ──────────────────────────────────────────────────────────
 *
 * Fica em `User.onboardingData.blackNovember2026.anual` = { de, ate } (meses
 * AAAA-MM, inclusive). `de` é o mês do pagamento — ou o mês em que o teste
 * grátis acaba, se for depois: quem paga no meio do teste não perde os dias
 * grátis. São 12 meses. O fechamento do mês (closeBillingCycle) não cobra a
 * MENSALIDADE de mês coberto; tráfego pago, totem e módulos à parte (Bill,
 * app, multimarcas…) continuam no boleto, porque não fazem parte do plano.
 */
import { FIREHUB_PLAN } from "@/lib/firehub-billing";

/** Chave dentro de `User.onboardingData`. */
export const CHAVE_DA_BLACK_NOVEMBER = "blackNovember2026";

/** A oferta vale até 30/11/2026 inteiro, no horário de Brasília. */
export const FIM_DA_BLACK_NOVEMBER = new Date("2026-12-01T00:00:00-03:00");

export const VALOR_DO_ANUAL = 4000;
export const PARCELAS_DO_ANUAL = 12;
/** 4000 / 12, cortado no centavo (o que se anuncia). */
export const VALOR_DA_PARCELA = Math.floor((VALOR_DO_ANUAL / PARCELAS_DO_ANUAL) * 100) / 100;
/** 12 × R$ 400 − R$ 4.000. */
export const ECONOMIA_NO_TETO = PARCELAS_DO_ANUAL * FIREHUB_PLAN.MAX_MONTHLY - VALOR_DO_ANUAL;

export const DESCRICAO_DA_COBRANCA = "Black November FireHub — plano anual";
export const PREFIXO_DA_REFERENCIA = "black-november:";

/** Loja recém-criada não vê: o primeiro dia é de montar a loja. */
export const HORAS_DE_LOJA_NOVA = 24;

export type Variante = "teto" | "fixo";
export type Forma = "cartao" | "pix";

export type CobrancaDaBlackNovember = {
  forma: Forma;
  asaasPaymentId: string;
  /** Cartão parcelado: o parcelamento do Asaas (cada parcela é um payment). */
  asaasInstallmentId?: string | null;
  invoiceUrl: string;
  valor: number;
  criadaEm: string;
  status: "PENDENTE" | "PAGA" | "CANCELADA";
  pagaEm?: string | null;
  simulada?: boolean;
};

export type EventoDaJanela = "exibiu" | "fechou" | "nao-ver-mais" | Forma;

export type EstadoDaBlackNovember = {
  /** Primeira vez que a janela abriu. */
  vistoEm?: string | null;
  /** Dia (AAAA-MM-DD, Brasília) da última vez que abriu: no máximo 1 por dia. */
  ultimaExibicao?: string | null;
  exibicoes?: number;
  /** Clicou em "Não ver mais": não volta nunca. */
  naoVerMais?: string | null;
  /** Como saiu da última vez: fechou, ou clicou para pagar. */
  saida?: "fechou" | "cartao" | "pix" | null;
  variante?: Variante | null;
  cobrancas?: CobrancaDaBlackNovember[];
  anual?: {
    de: string;
    ate: string;
    pagoEm: string;
    forma: Forma;
    asaasPaymentId: string;
    valor: number;
    estornadoEm?: string | null;
  } | null;
};

export function lerEstado(onboardingData: unknown): EstadoDaBlackNovember {
  const od = onboardingData && typeof onboardingData === "object" ? (onboardingData as Record<string, unknown>) : {};
  const e = od[CHAVE_DA_BLACK_NOVEMBER];
  return e && typeof e === "object" ? (e as EstadoDaBlackNovember) : {};
}

/** Soma `n` meses a "AAAA-MM". */
export function somarMeses(anoMes: string, n: number): string {
  const [a, m] = anoMes.split("-").map(Number);
  const total = a * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/** "AAAA-MM" de uma data no fuso da loja. */
export function anoMesNoFuso(quando: Date, fuso = "America/Sao_Paulo"): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: fuso, year: "numeric", month: "2-digit" }).formatToParts(quando);
  return `${p.find((x) => x.type === "year")!.value}-${p.find((x) => x.type === "month")!.value}`;
}

/** "AAAA-MM-DD" no horário de Brasília. */
export function diaEmBrasilia(quando: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(quando);
}

/** O que cada evento da janela grava (null = nada muda). */
export function registrarEvento(e: EstadoDaBlackNovember, evento: EventoDaJanela, variante: Variante | null, agora: Date): EstadoDaBlackNovember | null {
  const quando = agora.toISOString();
  if (evento === "exibiu") {
    return { ...e, vistoEm: e.vistoEm || quando, ultimaExibicao: diaEmBrasilia(agora), exibicoes: (e.exibicoes || 0) + 1, variante: variante ?? e.variante ?? null };
  }
  if (evento === "nao-ver-mais") return e.naoVerMais ? null : { ...e, naoVerMais: quando };
  return { ...e, saida: evento };
}

/** Os 12 meses que o anual cobre: do mês do pagamento (ou do fim do teste, se depois). */
export function mesesDoAnual(pagoEm: Date, fimDoTeste: Date | null | undefined, fuso = "America/Sao_Paulo") {
  const doPagamento = anoMesNoFuso(pagoEm, fuso);
  const doTeste = fimDoTeste ? anoMesNoFuso(new Date(fimDoTeste), fuso) : null;
  const de = doTeste && doTeste > doPagamento ? doTeste : doPagamento;
  return { de, ate: somarMeses(de, PARCELAS_DO_ANUAL - 1) };
}

/** O anual pago (e não estornado) cobre a mensalidade deste mês? */
export function anualCobreOMes(onboardingData: unknown, anoMes: string): boolean {
  const anual = lerEstado(onboardingData).anual;
  if (!anual || anual.estornadoEm) return false;
  return anoMes >= anual.de && anoMes <= anual.ate;
}

/** A loja tem um anual pago, valendo agora ou para a frente. */
export function temAnualPago(onboardingData: unknown, anoMesAtual: string): boolean {
  const anual = lerEstado(onboardingData).anual;
  return !!anual && !anual.estornadoEm && anual.ate >= anoMesAtual;
}

/**
 * Teto ou fixo. Conta a MAIOR das duas: o mês passado fechado (base da
 * mensalidade) e os últimos 30 dias corridos. Os 30 dias pegam quem entrou no
 * ritmo do teto agora; para loja com menos de 30 dias eles só podem
 * subestimar, então nunca prometem economia que não existe.
 */
export function varianteDaLoja(vendas: { mesPassado: number; ultimos30Dias: number }): Variante {
  return Math.max(vendas.mesPassado || 0, vendas.ultimos30Dias || 0) >= FIREHUB_PLAN.THRESHOLD ? "teto" : "fixo";
}

export type QuemVe = {
  agora: Date;
  /** Conta da sessão. */
  usuario: { role: string | null | undefined; ownerId: string | null | undefined };
  /** Sessão aberta pelo "Acessar" do admin. */
  acessoDoSuporte: boolean;
  loja: {
    email?: string | null;
    planPercent?: number | null;
    isFranqueadoHakim?: boolean | null;
    createdAt: Date | string;
    onboardingData?: unknown;
  };
  isenta: boolean;
  embaixador: boolean;
  produtosNoCardapio: number;
  fuso?: string;
};

export type MotivoDeNaoVer =
  | "acabou" | "nao-e-o-dono" | "suporte" | "isenta" | "embaixador"
  | "loja-nova" | "sem-cardapio" | "nao-quer-ver" | "ja-viu-hoje" | "anual-pago";

/**
 * Quem vê a janela. Ordem: o que vale para todos primeiro (a data), depois a
 * pessoa, depois a loja.
 *
 * Onboarding: loja com menos de 24 h OU sem nenhum produto no cardápio ainda
 * está se montando (o cadastro, a cópia do cardápio, a central de tutoriais
 * que abre no primeiro acesso). Assim que o cardápio tem produto e passou o
 * primeiro dia, a janela aparece uma vez.
 */
export function quemVe(e: QuemVe): { mostrar: true } | { mostrar: false; motivo: MotivoDeNaoVer } {
  const nao = (motivo: MotivoDeNaoVer) => ({ mostrar: false as const, motivo });
  if (e.agora >= FIM_DA_BLACK_NOVEMBER) return nao("acabou");
  if (String(e.usuario.role || "").toUpperCase() !== "FRANCHISEE" || e.usuario.ownerId) return nao("nao-e-o-dono");
  if (e.acessoDoSuporte) return nao("suporte");
  if (e.isenta) return nao("isenta");
  if (e.embaixador) return nao("embaixador");
  const estado = lerEstado(e.loja.onboardingData);
  if (temAnualPago(e.loja.onboardingData, anoMesNoFuso(e.agora, e.fuso))) return nao("anual-pago");
  if (estado.naoVerMais) return nao("nao-quer-ver");
  if (estado.ultimaExibicao && estado.ultimaExibicao >= diaEmBrasilia(e.agora)) return nao("ja-viu-hoje");
  if (e.agora.getTime() - new Date(e.loja.createdAt).getTime() < HORAS_DE_LOJA_NOVA * 3600_000) return nao("loja-nova");
  if (e.produtosNoCardapio <= 0) return nao("sem-cardapio");
  return { mostrar: true };
}

/** Vencimento da cobrança: 3 dias, sem passar de 30/11 (e nunca antes de hoje). */
export function vencimentoDaCobranca(agora: Date): string {
  const hoje = new Date(agora.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const em3 = new Date(hoje.getTime() + 3 * 86400_000);
  const ultimo = new Date(2026, 10, 30);
  const venc = em3 > ultimo ? (hoje > ultimo ? hoje : ultimo) : em3;
  return `${venc.getFullYear()}-${String(venc.getMonth() + 1).padStart(2, "0")}-${String(venc.getDate()).padStart(2, "0")}`;
}

/** O corpo do POST /payments do Asaas. Cartão: 12x sem juros (taxa por conta do FireHub). */
export function corpoDaCobranca(forma: Forma, cliente: string, lojaId: string, agora: Date) {
  const base = {
    customer: cliente,
    dueDate: vencimentoDaCobranca(agora),
    description: `${DESCRICAO_DA_COBRANCA} (loja ${lojaId})`,
    externalReference: `${PREFIXO_DA_REFERENCIA}${lojaId}`,
  };
  return forma === "cartao"
    ? { ...base, billingType: "CREDIT_CARD", installmentCount: PARCELAS_DO_ANUAL, totalValue: VALOR_DO_ANUAL }
    : { ...base, billingType: "PIX", value: VALOR_DO_ANUAL };
}

export function lojaDaReferencia(ref: string | null | undefined): string | null {
  const s = String(ref || "");
  return s.startsWith(PREFIXO_DA_REFERENCIA) ? s.slice(PREFIXO_DA_REFERENCIA.length) || null : null;
}

export function pagamentoConfirmado(evento: string | null | undefined, status: string | null | undefined) {
  return evento === "PAYMENT_RECEIVED" || evento === "PAYMENT_CONFIRMED"
    || status === "RECEIVED" || status === "CONFIRMED" || status === "RECEIVED_IN_CASH";
}

export function pagamentoDesfeito(evento: string | null | undefined, status: string | null | undefined) {
  return evento === "PAYMENT_REFUNDED" || evento === "PAYMENT_DELETED" || evento === "PAYMENT_CHARGEBACK_REQUESTED"
    || status === "REFUNDED" || status === "DELETED" || status === "CHARGEBACK_REQUESTED";
}

/**
 * O que o webhook faz com o estado da loja ao saber de um pagamento. Pura,
 * para o teste: devolve o estado novo (ou null se nada muda) e as OUTRAS
 * cobranças pendentes que devem ser apagadas no Asaas (pagou no Pix, o link
 * do cartão não pode continuar aberto).
 */
export function aplicarPagamento(
  estado: EstadoDaBlackNovember,
  pagamento: { id?: string | null; installment?: string | null; status?: string | null },
  evento: string | null | undefined,
  ctx: { agora: Date; fimDoTeste?: Date | null; fuso?: string },
): { estado: EstadoDaBlackNovember | null; apagar: CobrancaDaBlackNovember[]; resultado: "PAGO" | "ESTORNADO" | "SEM_MUDANCA" | "SEM_COBRANCA" } {
  const cobrancas = estado.cobrancas || [];
  const minha = cobrancas.find((c) => c.asaasPaymentId === pagamento.id || (!!pagamento.installment && c.asaasInstallmentId === pagamento.installment));
  if (!minha) return { estado: null, apagar: [], resultado: "SEM_COBRANCA" };

  if (pagamentoConfirmado(evento, pagamento.status)) {
    if (estado.anual && !estado.anual.estornadoEm) return { estado: null, apagar: [], resultado: "SEM_MUDANCA" };
    const quando = ctx.agora.toISOString();
    const outras = cobrancas.filter((c) => c !== minha && c.status === "PENDENTE");
    return {
      resultado: "PAGO",
      apagar: outras,
      estado: {
        ...estado,
        cobrancas: cobrancas.map((c) => c === minha ? { ...c, status: "PAGA", pagaEm: quando } : outras.includes(c) ? { ...c, status: "CANCELADA" } : c),
        anual: { ...mesesDoAnual(ctx.agora, ctx.fimDoTeste, ctx.fuso), pagoEm: quando, forma: minha.forma, asaasPaymentId: minha.asaasPaymentId, valor: minha.valor },
      },
    };
  }

  if (pagamentoDesfeito(evento, pagamento.status)) {
    // A cobrança que pagou o anual foi estornada: o anual deixa de cobrir
    // (o boleto mensal volta). Pendente apagada só sai da lista de reuso.
    if (minha.status === "PAGA" && estado.anual && estado.anual.asaasPaymentId === minha.asaasPaymentId && !estado.anual.estornadoEm) {
      return {
        resultado: "ESTORNADO",
        apagar: [],
        estado: { ...estado, anual: { ...estado.anual, estornadoEm: ctx.agora.toISOString() } },
      };
    }
    if (minha.status === "PENDENTE") {
      return { resultado: "SEM_MUDANCA", apagar: [], estado: { ...estado, cobrancas: cobrancas.map((c) => c === minha ? { ...c, status: "CANCELADA" } : c) } };
    }
  }
  return { estado: null, apagar: [], resultado: "SEM_MUDANCA" };
}
