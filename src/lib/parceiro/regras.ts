/**
 * AS REGRAS DO PARCEIRO DA FIREHUB — embaixador, rede e vendedor.
 *
 * Três perguntas, uma resposta cada, para o portal (lib/parceiro/relatorio.ts),
 * para o split do Asaas (lib/billing.ts, pelo `splitDaLoja`) e para o
 * teste (scripts/teste-relatorio-do-parceiro.ts) lerem a MESMA conta:
 *
 *   1. Em que papel o parceiro está nesta loja — e quanto ganha nela.
 *   2. A comissão cai de verdade? O split do fechamento tem condições (carteira
 *      no Asaas, conta ativa, teto de 40%) que o portal precisa mostrar.
 *   3. Em que pé está a mensalidade que paga a comissão: em andamento, paga,
 *      a vencer, vencida, sem boleto ou sem cobrança.
 *
 * Regra do Douglas de 18/10/2026 (substitui a de 27/09): a indicação de
 * EMBAIXADOR é recorrente (o % dele enquanto a loja paga, atenda quem
 * atender); entre os VENDEDORES ganha quem atende — 10% na loja do link de
 * vendedor dele, 3% na atribuída; quem convidou como vendedor e não atende não
 * leva nada. Ver `indicacaoDeEmbaixador` e `vendedorQueAtende`.
 *
 * Sem Prisma nem "@/…": roda puro no teste.
 */

// Vencimento (dia 5) e bloqueio (depois do dia 10) moram em lib/prazo-da-mensalidade.ts.
import { bloqueioDoCiclo, mesSeguinte, vencimentoDoBoleto } from "../prazo-da-mensalidade";

export type Papel = "EMBAIXADOR" | "REDE" | "VENDEDOR";
export const PAPEIS: Papel[] = ["EMBAIXADOR", "REDE", "VENDEDOR"];

/**
 * Acima disto o boleto sai SEM split nenhum (lib/billing.ts lê daqui). O padrão
 * é 20% + 3%; a folga até 40% existe para os casos negociados à mão — o Victor
 * está em 30% + 3%.
 */
export const TETO_DE_SPLIT = 40;

// ─── 1. O PAPEL ─────────────────────────────────────────────────────────────

/**
 * REGRA DE 18/10/2026 (Douglas) — EMBAIXADOR é diferente de VENDEDOR:
 *
 *   "Embaixador vai ganhar recorrente de quem ele botou para dentro. O Victor,
 *    por exemplo, ganha 30%. Se ele parar de trabalhar com a gente, a comissão
 *    é dele, enquanto o cliente dele estiver ativo. Mas o vendedor que ganha
 *    10% perde se sair. Porque o embaixador é um cara autônomo; o vendedor é
 *    contratado nosso." E: "quem atende tem que ser comissionado".
 *
 *   • INDICAÇÃO DE EMBAIXADOR (programa de indicação, autônomo): o % de
 *     embaixador do cadastro (`commissionPercent`, ex.: 20%/30%) de cada boleto
 *     pago da loja que ele indicou — recorrente, NÃO depende de ele atender,
 *     nem de estar na equipe de vendas, nem some se outro vendedor atender.
 *   • LINK DE VENDEDOR (contratado): 10% do boleto da loja que veio pelo link
 *     dele, só enquanto ele está na equipe, ativo, e ATENDE a loja.
 *   • ATRIBUÍDA: o vendedor que atende leva `sellerPercent` (3%).
 *   • Quem é as duas coisas (Victor): as lojas que ele trouxe pagam o % de
 *     embaixador dele (recorrente), nunca os 10% junto.
 *   • Quem atende, entre os vendedores: o atribuído (User.vendedorId); sem
 *     atribuído, o vendedor que convidou pelo link de vendedor.
 *
 * COMO O SISTEMA DISTINGUE os dois (não existe campo próprio; os dois usam o
 * mesmo link de convite e o mesmo `commissionPercent`): é INDICAÇÃO DE
 * EMBAIXADOR quando quem indicou não é vendedor, ou quando é vendedor com % de
 * embaixador próprio — `commissionPercent` acima do % de link de vendedor
 * (`PCT_DO_LINK_DE_VENDEDOR`, 10). Vendedor com 10% (ou menos) no cadastro é
 * LINK DE VENDEDOR. Ver `indicacaoDeEmbaixador`.
 */
export const PCT_DO_LINK_DE_VENDEDOR = 10;

/** A loja que este parceiro indicou paga como indicação de EMBAIXADOR (recorrente)? */
export function indicacaoDeEmbaixador(p: { isVendedor?: boolean | null; commissionPercent: number }): boolean {
  return !p.isVendedor || p.commissionPercent > PCT_DO_LINK_DE_VENDEDOR;
}

/** O vendedor ganha os 3% de atribuída nesta loja? Só se a loja não veio pelo link DELE. */
export function ganhaComoVendedor(vendedorId: string, loja: { ambassadorId?: string | null }): boolean {
  if (loja.ambassadorId && loja.ambassadorId === vendedorId) return false;
  return true;
}

/** O parceiro, com o que decide papel e repasse. */
export type ParceiroNasRegras = {
  id: string;
  active: boolean;
  /** `asaasWalletId` preenchido — sem ele o split não tem para onde mandar. */
  temCarteira: boolean;
  isVendedor: boolean;
  commissionPercent: number;
  level2Percent: number;
  sellerPercent: number;
};

/** A loja, com quem a indicou (pelo link) e quem a atende. */
export type LojaNasRegras = {
  ambassadorId: string | null;
  ambassador: {
    id: string;
    active: boolean;
    temCarteira: boolean;
    commissionPercent: number;
    /** É vendedor da equipe? Com % de link (até 10), a indicação é LINK DE VENDEDOR. */
    isVendedor?: boolean;
    parentAmbassadorId: string | null;
    parentAmbassador: { id: string; active: boolean; temCarteira: boolean; level2Percent: number } | null;
  } | null;
  vendedorId: string | null;
  vendedor: {
    id: string; active: boolean; isVendedor: boolean; temCarteira: boolean; sellerPercent: number;
    /** % do cadastro dele (link de vendedor ou de embaixador). */
    commissionPercent?: number;
  } | null;
};

/** De onde vem a comissão do parceiro na loja. */
export type OrigemDaComissao = "INDICACAO" | "LINK" | "ATRIBUIDA";

export type DonoDaLoja = {
  parceiroId: string;
  /**
   * LINK = veio pelo link de vendedor dele e ele atende (10%);
   * ATRIBUIDA = posta na carteira dele (3%);
   * INDICACAO = ele atende uma loja que indicou como embaixador — o boleto já
   * paga o % de embaixador dele, o papel de vendedor não soma (0%).
   */
  origem: OrigemDaComissao;
  /** % do boleto pelo papel de VENDEDOR. */
  percentual: number;
  ativo: boolean;
  temCarteira: boolean;
};

/** O vendedor que ATENDE a loja, ou null. */
export function vendedorQueAtende(loja: LojaNasRegras): DonoDaLoja | null {
  const v = loja.vendedor;
  if (v && v.isVendedor && loja.vendedorId === v.id) {
    if (loja.ambassadorId !== v.id) return { parceiroId: v.id, origem: "ATRIBUIDA", percentual: v.sellerPercent, ativo: v.active, temCarteira: v.temCarteira };
    const pct = v.commissionPercent ?? (loja.ambassador?.id === v.id ? loja.ambassador.commissionPercent : 0);
    if (indicacaoDeEmbaixador({ isVendedor: true, commissionPercent: pct })) return { parceiroId: v.id, origem: "INDICACAO", percentual: 0, ativo: v.active, temCarteira: v.temCarteira };
    return { parceiroId: v.id, origem: "LINK", percentual: pct, ativo: v.active, temCarteira: v.temCarteira };
  }
  const a = loja.ambassador;
  if (a && a.isVendedor && loja.ambassadorId === a.id && !indicacaoDeEmbaixador(a)) {
    return { parceiroId: a.id, origem: "LINK", percentual: a.commissionPercent, ativo: a.active, temCarteira: a.temCarteira };
  }
  return null;
}

export type PapelNaLoja = {
  papel: Papel;
  /** O que ELE ganha do boleto desta loja, em %. */
  percentual: number;
  /** Indicou como embaixador E também atende como vendedor. */
  tambemNaCarteira: boolean;
  origem: OrigemDaComissao;
};

/**
 * O papel do parceiro nesta loja, ou null se ele não ganha nada nela.
 *   indicou como EMBAIXADOR                 → EMBAIXADOR, commissionPercent (recorrente);
 *   vendedor, veio pelo link dele e atende  → VENDEDOR (LINK), commissionPercent (10%);
 *   vendedor, atribuída a ele               → VENDEDOR (ATRIBUIDA), sellerPercent;
 *   vendedor que convidou e não atende      → null.
 * O papel REDE (nível 2) acabou em 15/10/2026 e não é mais atribuído.
 */
export function papelNaLoja(p: ParceiroNasRegras, loja: LojaNasRegras): PapelNaLoja | null {
  if (loja.ambassadorId && loja.ambassadorId === p.id && indicacaoDeEmbaixador(p)) {
    return { papel: "EMBAIXADOR", percentual: p.commissionPercent, tambemNaCarteira: p.isVendedor && loja.vendedorId === p.id, origem: "INDICACAO" };
  }
  if (!p.isVendedor) return null;
  const dono = vendedorQueAtende(loja);
  if (!dono || dono.parceiroId !== p.id || dono.origem === "INDICACAO") return null;
  if (dono.origem === "LINK") return { papel: "VENDEDOR", percentual: p.commissionPercent, tambemNaCarteira: false, origem: "LINK" };
  return { papel: "VENDEDOR", percentual: p.sellerPercent, tambemNaCarteira: false, origem: "ATRIBUIDA" };
}

// ─── 2. O REPASSE ───────────────────────────────────────────────────────────

/**
 * As linhas do split que o fechamento monta para esta loja (lib/billing.ts lê
 * daqui): a indicação de embaixador (recorrente) + o vendedor que atende.
 * Conta ativa e carteira no Asaas são exigidas; % zero não entra.
 */
export function splitDaLoja(loja: LojaNasRegras): { linhas: { parceiroId: string; papel: Papel; percentual: number }[]; total: number; acimaDoTeto: boolean } {
  const linhas: { parceiroId: string; papel: Papel; percentual: number }[] = [];
  const n1 = loja.ambassador;
  if (n1 && loja.ambassadorId === n1.id && indicacaoDeEmbaixador(n1) && n1.active && n1.temCarteira && n1.commissionPercent > 0) {
    linhas.push({ parceiroId: n1.id, papel: "EMBAIXADOR", percentual: n1.commissionPercent });
  }
  const dono = vendedorQueAtende(loja);
  if (dono && dono.ativo && dono.temCarteira && dono.percentual > 0) {
    const mesma = linhas.find((l) => l.parceiroId === dono.parceiroId);
    // O mesmo parceiro nos dois papéis só acontece com dado torto: vale o de embaixador, nunca os dois.
    if (!mesma) linhas.push({ parceiroId: dono.parceiroId, papel: "VENDEDOR", percentual: dono.percentual });
  }
  const total = linhas.reduce((s, l) => s + l.percentual, 0);
  return { linhas, total, acimaDoTeto: total > TETO_DE_SPLIT };
}

/** O parceiro como vem do banco (Ambassador), só com o que o split precisa. */
export type ParceiroDoCadastro = {
  id: string; active: boolean; isVendedor: boolean; asaasWalletId: string | null;
  commissionPercent: number; sellerPercent: number; parentAmbassadorId?: string | null;
};

/** A loja do banco (User com `ambassador` e `vendedor` incluídos) nas regras. */
export function lojaNasRegrasDoCadastro(l: {
  ambassadorId: string | null; vendedorId: string | null;
  ambassador: ParceiroDoCadastro | null | undefined; vendedor: ParceiroDoCadastro | null | undefined;
}): LojaNasRegras {
  const a = l.ambassador, v = l.vendedor;
  return {
    ambassadorId: l.ambassadorId,
    ambassador: a ? {
      id: a.id, active: a.active, temCarteira: !!a.asaasWalletId, commissionPercent: a.commissionPercent, isVendedor: a.isVendedor,
      parentAmbassadorId: a.parentAmbassadorId ?? null, parentAmbassador: null,
    } : null,
    vendedorId: l.vendedorId,
    vendedor: v ? { id: v.id, active: v.active, isVendedor: v.isVendedor, temCarteira: !!v.asaasWalletId, sellerPercent: v.sellerPercent, commissionPercent: v.commissionPercent } : null,
  };
}

/**
 * O split do boleto no formato do Asaas (`percentualValue` por carteira), com
 * o freio de mão: acima do teto, nenhum split (`acimaDoTeto`).
 */
export function splitDoBoletoNoAsaas(l: Parameters<typeof lojaNasRegrasDoCadastro>[0]): { split: { walletId: string; percentualValue: number }[]; total: number; acimaDoTeto: boolean } {
  const regras = lojaNasRegrasDoCadastro(l);
  const s = splitDaLoja(regras);
  const carteira = new Map<string, string | null>();
  if (l.ambassador) carteira.set(l.ambassador.id, l.ambassador.asaasWalletId);
  if (l.vendedor) carteira.set(l.vendedor.id, l.vendedor.asaasWalletId);
  const split: { walletId: string; percentualValue: number }[] = [];
  for (const linha of s.linhas) {
    const w = carteira.get(linha.parceiroId);
    if (!w) continue;
    const mesma = split.find((x) => x.walletId === w);
    if (mesma) mesma.percentualValue += linha.percentual;
    else split.push({ walletId: w, percentualValue: linha.percentual });
  }
  return { split: s.acimaDoTeto ? [] : split, total: s.total, acimaDoTeto: s.acimaDoTeto };
}

/** Na recarga do disparo oficial o vendedor que atende leva SEMPRE 3% da margem do FireHub (Douglas, 18/10/2026). */
export const COMISSAO_DO_DISPARO_PCT = 3;

/**
 * O split da recarga do disparo: valor FIXO = 3% da margem (valor − mensagens ×
 * custo da Meta) para o vendedor que atende a loja, com conta ativa e carteira.
 * Embaixador que não vende não entra (o combinado do disparo é com quem atende).
 */
export function splitDaRecarga(r: { valor: number; disparos: number; custoPorDisparo: number }, loja: LojaNasRegras): { parceiroId: string; fixedValue: number; margem: number } | null {
  const margem = Math.max(0, Math.round((r.valor - r.disparos * r.custoPorDisparo) * 100) / 100);
  const dono = vendedorQueAtende(loja);
  if (!dono || !dono.ativo || !dono.temCarteira) return null;
  const fixedValue = Math.floor(margem * COMISSAO_DO_DISPARO_PCT) / 100;
  if (fixedValue < 0.01) return null;
  return { parceiroId: dono.parceiroId, fixedValue, margem };
}

/** O que o vendedor ganha numa recarga de N mensagens (a tabelinha do portal — sem mostrar margem nem custo). */
export function ganhoPorPacote(disparos: number, precoPorDisparo: number, custoPorDisparo: number): number {
  const valor = Math.round(disparos * precoPorDisparo * 100) / 100;
  const margem = Math.max(0, valor - disparos * custoPorDisparo);
  return Math.floor(margem * COMISSAO_DO_DISPARO_PCT) / 100;
}

/**
 * Por que a comissão desta loja NÃO cairia na conta dele — ou "CAI".
 *   SEM_CARTEIRA           ele não cadastrou a carteira do Asaas
 *   PARCEIRO_INATIVO       a conta dele está pausada no admin
 *   INDICADOR_FORA         (rede) o embaixador que indicou está sem carteira ou inativo
 *   ACIMA_DO_TETO          os % da loja passam de 40 e o boleto sai sem split
 */
export type Repasse = "CAI" | "SEM_CARTEIRA" | "PARCEIRO_INATIVO" | "INDICADOR_FORA" | "ACIMA_DO_TETO";

export function repasseNaLoja(p: ParceiroNasRegras, loja: LojaNasRegras, papel: Papel): Repasse {
  if (!p.active) return "PARCEIRO_INATIVO";
  if (!p.temCarteira) return "SEM_CARTEIRA";
  if (papel === "REDE") {
    const n1 = loja.ambassador;
    if (!n1 || !n1.active || !n1.temCarteira) return "INDICADOR_FORA";
  }
  if (splitDaLoja(loja).acimaDoTeto) return "ACIMA_DO_TETO";
  return "CAI";
}

/** Comissão sobre um valor, em centavos certos. */
export function comissaoSobre(valor: number, percentual: number): number {
  if (!(valor > 0) || !(percentual > 0)) return 0;
  return Math.round(valor * percentual) / 100;
}

// ─── 3. A MENSALIDADE ───────────────────────────────────────────────────────

/**
 * O boleto da mensalidade sai com `externalReference: "billing:<id do ciclo>"`
 * (lib/billing.ts). "billing:<id>" → id; qualquer outra referência → null.
 */
export function cicloDaReferencia(externalReference: unknown): string | null {
  const ref = String(externalReference || "");
  return ref.startsWith("billing:") && ref.length > "billing:".length ? ref.slice("billing:".length) : null;
}

/** Status do Asaas que querem dizer "a loja pagou" (o mesmo de lib/asaas-da-loja.ts). */
export function statusDePago(status: string | null | undefined): boolean {
  // DUNNING_RECEIVED: pago depois de ir para a negativação do Asaas.
  return ["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH", "DUNNING_RECEIVED"].includes(String(status || "").toUpperCase());
}

/** O ciclo de cobrança, só com o que as regras leem. */
export type CicloNasRegras = {
  yearMonth: string;
  status: string;
  amountDue: number;
  amountPending: number;
  asaasPaymentId: string | null;
  asaasBoletoUrl: string | null;
  /** Registro do bloqueio; quem decide é `bloqueioDoCiclo` (lib/prazo-da-mensalidade.ts). */
  dueDate: Date | string | null;
  closedAt?: Date | string | null;
  paidAt: Date | string | null;
  paidValue: number | null;
  paidNetValue: number | null;
  asaasStatus: string | null;
  notes: string | null;
};

export type Situacao = "EM_ANDAMENTO" | "SEM_COBRANCA" | "PAGA" | "A_VENCER" | "VENCIDA" | "SEM_BOLETO";

export type Mensalidade = {
  yearMonth: string;
  situacao: Situacao;
  /** O boleto (ou a previsão dele, no mês em andamento). É sobre ele que sai a comissão. */
  valor: number;
  /** O que entrou: o líquido da tarifa do Asaas quando o Asaas informou. */
  pago: number;
  pagoEm: string | null;
  /** Vencimento do boleto: dia 5 do mês seguinte. */
  venceEm: string | null;
  /** Depois disto o painel da loja trava (app/store/layout.tsx). */
  bloqueiaEm: string | null;
  diasDeAtraso: number;
  boletoUrl: string | null;
  /** Por que não houve cobrança (o `notes` do fechamento), quando não houve. */
  motivo: string | null;
};

const DIA = 86_400_000;

function iso(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const t = new Date(d);
  return isNaN(t.getTime()) ? null : t.toISOString();
}

export { mesSeguinte, vencimentoDoBoleto };

/** "2026-09" menos N meses. */
export function mesesAntes(yearMonth: string, n: number): string {
  const [a, m] = yearMonth.split("-").map(Number);
  const total = a * 12 + (m - 1) - n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/**
 * Em que pé está a mensalidade de `yearMonth`. `ciclo` null = a loja não tem
 * ciclo naquele mês (não vendeu): no mês corrente é "em andamento, R$ 0";
 * num mês fechado, "sem cobrança".
 */
export function mensalidadeDoCiclo(ciclo: CicloNasRegras | null, yearMonth: string, mesCorrente: string, agora: Date): Mensalidade {
  const base: Mensalidade = {
    yearMonth, situacao: "SEM_COBRANCA", valor: 0, pago: 0, pagoEm: null,
    venceEm: null, bloqueiaEm: null, diasDeAtraso: 0, boletoUrl: null, motivo: null,
  };
  if (!ciclo) {
    return yearMonth >= mesCorrente
      ? { ...base, situacao: "EM_ANDAMENTO" }
      : { ...base, motivo: "Não vendeu no mês." };
  }
  const boleto = ciclo.asaasBoletoUrl || null;
  const pagaNoAsaas = !!ciclo.paidAt || statusDePago(ciclo.asaasStatus);

  if (ciclo.status === "OPEN") {
    return { ...base, situacao: "EM_ANDAMENTO", valor: Math.max(0, ciclo.amountPending || 0) };
  }

  if (ciclo.status === "PAID" && pagaNoAsaas) {
    // Quitado o boleto, o `amountPending` volta a zero (é "o que ainda falta");
    // o valor cobrado fica em `paidValue`.
    const valor = ciclo.paidValue ?? (ciclo.amountPending > 0 ? ciclo.amountPending : ciclo.amountDue);
    return {
      ...base, situacao: "PAGA", valor,
      pago: ciclo.paidNetValue ?? ciclo.paidValue ?? valor,
      pagoEm: iso(ciclo.paidAt), boletoUrl: boleto,
    };
  }

  if (ciclo.status === "CLOSED" && ciclo.amountPending > 0) {
    if (pagaNoAsaas) {
      // O webhook marca PAID na mesma escrita; isto é só a rede de segurança.
      return { ...base, situacao: "PAGA", valor: ciclo.amountPending, pago: ciclo.paidNetValue ?? ciclo.paidValue ?? ciclo.amountPending, pagoEm: iso(ciclo.paidAt), boletoUrl: boleto };
    }
    const venc = vencimentoDoBoleto(ciclo.yearMonth);
    const comum = { ...base, valor: ciclo.amountPending, venceEm: venc.dia, bloqueiaEm: iso(bloqueioDoCiclo(ciclo)), boletoUrl: boleto };
    // Sem boleto no Asaas não há como a loja pagar nem split para cair: a
    // cobrança não saiu (loja sem CPF/CNPJ, ou o Asaas recusou) ou foi apagada.
    if (!ciclo.asaasPaymentId || String(ciclo.asaasStatus || "").toUpperCase() === "DELETED") {
      return { ...comum, situacao: "SEM_BOLETO", motivo: ciclo.asaasPaymentId ? "O boleto foi cancelado no Asaas." : "O boleto não foi emitido." };
    }
    const atraso = agora.getTime() - venc.vencidoDepoisDe.getTime();
    if (String(ciclo.asaasStatus || "").toUpperCase() === "OVERDUE" || atraso >= 0) {
      return { ...comum, situacao: "VENCIDA", diasDeAtraso: atraso >= 0 ? Math.floor(atraso / DIA) + 1 : 1 };
    }
    return { ...comum, situacao: "A_VENCER" };
  }

  // PAID sem pagamento (teste, isenta, sem uso, abaixo de R$ 1), FORGIVEN, ou
  // CLOSED zerado: a loja não foi cobrada neste mês.
  return { ...base, motivo: ciclo.status === "FORGIVEN" ? "Mensalidade perdoada." : ciclo.notes || null };
}

// ─── O QUE O PORTAL MOSTRA POR LOJA ─────────────────────────────────────────

export type UsoDaLoja = "ATIVA" | "PARADA" | "NUNCA_VENDEU";

export type LojaDoRelatorio = {
  /** De onde vem a comissão dele nesta loja (indicação de embaixador, link de vendedor, atribuída). */
  origem?: OrigemDaComissao;
  id: string;
  nome: string;
  dono: string;
  cidade: string | null;
  telefone: string | null;
  email: string;
  slug: string | null;
  cadastradaEm: string;
  papel: Papel;
  percentual: number;
  tambemNaCarteira: boolean;
  /** Rede: o embaixador que indicou a loja. */
  via: { id: string; nome: string } | null;
  /** Quem acompanha a loja como vendedor, quando é outra pessoa. */
  vendedorDaLoja: string | null;
  repasse: Repasse;
  /** Loja que não paga mensalidade (Hakim, própria da casa, plano 0%). */
  isenta: boolean;
  /** Sem CPF/CNPJ o fechamento não emite o boleto — o parceiro pode ajudar. */
  semCpfCnpj: boolean;
  teste: { ativo: boolean; ate: string | null; diasRestantes: number };
  uso: { situacao: UsoDaLoja; diasSemPedido: number | null; pedidos7d: number; ultimoPedidoEm: string | null };
  /** Está na carteira de vendas dele (inclusive quando também indicou). */
  carteira: { atendimento: "AGUARDANDO" | "ATENDIDO"; atribuidoEm: string | null; atendidoEm: string | null } | null;
  mesAtual: Mensalidade & { comissao: number };
  mesAnterior: Mensalidade & { comissao: number };
  /** Tudo que está em aberto na loja, de qualquer mês fechado. */
  emAberto: {
    valor: number;
    meses: number;
    vencida: boolean;
    diasDeAtraso: number;
    maisAntigo: string;
    boletoUrl: string | null;
    /** A comissão dele que está esperando esse pagamento. */
    comissaoParada: number;
  } | null;
  /** Comissão que ENTROU dos meses fechados (ciclos pagos), por mês. */
  recebidoPorMes: { yearMonth: string; valor: number; pagoEm: string | null }[];
};

export type ResumoDoPapel = {
  lojas: number;
  ativas: number;
  paradas: number;
  nuncaVenderam: number;
  emTeste: number;
  atrasadas: number;
  comissaoMes: number;
};

export type ResumoDoParceiro = {
  mesAtual: {
    yearMonth: string;
    /** O que deve cair (repasse ok). */
    comissao: number;
    /** O que a conta daria, mas não cai (sem carteira, teto, indicador fora do split). */
    semRepasse: number;
    porPapel: Record<Papel, { comissao: number; lojas: number; cobraveis: number }>;
  };
  mesAnterior: {
    yearMonth: string;
    recebido: number;
    aVencer: number;
    atrasado: number;
    semBoleto: number;
    lojas: { pagas: number; aVencer: number; vencidas: number; semBoleto: number; semCobranca: number };
  };
  /** Comissão que entrou neste mês de calendário (pela data do pagamento). */
  recebidoEsteMes: number;
  media: { valor: number; meses: { yearMonth: string; valor: number }[] };
  estrutura: Record<Papel | "TOTAL", ResumoDoPapel>;
  /** Lojas que ele indicou (ou são da rede) e também acompanha como vendedor. */
  nasDuas: number;
  atencao: {
    atrasadas: number;
    comissaoParada: number;
    aguardandoContato: number;
    paradas: number;
    testesAcabando: number;
    semBoleto: number;
  };
};

const resumoVazio = (): ResumoDoPapel => ({ lojas: 0, ativas: 0, paradas: 0, nuncaVenderam: 0, emTeste: 0, atrasadas: 0, comissaoMes: 0 });

/** Os números do topo do portal, somados das lojas. */
export function resumirLojas(
  lojas: LojaDoRelatorio[],
  meses: { atual: string; anterior: string; historico: string[] },
  mesDoPagamento: (iso: string) => string
): ResumoDoParceiro {
  const porPapel = { EMBAIXADOR: { comissao: 0, lojas: 0, cobraveis: 0 }, REDE: { comissao: 0, lojas: 0, cobraveis: 0 }, VENDEDOR: { comissao: 0, lojas: 0, cobraveis: 0 } };
  const estrutura: Record<Papel | "TOTAL", ResumoDoPapel> = { EMBAIXADOR: resumoVazio(), REDE: resumoVazio(), VENDEDOR: resumoVazio(), TOTAL: resumoVazio() };
  const anterior = { yearMonth: meses.anterior, recebido: 0, aVencer: 0, atrasado: 0, semBoleto: 0, lojas: { pagas: 0, aVencer: 0, vencidas: 0, semBoleto: 0, semCobranca: 0 } };
  const atencao = { atrasadas: 0, comissaoParada: 0, aguardandoContato: 0, paradas: 0, testesAcabando: 0, semBoleto: 0 };
  const porMes = new Map(meses.historico.map((m) => [m, 0]));
  const mesCorrente = meses.atual;
  let comissao = 0;
  let semRepasse = 0;
  let recebidoEsteMes = 0;
  let nasDuas = 0;

  for (const l of lojas) {
    const cai = l.repasse === "CAI";

    // Mês corrente
    porPapel[l.papel].lojas++;
    if (l.mesAtual.valor > 0) porPapel[l.papel].cobraveis++;
    if (cai) {
      comissao += l.mesAtual.comissao;
      porPapel[l.papel].comissao += l.mesAtual.comissao;
    } else semRepasse += l.mesAtual.comissao;

    // Estrutura
    for (const chave of [l.papel, "TOTAL"] as const) {
      const r = estrutura[chave];
      r.lojas++;
      if (l.uso.situacao === "ATIVA") r.ativas++;
      else if (l.uso.situacao === "PARADA") r.paradas++;
      else r.nuncaVenderam++;
      if (l.teste.ativo) r.emTeste++;
      if (l.emAberto?.vencida) r.atrasadas++;
      if (cai) r.comissaoMes += l.mesAtual.comissao;
    }
    if (l.tambemNaCarteira) nasDuas++;

    // Mês anterior
    const ant = l.mesAnterior;
    if (ant.situacao === "PAGA") {
      anterior.lojas.pagas++;
      if (cai) anterior.recebido += ant.comissao;
    } else if (ant.situacao === "A_VENCER") {
      anterior.lojas.aVencer++;
      if (cai) anterior.aVencer += ant.comissao;
    } else if (ant.situacao === "VENCIDA") {
      anterior.lojas.vencidas++;
      if (cai) anterior.atrasado += ant.comissao;
    } else if (ant.situacao === "SEM_BOLETO") {
      anterior.lojas.semBoleto++;
      if (cai) anterior.semBoleto += ant.comissao;
    } else if (ant.situacao === "SEM_COBRANCA") anterior.lojas.semCobranca++;

    // O que entrou: por mês de competência (média) e por mês de pagamento.
    if (cai) {
      for (const r of l.recebidoPorMes) {
        if (porMes.has(r.yearMonth)) porMes.set(r.yearMonth, (porMes.get(r.yearMonth) || 0) + r.valor);
        if (r.pagoEm && mesDoPagamento(r.pagoEm) === mesCorrente) recebidoEsteMes += r.valor;
      }
    }

    // O que pede atenção
    if (l.emAberto?.vencida) {
      atencao.atrasadas++;
      if (cai) atencao.comissaoParada += l.emAberto.comissaoParada;
    }
    if (l.mesAnterior.situacao === "SEM_BOLETO") atencao.semBoleto++;
    if (l.carteira?.atendimento === "AGUARDANDO") atencao.aguardandoContato++;
    if (l.uso.situacao === "PARADA" && !l.teste.ativo) atencao.paradas++;
    if (l.teste.ativo && l.teste.diasRestantes <= 5) atencao.testesAcabando++;
  }

  const redondo = (v: number) => Math.round(v * 100) / 100;
  const historico = meses.historico.map((m) => ({ yearMonth: m, valor: redondo(porMes.get(m) || 0) }));
  return {
    mesAtual: {
      yearMonth: meses.atual,
      comissao: redondo(comissao),
      semRepasse: redondo(semRepasse),
      porPapel: {
        EMBAIXADOR: { ...porPapel.EMBAIXADOR, comissao: redondo(porPapel.EMBAIXADOR.comissao) },
        REDE: { ...porPapel.REDE, comissao: redondo(porPapel.REDE.comissao) },
        VENDEDOR: { ...porPapel.VENDEDOR, comissao: redondo(porPapel.VENDEDOR.comissao) },
      },
    },
    mesAnterior: {
      ...anterior,
      recebido: redondo(anterior.recebido),
      aVencer: redondo(anterior.aVencer),
      atrasado: redondo(anterior.atrasado),
      semBoleto: redondo(anterior.semBoleto),
    },
    recebidoEsteMes: redondo(recebidoEsteMes),
    media: {
      valor: historico.length ? redondo(historico.reduce((s, m) => s + m.valor, 0) / historico.length) : 0,
      meses: historico,
    },
    estrutura: Object.fromEntries(
      Object.entries(estrutura).map(([k, r]) => [k, { ...r, comissaoMes: redondo(r.comissaoMes) }])
    ) as Record<Papel | "TOTAL", ResumoDoPapel>,
    nasDuas,
    atencao: { ...atencao, comissaoParada: redondo(atencao.comissaoParada) },
  };
}
