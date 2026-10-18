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
 * Regra do Douglas de 18/10/2026 (substitui a de 27/09): entre os vendedores,
 * quem ATENDE é quem ganha — 10% (o % de link do cadastro) na loja que ele
 * trouxe pelo link, 3% na que foi atribuída a ele; quem convidou e não atende
 * não leva nada. Embaixador que não vende segue a regra do programa de
 * indicação. Ver `vendedorQueAtende`.
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
 * REGRA DE 18/10/2026 (Douglas): "quem atende tem que ser comissionado… se
 * amanhã ele parar de atender quem ele convidou, ele perde os 10%".
 *
 *   • O DONO da loja, entre os vendedores, é quem ATENDE: o vendedor atribuído
 *     (User.vendedorId). Sem atribuído, e se a loja veio pelo link de convite
 *     de um vendedor (User.ambassadorId = vendedor), o dono é quem convidou.
 *   • O dono leva o % de LINK (`commissionPercent` do cadastro — padrão 10%)
 *     se foi ele quem convidou; o % de ATRIBUÍDA (`sellerPercent`, 3%) se a
 *     loja foi posta na carteira dele.
 *   • Vendedor que convidou mas NÃO atende mais: nada. Vendedor inativo ou fora
 *     da equipe: nada (nem pelo link) — o split exige conta ativa.
 *   • Embaixador que NÃO é vendedor (programa de indicação): a regra de antes,
 *     intocada — leva o `commissionPercent` dele, e o vendedor que atende leva
 *     os 3% à parte.
 *   • Nunca dois vendedores na mesma loja.
 *
 * Antes desta data: quem indicou levava o commissionPercent mesmo sem atender
 * (e o vendedor atribuído levava +3% em cima), e o vendedor que indicava a
 * loja e atendia levava só o commissionPercent (0% no cadastro de vendedor).
 */

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
    /** É vendedor da equipe? (vendedor que convida pelo link segue a regra de quem atende) */
    isVendedor?: boolean;
    parentAmbassadorId: string | null;
    parentAmbassador: { id: string; active: boolean; temCarteira: boolean; level2Percent: number } | null;
  } | null;
  vendedorId: string | null;
  vendedor: {
    id: string; active: boolean; isVendedor: boolean; temCarteira: boolean; sellerPercent: number;
    /** % de link do cadastro dele — vale quando a loja veio pelo link dele E ele atende. */
    commissionPercent?: number;
  } | null;
};

export type DonoDaLoja = {
  parceiroId: string;
  /** LINK = ele convidou e atende; ATRIBUIDA = posta na carteira dele. */
  origem: "LINK" | "ATRIBUIDA";
  percentual: number;
  ativo: boolean;
  temCarteira: boolean;
};

/** O vendedor que ATENDE a loja (o dono dela entre os vendedores), ou null. */
export function vendedorQueAtende(loja: LojaNasRegras): DonoDaLoja | null {
  const v = loja.vendedor;
  if (v && v.isVendedor && loja.vendedorId === v.id) {
    const convidou = loja.ambassadorId === v.id;
    const pctLink = v.commissionPercent ?? (loja.ambassador?.id === v.id ? loja.ambassador.commissionPercent : 0);
    return { parceiroId: v.id, origem: convidou ? "LINK" : "ATRIBUIDA", percentual: convidou ? pctLink : v.sellerPercent, ativo: v.active, temCarteira: v.temCarteira };
  }
  const a = loja.ambassador;
  if (a && a.isVendedor && loja.ambassadorId === a.id) {
    return { parceiroId: a.id, origem: "LINK", percentual: a.commissionPercent, ativo: a.active, temCarteira: a.temCarteira };
  }
  return null;
}

export type PapelNaLoja = {
  papel: Papel;
  /** O que ELE ganha da mensalidade desta loja, em %. */
  percentual: number;
  /** Convidou pelo link E está atribuída a ele (o portal diz "veio pelo seu link"). */
  tambemNaCarteira: boolean;
};

/**
 * O papel do parceiro nesta loja, ou null se ele não ganha nada nela.
 *   embaixador (não vendedor) que indicou → EMBAIXADOR, commissionPercent (regra de sempre);
 *   vendedor que atende e convidou      → EMBAIXADOR (link), commissionPercent;
 *   vendedor que atende, atribuída       → VENDEDOR, sellerPercent;
 *   vendedor que convidou e não atende   → null.
 * O papel REDE (nível 2) acabou em 15/10/2026 e não é mais atribuído.
 */
export function papelNaLoja(p: ParceiroNasRegras, loja: LojaNasRegras): PapelNaLoja | null {
  if (!p.isVendedor) {
    if (loja.ambassadorId && loja.ambassadorId === p.id) return { papel: "EMBAIXADOR", percentual: p.commissionPercent, tambemNaCarteira: false };
    return null;
  }
  const dono = vendedorQueAtende(loja);
  if (!dono || dono.parceiroId !== p.id) return null;
  if (dono.origem === "LINK") return { papel: "EMBAIXADOR", percentual: p.commissionPercent, tambemNaCarteira: loja.vendedorId === p.id };
  return { papel: "VENDEDOR", percentual: p.sellerPercent, tambemNaCarteira: false };
}

// ─── 2. O REPASSE ───────────────────────────────────────────────────────────

/**
 * As linhas do split que o fechamento monta para esta loja (lib/billing.ts lê
 * daqui): o embaixador que não vende (se indicou) + o vendedor que atende.
 * Conta ativa e carteira no Asaas são exigidas; % zero não entra.
 */
export function splitDaLoja(loja: LojaNasRegras): { linhas: { parceiroId: string; papel: Papel; percentual: number }[]; total: number; acimaDoTeto: boolean } {
  const linhas: { parceiroId: string; papel: Papel; percentual: number }[] = [];
  const dono = vendedorQueAtende(loja);
  const n1 = loja.ambassador;
  // Embaixador do programa de indicação (não vende). Se for o MESMO parceiro que
  // atende (a loja veio pelo link dele e ele está atribuído), ele é vendedor
  // aqui: leva só o % de quem atende, nunca os dois.
  if (n1 && !n1.isVendedor && n1.id !== dono?.parceiroId && n1.active && n1.temCarteira && n1.commissionPercent > 0) {
    linhas.push({ parceiroId: n1.id, papel: "EMBAIXADOR", percentual: n1.commissionPercent });
  }
  if (dono && dono.ativo && dono.temCarteira && dono.percentual > 0) {
    const papel: Papel = dono.origem === "LINK" ? "EMBAIXADOR" : "VENDEDOR";
    linhas.push({ parceiroId: dono.parceiroId, papel, percentual: dono.percentual });
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
