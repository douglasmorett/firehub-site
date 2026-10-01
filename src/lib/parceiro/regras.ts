/**
 * AS REGRAS DO PARCEIRO DA FIREHUB — embaixador, rede e vendedor.
 *
 * Três perguntas, uma resposta cada, para o portal (lib/parceiro/relatorio.ts),
 * para o split do Asaas (lib/billing.ts, pelo `ganhaComoVendedor`) e para o
 * teste (scripts/teste-relatorio-do-parceiro.ts) lerem a MESMA conta:
 *
 *   1. Em que papel o parceiro está nesta loja — e quanto ganha nela.
 *   2. A comissão cai de verdade? O split do fechamento tem condições (carteira
 *      no Asaas, conta ativa, teto de 40%) que o portal precisa mostrar.
 *   3. Em que pé está a mensalidade que paga a comissão: em andamento, paga,
 *      a vencer, vencida, sem boleto ou sem cobrança.
 *
 * Regra do Douglas (27/09, reafirmada em 30/09/2026 no caso do Victor): quem
 * indicou a loja — ou trouxe o embaixador que indicou — e também a acompanha
 * como vendedor recebe SÓ a comissão de embaixador. Os % de vendedor pagam
 * cuidar de cliente que a FireHub conseguiu; não somam em cima da indicação.
 *
 * Sem Prisma nem "@/…": roda puro no teste.
 */

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
 * O vendedor leva `sellerPercent` desta loja? Não quando já ganha nela como
 * embaixador: indicou a loja (nível 1) ou trouxe quem indicou (nível 2).
 */
export function ganhaComoVendedor(
  vendedorId: string,
  loja: { ambassadorId?: string | null; ambassador?: { parentAmbassadorId?: string | null } | null }
): boolean {
  if (loja.ambassadorId && loja.ambassadorId === vendedorId) return false;
  if (loja.ambassador?.parentAmbassadorId && loja.ambassador.parentAmbassadorId === vendedorId) return false;
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

/** A loja, com quem a indicou, quem trouxe esse embaixador e quem a acompanha. */
export type LojaNasRegras = {
  ambassadorId: string | null;
  ambassador: {
    id: string;
    active: boolean;
    temCarteira: boolean;
    commissionPercent: number;
    parentAmbassadorId: string | null;
    parentAmbassador: { id: string; active: boolean; temCarteira: boolean; level2Percent: number } | null;
  } | null;
  vendedorId: string | null;
  vendedor: { id: string; active: boolean; isVendedor: boolean; temCarteira: boolean; sellerPercent: number } | null;
};

export type PapelNaLoja = {
  papel: Papel;
  /** O que ELE ganha da mensalidade desta loja, em %. */
  percentual: number;
  /**
   * Indicou (ou é da rede dele) E está na carteira de vendas dele: conta só
   * como embaixador — o portal diz isso na linha da loja.
   */
  tambemNaCarteira: boolean;
};

/**
 * O papel do parceiro nesta loja, ou null se ela não é dele. A indicação vence
 * a carteira: nível 1, depois nível 2, depois vendedor.
 */
export function papelNaLoja(p: ParceiroNasRegras, loja: LojaNasRegras): PapelNaLoja | null {
  const naCarteira = p.isVendedor && !!loja.vendedorId && loja.vendedorId === p.id;
  if (loja.ambassadorId && loja.ambassadorId === p.id) {
    return { papel: "EMBAIXADOR", percentual: p.commissionPercent, tambemNaCarteira: naCarteira };
  }
  if (loja.ambassador?.parentAmbassadorId && loja.ambassador.parentAmbassadorId === p.id) {
    return { papel: "REDE", percentual: p.level2Percent, tambemNaCarteira: naCarteira };
  }
  if (naCarteira) return { papel: "VENDEDOR", percentual: p.sellerPercent, tambemNaCarteira: false };
  return null;
}

// ─── 2. O REPASSE ───────────────────────────────────────────────────────────

/** As linhas do split que o fechamento montaria para esta loja HOJE. */
export function splitDaLoja(loja: LojaNasRegras): { linhas: { parceiroId: string; papel: Papel; percentual: number }[]; total: number; acimaDoTeto: boolean } {
  const linhas: { parceiroId: string; papel: Papel; percentual: number }[] = [];
  const n1 = loja.ambassador;
  if (n1 && n1.active && n1.temCarteira) {
    linhas.push({ parceiroId: n1.id, papel: "EMBAIXADOR", percentual: n1.commissionPercent });
    // O nível 2 só é olhado DENTRO do nível 1 — é assim no fechamento: se quem
    // indicou está sem carteira ou inativo, o avô também fica de fora.
    const n2 = n1.parentAmbassador;
    if (n2 && n2.active && n2.temCarteira && n2.id !== n1.id) {
      linhas.push({ parceiroId: n2.id, papel: "REDE", percentual: n2.level2Percent });
    }
  }
  const v = loja.vendedor;
  if (v && v.active && v.isVendedor && v.temCarteira && v.sellerPercent > 0 && ganhaComoVendedor(v.id, loja)) {
    const mesma = linhas.find((l) => l.parceiroId === v.id);
    if (mesma) mesma.percentual += v.sellerPercent;
    else linhas.push({ parceiroId: v.id, papel: "VENDEDOR", percentual: v.sellerPercent });
  }
  const total = linhas.reduce((s, l) => s + l.percentual, 0);
  return { linhas, total, acimaDoTeto: total > TETO_DE_SPLIT };
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
  /** Prazo do BLOQUEIO do painel da loja (fechamento + 10 dias, cron billing-close). */
  dueDate: Date | string | null;
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

/** "2026-09" → "2026-10". */
export function mesSeguinte(yearMonth: string): string {
  const [a, m] = yearMonth.split("-").map(Number);
  const total = a * 12 + (m - 1) + 1;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/** "2026-09" menos N meses. */
export function mesesAntes(yearMonth: string, n: number): string {
  const [a, m] = yearMonth.split("-").map(Number);
  const total = a * 12 + (m - 1) - n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/**
 * O boleto do mês M vence no dia 5 de M+1 (lib/billing.ts, closeBillingCycle).
 * Vencido = passou do fim do dia 5 EM BRASÍLIA (UTC−3, sem horário de verão
 * desde 2019): 06/10 às 03:00 UTC para o boleto de setembro.
 */
export function vencimentoDoBoleto(yearMonth: string): { dia: string; vencidoDepoisDe: Date } {
  const [a, m] = mesSeguinte(yearMonth).split("-").map(Number);
  return {
    dia: `${a}-${String(m).padStart(2, "0")}-05`,
    vencidoDepoisDe: new Date(Date.UTC(a, m - 1, 6, 3, 0, 0)),
  };
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
    const comum = { ...base, valor: ciclo.amountPending, venceEm: venc.dia, bloqueiaEm: iso(ciclo.dueDate), boletoUrl: boleto };
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
