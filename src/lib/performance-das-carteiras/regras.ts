/**
 * A PERFORMANCE DAS CARTEIRAS — as contas puras (sem banco). Pedido do Douglas,
 * 18/10/2026: "eu vejo tudo e vejo a carteira de cada vendedor separado; também
 * análise de performance por carteira do vendedor, detalhada".
 *
 * O banco (lib/performance-das-carteiras/no-banco.ts) entrega, por loja, as
 * vendas do período e do anterior (dias exatos) e, por mês, o ciclo da
 * mensalidade e os serviços pagos; daqui saem a receita (prevista / faturada /
 * recebida / em aberto), a situação da loja, as perdas, a conversão do teste,
 * a comissão por origem da loja, o comparativo entre carteiras e a variação
 * contra o período anterior.
 *
 * ── Comissão (Douglas, 18/10/2026) ──────────────────────────────────────────
 *
 * "Quem atende tem que ser comissionado… se amanhã ele parar de atender quem
 * ele convidou, ele perde os 10%." Entre os vendedores, a loja tem UM dono, o
 * que ATENDE (lib/parceiro/regras.ts, vendedorQueAtende — a mesma regra do
 * split do boleto):
 *   • o vendedor atribuído (User.vendedorId); sem atribuído, quem convidou
 *     pelo link (User.ambassadorId = vendedor);
 *   • ele leva o % de link do cadastro (combinado 10%) se foi ele quem
 *     convidou, e o % de atribuída (3%) se a loja foi posta na carteira dele;
 *   • quem convidou e não atende não leva nada; conta pausada não leva nada;
 *   • embaixador que NÃO é vendedor (programa de indicação): a regra de
 *     sempre — leva o commissionPercent dele e aparece nas indicações dele.
 *
 * ── Disparo oficial ─────────────────────────────────────────────────────────
 *
 * A receita do disparo para a carteira é a MARGEM da recarga (valor −
 * mensagens × custo da Meta gravado na recarga). O vendedor que atende leva
 * SEMPRE 3% dessa margem, venha a loja do link ou não, num split de valor
 * fixo no Pix da recarga (lib/disparo-oficial/servidor.ts). O portal do
 * vendedor não mostra margem nem custo — só quanto ele ganha.
 *
 * Testado em scripts/teste-performance-das-carteiras.ts.
 */
import { mesesAntes } from "@/lib/parceiro/regras";
import { diasNoPeriodo, somarDias } from "@/lib/relatorios/base";
import { tendencia, type StatusDaAtividade } from "@/lib/perfil-da-loja/regras";

/** O combinado com o Douglas (18/10/2026). O split paga o que está no cadastro de cada parceiro. */
export const COMISSAO_COMBINADA = { LINK: 10, ATRIBUIDA: 3, DISPARO: 3 } as const;

// ═════════════════════════════════════════════════════════════════════════════
// PERÍODOS
// ═════════════════════════════════════════════════════════════════════════════

export type ChaveDoPeriodo = "mes" | "mesAnterior" | "90d" | "ano" | "mesEspecifico" | "intervalo";

export type PeriodoDaAnalise = {
  chave: ChaveDoPeriodo;
  rotulo: string;
  rotuloDoAnterior: string;
  /** Dias "YYYY-MM-DD" (dia operacional), inclusive. */
  de: string;
  ate: string;
  deAnterior: string;
  ateAnterior: string;
  /** Meses "YYYY-MM" que o período toca, do mais antigo ao mais novo. */
  meses: string[];
  anteriores: string[];
  /** O período termina hoje. */
  parcial: boolean;
};

export const ATALHOS_DO_PERIODO: { chave: ChaveDoPeriodo; rotulo: string }[] = [
  { chave: "mes", rotulo: "Mês atual" },
  { chave: "mesAnterior", rotulo: "Mês anterior" },
  { chave: "90d", rotulo: "90 dias" },
  { chave: "ano", rotulo: "Ano atual" },
];

const NOMES_DOS_MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export const mesCurto = (ym: string) => `${NOMES_DOS_MESES[Number(ym.slice(5, 7)) - 1]}/${ym.slice(2, 4)}`;
const diaCurto = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(2, 4)}`;

/** n meses terminando em `ultimo`, do mais antigo ao mais novo. */
export function mesesAte(ultimo: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => mesesAntes(ultimo, n - 1 - i));
}

/** Os meses que [de, ate] toca. */
export function mesesDaFaixa(de: string, ate: string): string[] {
  const a = de.slice(0, 7), b = ate.slice(0, 7);
  const lista = [a];
  while (lista[lista.length - 1] < b) lista.push(mesesAntes(lista[lista.length - 1], -1));
  return lista;
}

const ultimoDia = (ym: string) => somarDias(`${mesesAntes(ym, -1)}-01`, -1);
const valido = (d: string | undefined) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T12:00:00Z`));

/**
 * O período escolhido e o anterior, em dias:
 *   mes            1º do mês até hoje × o mês anterior do dia 1 até o mesmo dia
 *   mesAnterior    o mês passado inteiro × o mês antes dele
 *   90d            os últimos 90 dias × os 90 antes deles
 *   ano            1º de janeiro até hoje × o mesmo trecho do ano passado
 *   mesEspecifico  um mês escolhido (YYYY-MM) × o mês antes dele (o mês corrente vira "até hoje")
 *   intervalo      de/até livres × o mesmo número de dias logo antes
 */
export function periodoDaAnalise(
  chave: ChaveDoPeriodo, hoje: string, extra: { mes?: string; de?: string; ate?: string } = {},
): PeriodoDaAnalise {
  const mesDeHoje = hoje.slice(0, 7);
  let de: string, ate: string, deAnt: string, ateAnt: string, rotulo: string, rotuloAnt: string;
  const mesmoDiaNoMes = (ym: string) => {
    const fim = ultimoDia(ym);
    const d = `${ym}-${hoje.slice(8, 10)}`;
    return d > fim ? fim : d;
  };
  switch (chave) {
    case "mesAnterior": {
      const m = mesesAntes(mesDeHoje, 1), a = mesesAntes(mesDeHoje, 2);
      de = `${m}-01`; ate = ultimoDia(m); deAnt = `${a}-01`; ateAnt = ultimoDia(a);
      rotulo = mesCurto(m); rotuloAnt = mesCurto(a);
      break;
    }
    case "90d": {
      ate = hoje; de = somarDias(hoje, -89); ateAnt = somarDias(de, -1); deAnt = somarDias(de, -90);
      rotulo = `90 dias (${diaCurto(de)} a hoje)`; rotuloAnt = `${diaCurto(deAnt)} a ${diaCurto(ateAnt)}`;
      break;
    }
    case "ano": {
      const ano = Number(hoje.slice(0, 4));
      de = `${ano}-01-01`; ate = hoje; deAnt = `${ano - 1}-01-01`;
      ateAnt = `${ano - 1}${hoje.slice(4)}`;
      if (ateAnt.endsWith("-02-29")) ateAnt = `${ano - 1}-02-28`;
      rotulo = `${ano} até hoje`; rotuloAnt = `${ano - 1} até ${diaCurto(ateAnt).slice(0, 5)}`;
      break;
    }
    case "mesEspecifico": {
      const m = extra.mes && /^\d{4}-\d{2}$/.test(extra.mes) && extra.mes <= mesDeHoje ? extra.mes : mesDeHoje;
      const a = mesesAntes(m, 1);
      de = `${m}-01`; deAnt = `${a}-01`;
      if (m === mesDeHoje) { ate = hoje; ateAnt = mesmoDiaNoMes(a); rotulo = `${mesCurto(m)} (até hoje)`; rotuloAnt = `${mesCurto(a)} no mesmo ponto`; }
      else { ate = ultimoDia(m); ateAnt = ultimoDia(a); rotulo = mesCurto(m); rotuloAnt = mesCurto(a); }
      break;
    }
    case "intervalo": {
      let d1 = valido(extra.de) ? extra.de! : `${mesDeHoje}-01`;
      let d2 = valido(extra.ate) ? extra.ate! : hoje;
      if (d1 > d2) [d1, d2] = [d2, d1];
      if (d2 > hoje) d2 = hoje;
      if (d1 > d2) d1 = d2;
      const n = diasNoPeriodo(d1, d2);
      de = d1; ate = d2; ateAnt = somarDias(d1, -1); deAnt = somarDias(d1, -n);
      rotulo = `${diaCurto(de)} a ${diaCurto(ate)}`; rotuloAnt = `${diaCurto(deAnt)} a ${diaCurto(ateAnt)}`;
      break;
    }
    default: {
      const a = mesesAntes(mesDeHoje, 1);
      de = `${mesDeHoje}-01`; ate = hoje; deAnt = `${a}-01`; ateAnt = mesmoDiaNoMes(a);
      rotulo = `${mesCurto(mesDeHoje)} (até hoje)`; rotuloAnt = `${mesCurto(a)} no mesmo ponto`;
      chave = "mes";
    }
  }
  return {
    chave, rotulo, rotuloDoAnterior: rotuloAnt, de, ate, deAnterior: deAnt, ateAnterior: ateAnt,
    meses: mesesDaFaixa(de, ate), anteriores: mesesDaFaixa(deAnt, ateAnt), parcial: ate === hoje,
  };
}

/** Variação em % (null sem base) — a mesma conta do perfil da loja. */
export const variacao = (atual: number, anterior: number) => tendencia(atual, anterior);

/** Uma janela em instantes [inicio, fim) — o banco converte os dias pelo dia operacional. */
export type Janela = { inicio: Date; fim: Date };

/**
 * Quanto de um mês cai dentro da janela (0 a 1). Mensalidade e serviço são por
 * mês; um período que pega meio mês leva metade do mês (rateio pelos dias).
 * O mês corrente está acumulado só até agora: a fração é sobre [início, agora).
 */
export function coberturaDoMes(mes: { inicio: Date; fim: Date }, j: Janela, agora: Date, corrente: boolean): number {
  const fimDoMes = corrente ? Math.min(mes.fim.getTime(), agora.getTime()) : mes.fim.getTime();
  const total = fimDoMes - mes.inicio.getTime();
  if (total <= 0) return 0;
  const sobra = Math.min(fimDoMes, j.fim.getTime()) - Math.max(mes.inicio.getTime(), j.inicio.getTime());
  return Math.max(0, Math.min(1, sobra / total));
}

// ═════════════════════════════════════════════════════════════════════════════
// RECEITA DO FIREHUB NUMA LOJA, NUM MÊS
// ═════════════════════════════════════════════════════════════════════════════

export type CicloDaReceita = {
  yearMonth: string;
  status: string;
  amountDue: number;
  amountPending: number;
  paidValue: number | null;
  paidAt: string | Date | null;
  asaasPaymentId: string | null;
  asaasStatus: string | null;
  metaAdsFee: number;
  totemFee: number;
};

/**
 * Serviços pagos no mês, em R$ (da assinatura de cada um). `disparo` é a
 * MARGEM das recargas pagas (o que fica com o FireHub); `disparoBruto`, o
 * valor cobrado da loja — só informativo.
 */
export type ServicosDoMes = { bill: number; app: number; multimarcas: number; totem: number; trafego: number; disparo: number; disparoBruto: number };
export const SERVICOS_VAZIOS: ServicosDoMes = { bill: 0, app: 0, multimarcas: 0, totem: 0, trafego: 0, disparo: 0, disparoBruto: 0 };
export type ChaveDoServico = Exclude<keyof ServicosDoMes, "disparoBruto"> | "outros";
export const NOME_DO_SERVICO: Record<ChaveDoServico, string> = {
  bill: "Bill", app: "App da loja", multimarcas: "Multimarcas", totem: "Totem", trafego: "Tráfego pago", disparo: "Disparo (margem)", outros: "Lojas extras / outros",
};

export type ReceitaDoMes = {
  /** Mês aberto = estimativa do ciclo + serviços; mês fechado = o faturado. */
  previsto: number;
  /** Boleto emitido (não cancelado) + margem das recargas de disparo pagas. */
  faturado: number;
  /** Boleto pago + margem das recargas. */
  recebido: number;
  /** Boleto emitido e não pago. */
  emAberto: number;
  mensalidade: number;
  /** O que entra no boleto (base da comissão que o split paga). */
  boleto: number;
  servicos: Record<ChaveDoServico, number>;
  /** Disparo: valor cobrado da loja (a margem está em servicos.disparo). */
  disparoBruto: number;
};

const c2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const CANCELADO = new Set(["DELETED", "REFUNDED"]);
const semServicos = (): Record<ChaveDoServico, number> => ({ bill: 0, app: 0, multimarcas: 0, totem: 0, trafego: 0, disparo: 0, outros: 0 });

/**
 * A receita do FireHub numa loja num mês.
 *  • Ciclo ABERTO: previsto = `amountDue` (zero em teste/isenta) + tráfego e
 *    totem do ciclo + Bill, App e Multimarcas ativos + margem do disparo.
 *  • Mês FECHADO com boleto (não cancelado): faturado = boleto (pago:
 *    `paidValue`; aberto: `amountPending`) + margem do disparo; recebido =
 *    boleto pago + margem; em aberto = CLOSED com pendente. O boleto é
 *    distribuído: mensalidade (`amountDue`), serviços conhecidos, sobra = outros.
 *  • Sem boleto (isenta, teste, nada a cobrar, cancelado): só o disparo.
 */
export function receitaDoMes(ciclo: CicloDaReceita | null, servicos: ServicosDoMes, isenta: boolean): ReceitaDoMes {
  const disparo = c2(servicos.disparo);
  const disparoBruto = c2(servicos.disparoBruto);
  const zero: ReceitaDoMes = {
    previsto: disparo, faturado: disparo, recebido: disparo, emAberto: 0, mensalidade: 0, boleto: 0,
    servicos: { ...semServicos(), disparo }, disparoBruto,
  };
  if (isenta) return zero;

  if (!ciclo || ciclo.status === "OPEN") {
    const mensalidade = c2(ciclo?.amountDue ?? 0);
    const s = {
      ...semServicos(),
      bill: c2(servicos.bill), app: c2(servicos.app), multimarcas: c2(servicos.multimarcas),
      totem: c2(ciclo ? ciclo.totemFee : servicos.totem), trafego: c2(ciclo ? ciclo.metaAdsFee : servicos.trafego), disparo,
    };
    const boleto = c2(mensalidade + s.bill + s.app + s.multimarcas + s.totem + s.trafego);
    return { previsto: c2(boleto + disparo), faturado: disparo, recebido: disparo, emAberto: 0, mensalidade, boleto, servicos: s, disparoBruto };
  }

  const temBoleto = !!ciclo.asaasPaymentId && !CANCELADO.has(String(ciclo.asaasStatus || "").toUpperCase());
  if (!temBoleto) return zero;
  const pago = ciclo.status === "PAID";
  const boleto = c2(pago ? (ciclo.paidValue ?? ciclo.amountDue) : ciclo.amountPending);
  if (boleto <= 0) return zero;
  const mensalidade = c2(Math.min(Math.max(0, ciclo.amountDue), boleto));
  let resto = c2(boleto - mensalidade);
  const tira = (v: number) => { const x = c2(Math.min(Math.max(0, v), resto)); resto = c2(resto - x); return x; };
  const s = {
    ...semServicos(),
    app: tira(servicos.app), bill: tira(servicos.bill), multimarcas: tira(servicos.multimarcas),
    totem: tira(ciclo.totemFee), trafego: tira(ciclo.metaAdsFee), disparo,
  };
  s.outros = resto;
  return {
    previsto: c2(boleto + disparo), faturado: c2(boleto + disparo), recebido: c2((pago ? boleto : 0) + disparo),
    emAberto: !pago && ciclo.status === "CLOSED" && ciclo.amountPending > 0 ? c2(ciclo.amountPending) : 0,
    mensalidade, boleto, servicos: s, disparoBruto,
  };
}

/** A receita multiplicada por uma fração (o rateio do mês dentro do período). */
export function proporcional(r: ReceitaDoMes, f: number): ReceitaDoMes {
  const s = semServicos();
  for (const k of Object.keys(s) as ChaveDoServico[]) s[k] = c2(r.servicos[k] * f);
  return {
    previsto: c2(r.previsto * f), faturado: c2(r.faturado * f), recebido: c2(r.recebido * f), emAberto: c2(r.emAberto * f),
    mensalidade: c2(r.mensalidade * f), boleto: c2(r.boleto * f), servicos: s, disparoBruto: c2(r.disparoBruto * f),
  };
}

export function somarReceitas(rs: ReceitaDoMes[]): ReceitaDoMes {
  const t: ReceitaDoMes = { previsto: 0, faturado: 0, recebido: 0, emAberto: 0, mensalidade: 0, boleto: 0, servicos: semServicos(), disparoBruto: 0 };
  for (const r of rs) {
    t.previsto += r.previsto; t.faturado += r.faturado; t.recebido += r.recebido; t.emAberto += r.emAberto;
    t.mensalidade += r.mensalidade; t.boleto += r.boleto; t.disparoBruto += r.disparoBruto;
    for (const k of Object.keys(t.servicos) as ChaveDoServico[]) t.servicos[k] += r.servicos[k];
  }
  return proporcional(t, 1);
}

/**
 * A margem do FireHub numa recarga de disparo: valor − disparos × custo da
 * Meta. O custo vem da recarga (gravado na hora: "Custo Meta na hora: R$
 * 0.3217"); sem ele, o custo atual do servidor — e a margem fica "estimada".
 */
export function margemDaRecarga(r: { valor: number; disparos: number; custoPorDisparo: number | null }, custoAtual: number): { bruto: number; margem: number; estimada: boolean } {
  const custo = r.custoPorDisparo && r.custoPorDisparo > 0 ? r.custoPorDisparo : custoAtual;
  return { bruto: c2(r.valor), margem: c2(Math.max(0, r.valor - r.disparos * custo)), estimada: !(r.custoPorDisparo && r.custoPorDisparo > 0) };
}

/** O custo gravado na descrição da recarga ("Custo Meta na hora: R$ 0.3217"), ou null. */
export function custoDaDescricao(descricao: string | null | undefined): number | null {
  const m = String(descricao || "").match(/Custo Meta na hora:\s*R\$\s*([0-9]+(?:[.,][0-9]+)?)/i);
  if (!m) return null;
  const n = Number(m[1].replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ═════════════════════════════════════════════════════════════════════════════
// SITUAÇÃO DA LOJA NUM MÊS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Régua MENSAL (para comparar períodos), com os cortes do perfil:
 *   NOVA cadastrada no mês ou ainda em teste no fim dele · PARADA 0 vendas no mês ·
 *   ESFRIANDO ≤ 70% do mês anterior (base ≥ 20; mês corrente projetado) · ATIVA o resto.
 */
export function situacaoNoMes(e: {
  criadaEm: string; testeAte: string | null; mes: string; inicioDoMes: Date; fimDoMes: Date;
  vendas: number; vendasDoMesAnterior: number; fracaoDoMes: number;
}): StatusDaAtividade {
  const criada = new Date(e.criadaEm).getTime();
  const teste = e.testeAte ? new Date(e.testeAte).getTime() : null;
  const fr = Math.min(1, Math.max(0.01, e.fracaoDoMes));
  const fimEfetivo = e.fimDoMes.getTime() - (1 - fr) * (e.fimDoMes.getTime() - e.inicioDoMes.getTime());
  if (criada >= e.inicioDoMes.getTime() || (teste !== null && teste > fimEfetivo)) return "NOVA";
  if (e.vendas <= 0) return "PARADA";
  if (e.vendasDoMesAnterior >= 20 && e.vendas / fr <= e.vendasDoMesAnterior * 0.7) return "ESFRIANDO";
  return "ATIVA";
}

// ═════════════════════════════════════════════════════════════════════════════
// A LOJA NA ANÁLISE
// ═════════════════════════════════════════════════════════════════════════════

export type MesDaLoja = {
  vendas: number;
  gmv: number;
  receita: ReceitaDoMes;
  /** Comissão do DONO DA CARTEIRA (a que o split paga: sobre o boleto). */
  comissaoPrevista: number;
  comissaoRecebida: number;
  /** 3% da margem do disparo para o vendedor que atende (split de valor fixo na recarga). */
  comissaoDoDisparo: number;
};

export type UpsellDaLoja = { servico: Exclude<keyof ServicosDoMes, "disparoBruto">; em: string; valorMensal: number };

/**
 * De onde a loja veio para ESTA carteira:
 *   LINK       pelo link de convite do vendedor (ambassadorId = ele)
 *   ATRIBUIDA  posta na carteira pelo admin (vendedorId = ele)
 *   INDICACAO  indicada por um embaixador que não é vendedor (as indicações dele)
 *   SEM        sem vendedor nem embaixador
 */
export type OrigemNaCarteira = "LINK" | "ATRIBUIDA" | "INDICACAO" | "SEM";

export type LojaDaAnalise = {
  id: string;
  nome: string;
  cidade: string | null;
  criadaEm: string;
  testeAte: string | null;
  /** Quando entrou NESTA carteira (atribuída: vendedorAtribuidoEm; link/indicação/sem: cadastro). */
  desde: string;
  isenta: boolean;
  origem: OrigemNaCarteira;
  /** % que o split paga ao dono da carteira nesta loja (null = ninguém ganha). */
  percentual: number | null;
  meses: Record<string, MesDaLoja>;
  /** Vendas nos dias exatos do período e do anterior (régua dos relatórios). */
  faixa: { atual: { vendas: number; gmv: number }; anterior: { vendas: number; gmv: number } };
  primeiroPagamentoEm: string | null;
  bloqueadaAgora: boolean;
  upsell: UpsellDaLoja[];
  /** Do perfil (agora). */
  agora: {
    status: StatusDaAtividade;
    diasSemVenda: number | null;
    valor30: number;
    valor30Anterior: number;
    oportunidadesDeVenda: number;
    potencialMensal: number;
    oportunidadesDeAdocao: number;
    produtos: string[];
  } | null;
};

export type RegraDeComissao = {
  /** % do cadastro (o que o split paga) para loja do link / atribuída. null = não se aplica. */
  link: number | null;
  atribuida: number | null;
  combinado: typeof COMISSAO_COMBINADA;
  /** Avisos de cadastro diferente do combinado. */
  divergencias: string[];
};

export type CarteiraDaAnalise = {
  /** Ambassador.id, ou "sem" (lojas sem vendedor nem embaixador — a carteira do Douglas). */
  id: string;
  nome: string;
  papel: "VENDEDOR" | "EMBAIXADOR" | "SEM_VENDEDOR";
  ativo: boolean;
  regra: RegraDeComissao | null;
  lojas: LojaDaAnalise[];
};

/** O que o cadastro paga × o combinado (as divergências só valem para quem vende). */
export function regraDeComissao(p: { isVendedor: boolean; commissionPercent: number; sellerPercent: number }): RegraDeComissao {
  if (!p.isVendedor) return { link: p.commissionPercent, atribuida: null, combinado: COMISSAO_COMBINADA, divergencias: [] };
  const divergencias: string[] = [];
  if (p.commissionPercent !== COMISSAO_COMBINADA.LINK) {
    divergencias.push(`Lojas do link de convite: o cadastro paga ${p.commissionPercent}% (combinado ${COMISSAO_COMBINADA.LINK}%). Ajuste o % de comissão dele em Embaixadores.`);
  }
  if (p.sellerPercent !== COMISSAO_COMBINADA.ATRIBUIDA) {
    divergencias.push(`Lojas atribuídas: o cadastro paga ${p.sellerPercent}% (combinado ${COMISSAO_COMBINADA.ATRIBUIDA}%).`);
  }
  return { link: p.commissionPercent, atribuida: p.sellerPercent, combinado: COMISSAO_COMBINADA, divergencias };
}

/**
 * Em que carteira(s) a loja aparece, com a origem — a regra do split (quem
 * ATENDE é o dono): o vendedor atribuído (LINK se foi ele quem convidou,
 * ATRIBUIDA se não); sem atribuído, o vendedor que convidou (LINK). Vendedor
 * que convidou e não atende não vê a loja. O embaixador que NÃO vende também
 * a vê, nas indicações dele.
 */
export function donosDaLoja(
  loja: { vendedorId: string | null; ambassadorId: string | null },
  ehVendedor: (id: string) => boolean,
): { carteira: string; origem: OrigemNaCarteira }[] {
  const a = loja.ambassadorId, v = loja.vendedorId;
  const saida: { carteira: string; origem: OrigemNaCarteira }[] = [];
  if (v && ehVendedor(v)) saida.push({ carteira: v, origem: a === v ? "LINK" : "ATRIBUIDA" });
  else if (a && ehVendedor(a)) saida.push({ carteira: a, origem: "LINK" });
  if (a && !ehVendedor(a)) saida.push({ carteira: a, origem: "INDICACAO" });
  if (!saida.length) saida.push({ carteira: "sem", origem: "SEM" });
  return saida;
}

/** Atividade comercial do CRM (lib/crm/desempenho.ts), para o vendedor. */
export type AtividadeComercial = {
  leads: number;
  conversas: number;
  mensagens: number;
  tempoAtePrimeiroContatoMin: number | null;
  esperando: number;
  demosMarcadas: number;
  demosFeitas: number;
  demosFaltou: number;
  proximasDemos: number;
  cadastros: number;
  clientes: number;
  perdidos: number;
};

// ═════════════════════════════════════════════════════════════════════════════
// AS CONTAS DE UMA CARTEIRA NUM PERÍODO
// ═════════════════════════════════════════════════════════════════════════════

export type NumerosDoPeriodo = {
  lojas: number;
  porOrigem: Record<OrigemNaCarteira, number>;
  porSituacao: Record<StatusDaAtividade, number>;
  novas: number;
  novasForaDoTeste: number;
  novasPagantes: number;
  conversaoPct: number | null;
  perdidas: number;
  perdidasNomes: string[];
  vendas: number;
  gmv: number;
  receita: ReceitaDoMes;
  comissaoPrevista: number;
  comissaoRecebida: number;
  comissaoDoDisparo: number;
  upsell: number;
  upsellMensal: number;
};

export type Contexto = {
  intervalos: Record<string, { inicio: Date; fim: Date }>;
  agora: Date;
  mesCorrente: string;
  fracaoDoMesCorrente: number;
};

/**
 * Os números de uma carteira numa janela.
 *  lojas         na carteira no fim da janela (entraram antes do fim)
 *  porSituacao   `situacaoNoMes` no mês em que a janela termina
 *  novas         cadastradas na janela; conversão = pagaram um boleto ÷ já saíram do teste
 *  perdidas      venderam num mês, ficaram o mês seguinte inteiro sem vender e não voltaram
 *                até o fim da janela (no mês corrente: sem venda há 30+ dias)
 *  gmv, vendas   os dias exatos da janela (`faixa`)
 *  receita       meses da janela × a parte do mês dentro dela (rateio por dias), só depois que
 *                a loja entrou na carteira; comissão idem
 *  upsell        serviço pago que começou dentro da janela
 */
export function numerosDaJanela(lojas: LojaDaAnalise[], j: Janela, meses: string[], qual: "atual" | "anterior", ctx: Contexto): NumerosDoPeriodo {
  const fimMs = j.fim.getTime();
  const iniMs = j.inicio.getTime();
  const ultimo = meses[meses.length - 1];
  const porSituacao: Record<StatusDaAtividade, number> = { ATIVA: 0, ESFRIANDO: 0, PARADA: 0, NOVA: 0 };
  const porOrigem: Record<OrigemNaCarteira, number> = { LINK: 0, ATRIBUIDA: 0, INDICACAO: 0, SEM: 0 };
  let n = 0, novas = 0, novasFora = 0, novasPag = 0, perdidas = 0, vendas = 0, gmv = 0, comP = 0, comR = 0, comD = 0, upsell = 0, upsellMensal = 0;
  const perdidasNomes: string[] = [];
  const receitas: ReceitaDoMes[] = [];
  const intUltimo = ctx.intervalos[ultimo];
  const fimDoUltimo = ultimo === ctx.mesCorrente ? Math.min(fimMs, ctx.agora.getTime()) : Math.min(fimMs, intUltimo.fim.getTime());
  const fracaoDoUltimo = Math.min(1, Math.max(0.01, (fimDoUltimo - intUltimo.inicio.getTime()) / (intUltimo.fim.getTime() - intUltimo.inicio.getTime())));

  for (const l of lojas) {
    const desde = new Date(l.desde).getTime();
    if (desde >= fimMs || new Date(l.criadaEm).getTime() >= fimMs) continue;
    n++;
    porOrigem[l.origem]++;
    const mes = (ym: string) => l.meses[ym];
    porSituacao[situacaoNoMes({
      criadaEm: l.criadaEm, testeAte: l.testeAte, mes: ultimo, inicioDoMes: intUltimo.inicio, fimDoMes: intUltimo.fim,
      vendas: mes(ultimo)?.vendas ?? 0, vendasDoMesAnterior: mes(mesesAntes(ultimo, 1))?.vendas ?? 0, fracaoDoMes: fracaoDoUltimo,
    })]++;

    const criada = new Date(l.criadaEm).getTime();
    if (criada >= iniMs && criada < fimMs) {
      novas++;
      const fimDoTeste = l.testeAte ? new Date(l.testeAte).getTime() : criada + 15 * 86_400_000;
      if (fimDoTeste <= ctx.agora.getTime()) { novasFora++; if (l.primeiroPagamentoEm) novasPag++; }
    }

    const sequencia = [mesesAntes(meses[0], 1), ...meses];
    let parou = false;
    for (let i = 1; i < sequencia.length; i++) {
      const v = mes(sequencia[i])?.vendas ?? 0;
      const vAntes = mes(sequencia[i - 1])?.vendas ?? 0;
      const corrente = sequencia[i] === ctx.mesCorrente;
      const semVenda = v === 0 && (!corrente || !l.agora || l.agora.diasSemVenda === null || l.agora.diasSemVenda >= 30);
      if (semVenda && vAntes > 0) parou = true;
      else if (v > 0) parou = false;
    }
    if (parou) { perdidas++; perdidasNomes.push(l.nome); }

    vendas += l.faixa[qual].vendas;
    gmv += l.faixa[qual].gmv;

    // Só a parte do período em que a loja já estava na carteira.
    const janelaDaLoja: Janela = { inicio: new Date(Math.max(iniMs, desde)), fim: j.fim };
    for (const ym of meses) {
      const m = mes(ym);
      const int = ctx.intervalos[ym];
      if (!m || !int) continue;
      const f = coberturaDoMes(int, janelaDaLoja, ctx.agora, ym === ctx.mesCorrente);
      if (f <= 0) continue;
      receitas.push(proporcional(m.receita, f));
      comP += m.comissaoPrevista * f;
      comR += m.comissaoRecebida * f;
      comD += m.comissaoDoDisparo * f;
    }

    for (const u of l.upsell) {
      const em = new Date(u.em).getTime();
      if (em >= iniMs && em < fimMs) { upsell++; upsellMensal += u.valorMensal; }
    }
  }

  return {
    lojas: n, porOrigem, porSituacao, novas, novasForaDoTeste: novasFora, novasPagantes: novasPag,
    conversaoPct: novasFora > 0 ? Math.round((novasPag / novasFora) * 100) : null,
    perdidas, perdidasNomes, vendas, gmv: c2(gmv), receita: somarReceitas(receitas),
    comissaoPrevista: c2(comP), comissaoRecebida: c2(comR), comissaoDoDisparo: c2(comD), upsell, upsellMensal: c2(upsellMensal),
  };
}

/** Agora (do perfil): risco, oportunidades e bloqueio — não têm "período anterior". */
export function numerosDeAgora(lojas: LojaDaAnalise[]) {
  let emRisco = 0, gmvEmRisco = 0, oportunidades = 0, potencial = 0, adocao = 0, bloqueadas = 0;
  const porStatus: Record<StatusDaAtividade, number> = { ATIVA: 0, ESFRIANDO: 0, PARADA: 0, NOVA: 0 };
  for (const l of lojas) {
    if (l.bloqueadaAgora) bloqueadas++;
    if (!l.agora) continue;
    porStatus[l.agora.status]++;
    if ((l.agora.status === "ESFRIANDO" || l.agora.status === "PARADA") && l.agora.diasSemVenda !== null) {
      emRisco++;
      gmvEmRisco += l.agora.valor30Anterior;
    }
    oportunidades += l.agora.oportunidadesDeVenda;
    potencial += l.agora.potencialMensal;
    adocao += l.agora.oportunidadesDeAdocao;
  }
  return { porStatus, emRisco, gmvEmRisco: c2(gmvEmRisco), oportunidades, potencial: c2(potencial), adocao, bloqueadas };
}

export type ResumoDaCarteira = {
  id: string;
  nome: string;
  papel: CarteiraDaAnalise["papel"];
  ativo: boolean;
  regra: RegraDeComissao | null;
  atual: NumerosDoPeriodo;
  anterior: NumerosDoPeriodo;
  agora: ReturnType<typeof numerosDeAgora>;
  crm: { atual: AtividadeComercial; anterior: AtividadeComercial } | null;
  variacao: { lojas: number | null; gmv: number | null; receita: number | null; comissao: number | null; vendas: number | null };
};

export function resumirCarteira(
  c: CarteiraDaAnalise,
  periodo: PeriodoDaAnalise,
  janelas: { atual: Janela; anterior: Janela },
  ctx: Contexto,
  crm: { atual: AtividadeComercial; anterior: AtividadeComercial } | null,
): ResumoDaCarteira {
  const atual = numerosDaJanela(c.lojas, janelas.atual, periodo.meses, "atual", ctx);
  const anterior = numerosDaJanela(c.lojas, janelas.anterior, periodo.anteriores, "anterior", ctx);
  return {
    id: c.id, nome: c.nome, papel: c.papel, ativo: c.ativo, regra: c.regra, atual, anterior,
    agora: numerosDeAgora(c.lojas),
    crm,
    variacao: {
      lojas: variacao(atual.lojas, anterior.lojas),
      gmv: variacao(atual.gmv, anterior.gmv),
      receita: variacao(atual.receita.previsto, anterior.receita.previsto),
      comissao: variacao(atual.comissaoPrevista, anterior.comissaoPrevista),
      vendas: variacao(atual.vendas, anterior.vendas),
    },
  };
}

/** A evolução mês a mês de uma carteira (o gráfico do detalhe). */
export type MesDaEvolucao = {
  mes: string;
  lojas: number;
  ativas: number;
  vendas: number;
  gmv: number;
  previsto: number;
  faturado: number;
  recebido: number;
  comissao: number;
};

export function evolucaoDaCarteira(c: CarteiraDaAnalise, meses: string[], ctx: Contexto): MesDaEvolucao[] {
  return meses.map((ym) => {
    const int = ctx.intervalos[ym];
    let lojas = 0, ativas = 0, vendas = 0, gmv = 0, previsto = 0, faturado = 0, recebido = 0, comissao = 0;
    for (const l of c.lojas) {
      if (new Date(l.desde).getTime() >= int.fim.getTime() || new Date(l.criadaEm).getTime() >= int.fim.getTime()) continue;
      lojas++;
      const m = l.meses[ym];
      const s = situacaoNoMes({
        criadaEm: l.criadaEm, testeAte: l.testeAte, mes: ym, inicioDoMes: int.inicio, fimDoMes: int.fim,
        vendas: m?.vendas ?? 0, vendasDoMesAnterior: l.meses[mesesAntes(ym, 1)]?.vendas ?? 0,
        fracaoDoMes: ym === ctx.mesCorrente ? ctx.fracaoDoMesCorrente : 1,
      });
      if (s === "ATIVA" || s === "ESFRIANDO") ativas++;
      if (!m) continue;
      vendas += m.vendas; gmv += m.gmv;
      previsto += m.receita.previsto; faturado += m.receita.faturado; recebido += m.receita.recebido;
      comissao += m.comissaoPrevista;
    }
    return { mes: ym, lojas, ativas, vendas, gmv: c2(gmv), previsto: c2(previsto), faturado: c2(faturado), recebido: c2(recebido), comissao: c2(comissao) };
  });
}

export type OrdemDoComparativo = "receita" | "gmv" | "lojas" | "crescimento" | "risco" | "conversao";

export function ordenarCarteiras(cs: ResumoDaCarteira[], ordem: OrdemDoComparativo): ResumoDaCarteira[] {
  const valor = (c: ResumoDaCarteira): number => {
    switch (ordem) {
      case "gmv": return c.atual.gmv;
      case "lojas": return c.atual.lojas;
      case "crescimento": return c.variacao.gmv ?? -Infinity;
      case "risco": return c.agora.gmvEmRisco;
      case "conversao": return c.atual.conversaoPct ?? -Infinity;
      default: return c.atual.receita.previsto;
    }
  };
  return [...cs].sort((a, b) => valor(b) - valor(a) || a.nome.localeCompare(b.nome));
}

/** O comparativo em CSV (";" e vírgula decimal, para o Excel em pt-BR). */
export function csvDoComparativo(cs: ResumoDaCarteira[], periodo: PeriodoDaAnalise): string {
  const esc = (v: unknown) => { const t = String(v ?? ""); return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const num = (v: number | null | undefined) => (v === null || v === undefined ? "" : (Math.round(v * 100) / 100).toFixed(2).replace(".", ","));
  const pct = (v: number | null) => (v === null ? "" : String(v));
  const cab = [
    "Carteira", "Papel", "Período", "Anterior", "Lojas", "Lojas (anterior)", "Pelo link", "Atribuídas", "Indicadas (embaixador)",
    "Ativas", "Esfriando", "Paradas", "Novas", "Novas pagantes", "Conversão do teste %", "Perdidas", "Vendas", "GMV", "GMV anterior", "Variação GMV %",
    "Receita prevista", "Receita faturada", "Receita recebida", "Em aberto", "Mensalidades", "Serviços no boleto", "Disparo bruto", "Disparo margem",
    "Receita anterior", "Variação receita %", "% link (cadastro)", "% atribuída (cadastro)", "Comissão prevista", "Comissão recebida", "Comissão sobre margem do disparo (sem split)",
    "Upsell (serviços novos)", "Oportunidades de venda (agora)", "Potencial R$/mês", "Lojas em risco (agora)", "GMV em risco",
    "Leads (CRM)", "Conversas", "Tempo até 1º contato (min)", "Demos feitas", "Cadastros", "Clientes (CRM)",
  ];
  const linhas = cs.map((c) => {
    const a = c.atual;
    return [
      c.nome, c.papel, periodo.rotulo, periodo.rotuloDoAnterior, a.lojas, c.anterior.lojas, a.porOrigem.LINK, a.porOrigem.ATRIBUIDA, a.porOrigem.INDICACAO,
      a.porSituacao.ATIVA, a.porSituacao.ESFRIANDO, a.porSituacao.PARADA, a.porSituacao.NOVA, a.novasPagantes, pct(a.conversaoPct), a.perdidas,
      a.vendas, num(a.gmv), num(c.anterior.gmv), pct(c.variacao.gmv),
      num(a.receita.previsto), num(a.receita.faturado), num(a.receita.recebido), num(a.receita.emAberto), num(a.receita.mensalidade),
      num(a.receita.boleto - a.receita.mensalidade), num(a.receita.disparoBruto), num(a.receita.servicos.disparo),
      num(c.anterior.receita.previsto), pct(c.variacao.receita), c.regra?.link ?? "", c.regra?.atribuida ?? "",
      num(a.comissaoPrevista), num(a.comissaoRecebida), num(a.comissaoDoDisparo),
      a.upsell, c.agora.oportunidades, num(c.agora.potencial), c.agora.emRisco, num(c.agora.gmvEmRisco),
      c.crm?.atual.leads ?? "", c.crm?.atual.conversas ?? "", c.crm?.atual.tempoAtePrimeiroContatoMin ?? "", c.crm?.atual.demosFeitas ?? "", c.crm?.atual.cadastros ?? "", c.crm?.atual.clientes ?? "",
    ].map(esc).join(";");
  });
  return "﻿" + [cab.join(";"), ...linhas].join("\r\n");
}

/** Exemplo numérico do "Como você ganha": um boleto e a comissão por origem. */
export function exemploDeComissao(regra: { link: number | null; atribuida: number | null }, custoMeta = 0.3217) {
  const faturamento = 10_000;
  const mensalidade = Math.min(400, Math.max(100, faturamento * 0.02));
  const app = 149;
  const boleto = mensalidade + app;
  const recarga = { valor: 46, disparos: 100, custo: custoMeta };
  const margem = c2(recarga.valor - recarga.disparos * recarga.custo);
  return {
    faturamento, mensalidade, app, boleto, recarga, margem,
    link: regra.link === null ? null : c2((boleto * regra.link) / 100),
    atribuida: regra.atribuida === null ? null : c2((boleto * regra.atribuida) / 100),
    /** Disparo: sempre 3% da margem, venha a loja do link ou não. */
    disparo: Math.floor(margem * COMISSAO_COMBINADA.DISPARO) / 100,
  };
}
