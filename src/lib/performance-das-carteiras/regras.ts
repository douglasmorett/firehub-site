/**
 * A PERFORMANCE DAS CARTEIRAS — as contas puras (sem banco). Pedido do Douglas,
 * 18/10/2026: "eu vejo tudo e vejo a carteira de cada vendedor separado; também
 * análise de performance por carteira do vendedor, detalhada".
 *
 * O banco (lib/performance-das-carteiras/no-banco.ts) entrega, por loja e por
 * mês, as vendas na régua, o ciclo da mensalidade e os serviços pagos; daqui
 * saem a receita (prevista / faturada / recebida / em aberto), a situação da
 * loja no mês, as perdas, a conversão do teste, o comparativo entre carteiras
 * e a variação contra o período anterior.
 *
 * Testado em scripts/teste-performance-das-carteiras.ts.
 */
import { mesesAntes } from "@/lib/parceiro/regras";
import { tendencia, type StatusDaAtividade } from "@/lib/perfil-da-loja/regras";

// ═════════════════════════════════════════════════════════════════════════════
// PERÍODOS
// ═════════════════════════════════════════════════════════════════════════════

export type ChaveDoPeriodo = "mes" | "mesAnterior" | "3m" | "12m";

export type PeriodoDaAnalise = {
  chave: ChaveDoPeriodo;
  rotulo: string;
  rotuloDoAnterior: string;
  /** Meses "YYYY-MM" do período, do mais antigo ao mais novo. */
  meses: string[];
  anteriores: string[];
  /** O último mês do período é o corrente (ainda andando). */
  parcial: boolean;
};

export const PERIODOS: { chave: ChaveDoPeriodo; rotulo: string }[] = [
  { chave: "mes", rotulo: "Mês atual" },
  { chave: "mesAnterior", rotulo: "Mês anterior" },
  { chave: "3m", rotulo: "90 dias (3 meses)" },
  { chave: "12m", rotulo: "Ano (12 meses)" },
];

const NOMES_DOS_MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export const mesCurto = (ym: string) => `${NOMES_DOS_MESES[Number(ym.slice(5, 7)) - 1]}/${ym.slice(2, 4)}`;

/** n meses terminando em `ultimo`, do mais antigo ao mais novo. */
export function mesesAte(ultimo: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => mesesAntes(ultimo, n - 1 - i));
}

/**
 * Os períodos são MESES fechados do calendário (a mensalidade e a comissão são
 * por mês). "Mês atual" compara o mês até hoje com o anterior; o faturamento
 * do anterior é cortado no MESMO ponto do mês (`gmvNoCorte`), para não comparar
 * meio mês com um mês inteiro.
 */
export function periodoDaAnalise(chave: ChaveDoPeriodo, mesAtual: string): PeriodoDaAnalise {
  const n = chave === "3m" ? 3 : chave === "12m" ? 12 : 1;
  const ultimo = chave === "mesAnterior" ? mesesAntes(mesAtual, 1) : mesAtual;
  const meses = mesesAte(ultimo, n);
  const anteriores = mesesAte(mesesAntes(meses[0], 1), n);
  const faixa = (m: string[]) => (m.length === 1 ? mesCurto(m[0]) : `${mesCurto(m[0])} a ${mesCurto(m[m.length - 1])}`);
  return {
    chave,
    rotulo: chave === "mes" ? `${mesCurto(meses[0])} (até hoje)` : faixa(meses),
    rotuloDoAnterior: chave === "mes" ? `${mesCurto(anteriores[0])} no mesmo ponto` : faixa(anteriores),
    meses,
    anteriores,
    parcial: ultimo === mesAtual,
  };
}

/** Variação em % (null sem base) — a mesma conta do perfil da loja. */
export const variacao = (atual: number, anterior: number) => tendencia(atual, anterior);

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

/** Serviços pagos no mês, em R$ (da assinatura de cada um; disparo = recargas pagas). */
export type ServicosDoMes = { bill: number; app: number; multimarcas: number; totem: number; trafego: number; disparo: number };
export const SERVICOS_VAZIOS: ServicosDoMes = { bill: 0, app: 0, multimarcas: 0, totem: 0, trafego: 0, disparo: 0 };
export const NOME_DO_SERVICO: Record<keyof ServicosDoMes | "outros", string> = {
  bill: "Bill", app: "App da loja", multimarcas: "Multimarcas", totem: "Totem", trafego: "Tráfego pago", disparo: "Disparo (recargas)", outros: "Lojas extras / outros",
};

export type ReceitaDoMes = {
  /** O que a loja deve gerar no mês: mês aberto = estimativa do ciclo + serviços; mês fechado = o faturado. */
  previsto: number;
  /** Boleto emitido (não cancelado) + recargas de disparo pagas. */
  faturado: number;
  /** Boleto pago + recargas pagas. */
  recebido: number;
  /** Boleto emitido e não pago. */
  emAberto: number;
  mensalidade: number;
  /** Por serviço; "outros" = o que o boleto tem além (lojas extras de marketplace). */
  servicos: ServicosDoMes & { outros: number };
};

const c2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const CANCELADO = new Set(["DELETED", "REFUNDED"]);

/**
 * A receita do FireHub numa loja num mês.
 *
 *  • Mês com ciclo ABERTO (o corrente, ou o anterior antes do fechamento do dia 1):
 *    previsto = mensalidade que o ciclo já soma (`amountDue`, zero em teste/isenta)
 *             + tráfego e totem do ciclo + Bill, App e Multimarcas ativos no mês
 *             + recargas de disparo pagas. Nada faturado ainda além do disparo.
 *  • Mês FECHADO com boleto (não cancelado no Asaas): faturado = valor do boleto
 *    (pago: `paidValue`; aberto: `amountPending`) + disparo; recebido = boleto
 *    pago + disparo; em aberto = boleto CLOSED com `amountPending` > 0.
 *    Mensalidade = `amountDue` (até o valor do boleto); o resto do boleto é
 *    distribuído entre os serviços conhecidos, e a sobra é "outros".
 *  • Fechado sem boleto (isenta, teste, nada a cobrar, boleto cancelado): só o disparo.
 *  • Loja isenta: a mensalidade e os serviços do boleto não entram (o fechamento pula a loja).
 */
export function receitaDoMes(ciclo: CicloDaReceita | null, servicos: ServicosDoMes, isenta: boolean): ReceitaDoMes {
  const disparo = c2(servicos.disparo);
  const zero: ReceitaDoMes = {
    previsto: disparo, faturado: disparo, recebido: disparo, emAberto: 0, mensalidade: 0,
    servicos: { ...SERVICOS_VAZIOS, disparo, outros: 0 },
  };
  if (isenta) return zero;

  if (!ciclo || ciclo.status === "OPEN") {
    const mensalidade = c2(ciclo?.amountDue ?? 0);
    const s = {
      bill: c2(servicos.bill), app: c2(servicos.app), multimarcas: c2(servicos.multimarcas),
      totem: c2(ciclo ? ciclo.totemFee : servicos.totem), trafego: c2(ciclo ? ciclo.metaAdsFee : servicos.trafego), disparo, outros: 0,
    };
    const previsto = c2(mensalidade + s.bill + s.app + s.multimarcas + s.totem + s.trafego + disparo);
    return { previsto, faturado: disparo, recebido: disparo, emAberto: 0, mensalidade, servicos: s };
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
    app: tira(servicos.app), bill: tira(servicos.bill), multimarcas: tira(servicos.multimarcas),
    totem: tira(ciclo.totemFee), trafego: tira(ciclo.metaAdsFee), disparo, outros: 0,
  };
  s.outros = resto;
  return {
    previsto: c2(boleto + disparo),
    faturado: c2(boleto + disparo),
    recebido: c2((pago ? boleto : 0) + disparo),
    emAberto: !pago && ciclo.status === "CLOSED" && ciclo.amountPending > 0 ? c2(ciclo.amountPending) : 0,
    mensalidade,
    servicos: s,
  };
}

export function somarReceitas(rs: ReceitaDoMes[]): ReceitaDoMes {
  const t: ReceitaDoMes = { previsto: 0, faturado: 0, recebido: 0, emAberto: 0, mensalidade: 0, servicos: { ...SERVICOS_VAZIOS, outros: 0 } };
  for (const r of rs) {
    t.previsto += r.previsto; t.faturado += r.faturado; t.recebido += r.recebido; t.emAberto += r.emAberto; t.mensalidade += r.mensalidade;
    for (const k of Object.keys(t.servicos) as (keyof ReceitaDoMes["servicos"])[]) t.servicos[k] += r.servicos[k];
  }
  t.previsto = c2(t.previsto); t.faturado = c2(t.faturado); t.recebido = c2(t.recebido); t.emAberto = c2(t.emAberto); t.mensalidade = c2(t.mensalidade);
  for (const k of Object.keys(t.servicos) as (keyof ReceitaDoMes["servicos"])[]) t.servicos[k] = c2(t.servicos[k]);
  return t;
}

// ═════════════════════════════════════════════════════════════════════════════
// SITUAÇÃO DA LOJA NUM MÊS (para comparar períodos)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * A régua diária do perfil (lib/perfil-da-loja) não tem como ser refeita para
 * um mês que passou sem buscar pedido por pedido. Para COMPARAR períodos vale a
 * régua mensal, com os mesmos números de corte:
 *
 *   NOVA       cadastrada no mês, ou ainda em teste no fim dele
 *   PARADA     nenhuma venda no mês
 *   ESFRIANDO  vendas do mês ≤ 70% das do mês anterior (com ≥ 20 de base)
 *   ATIVA      o resto
 *
 * No mês corrente as vendas são projetadas para o mês inteiro (vendas ÷ fração
 * do mês já passada) antes de comparar.
 */
export function situacaoNoMes(e: {
  criadaEm: string; testeAte: string | null; mes: string; inicioDoMes: Date; fimDoMes: Date;
  vendas: number; vendasDoMesAnterior: number; fracaoDoMes: number;
}): StatusDaAtividade {
  const criada = new Date(e.criadaEm).getTime();
  const teste = e.testeAte ? new Date(e.testeAte).getTime() : null;
  const fimEfetivo = e.fimDoMes.getTime() - (1 - Math.min(1, Math.max(0.01, e.fracaoDoMes))) * (e.fimDoMes.getTime() - e.inicioDoMes.getTime());
  if (criada >= e.inicioDoMes.getTime() || (teste !== null && teste > fimEfetivo)) return "NOVA";
  if (e.vendas <= 0) return "PARADA";
  const projetadas = e.vendas / Math.min(1, Math.max(0.01, e.fracaoDoMes));
  if (e.vendasDoMesAnterior >= 20 && projetadas <= e.vendasDoMesAnterior * 0.7) return "ESFRIANDO";
  return "ATIVA";
}

// ═════════════════════════════════════════════════════════════════════════════
// A LOJA NA ANÁLISE
// ═════════════════════════════════════════════════════════════════════════════

export type MesDaLoja = {
  vendas: number;
  gmv: number;
  receita: ReceitaDoMes;
  /** Comissão do parceiro DONO DA CARTEIRA nesta loja (zero na carteira "Sem vendedor"). */
  comissaoPrevista: number;
  comissaoRecebida: number;
};

export type UpsellDaLoja = { servico: keyof ServicosDoMes; em: string; valorMensal: number };

export type LojaDaAnalise = {
  id: string;
  nome: string;
  cidade: string | null;
  criadaEm: string;
  testeAte: string | null;
  /** Quando entrou NESTA carteira (vendedor: vendedorAtribuidoEm; indicação e "sem vendedor": cadastro). */
  desde: string;
  isenta: boolean;
  meses: Record<string, MesDaLoja>;
  /** Mês corrente: faturamento do mês anterior até o mesmo ponto. */
  gmvAnteriorNoCorte: number;
  vendasAnterioresNoCorte: number;
  /** Primeiro boleto pago (qualquer mês). */
  primeiroPagamentoEm: string | null;
  /** Boleto vencido com o bloqueio já passado (lib/prazo-da-mensalidade.ts). */
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

export type CarteiraDaAnalise = {
  /** Ambassador.id, ou "sem" (lojas sem vendedor nem embaixador — a carteira do Douglas). */
  id: string;
  nome: string;
  papel: "VENDEDOR" | "EMBAIXADOR" | "VENDEDOR_E_EMBAIXADOR" | "SEM_VENDEDOR";
  ativo: boolean;
  lojas: LojaDaAnalise[];
};

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
  porSituacao: Record<StatusDaAtividade, number>;
  novas: number;
  /** Novas do período cujo teste já acabou. */
  novasForaDoTeste: number;
  /** Dessas, as que já pagaram um boleto. */
  novasPagantes: number;
  conversaoPct: number | null;
  /** Venderam no mês antes de pararem e terminaram o período sem venda há um mês inteiro. */
  perdidas: number;
  perdidasNomes: string[];
  vendas: number;
  gmv: number;
  receita: ReceitaDoMes;
  comissaoPrevista: number;
  comissaoRecebida: number;
  upsell: number;
  upsellMensal: number;
};

export type Janela = { meses: string[]; inicio: Date; fim: Date; fracaoDoUltimo: number };

const fimDoMes = (ym: string, intervalos: Record<string, { inicio: Date; fim: Date }>) => intervalos[ym]?.fim;

/**
 * Os números de uma carteira numa janela de meses.
 *
 *  lojas         estavam na carteira no fim da janela (entraram antes do fim)
 *  porSituacao   `situacaoNoMes` no ÚLTIMO mês da janela
 *  novas         cadastradas dentro da janela; conversão = pagaram um boleto ÷ já saíram do teste
 *  perdidas      venderam no mês anterior à parada, ficaram um mês INTEIRO sem vender dentro da
 *                janela e não voltaram até o fim dela (no mês corrente: sem venda há 30+ dias)
 *  gmv, vendas   soma dos meses (régua dos relatórios); `corte` troca o último mês pelo valor no mesmo ponto
 *  receita       `receitaDoMes` somada; comissão idem (só meses depois que a loja entrou na carteira)
 *  upsell        serviços pagos que a loja passou a ter dentro da janela
 */
export function numerosDaJanela(
  lojas: LojaDaAnalise[],
  j: Janela,
  intervalos: Record<string, { inicio: Date; fim: Date }>,
  agora: Date,
  opcoes: { corte?: boolean; mesCorrente: string } ,
): NumerosDoPeriodo {
  const ultimo = j.meses[j.meses.length - 1];
  const fimMs = j.fim.getTime();
  const porSituacao: Record<StatusDaAtividade, number> = { ATIVA: 0, ESFRIANDO: 0, PARADA: 0, NOVA: 0 };
  let n = 0, novas = 0, novasFora = 0, novasPag = 0, perdidas = 0, vendas = 0, gmv = 0, comP = 0, comR = 0, upsell = 0, upsellMensal = 0;
  const perdidasNomes: string[] = [];
  const receitas: ReceitaDoMes[] = [];

  for (const l of lojas) {
    const desde = new Date(l.desde).getTime();
    if (desde >= fimMs || new Date(l.criadaEm).getTime() >= fimMs) continue;
    n++;
    const mes = (ym: string) => l.meses[ym];
    const anterior = mesesAntes(ultimo, 1);
    const int = intervalos[ultimo];
    porSituacao[situacaoNoMes({
      criadaEm: l.criadaEm, testeAte: l.testeAte, mes: ultimo, inicioDoMes: int.inicio, fimDoMes: int.fim,
      vendas: mes(ultimo)?.vendas ?? 0, vendasDoMesAnterior: mes(anterior)?.vendas ?? 0,
      fracaoDoMes: ultimo === opcoes.mesCorrente ? j.fracaoDoUltimo : 1,
    })]++;

    const criada = new Date(l.criadaEm).getTime();
    if (criada >= j.inicio.getTime() && criada < fimMs) {
      novas++;
      const fimDoTeste = l.testeAte ? new Date(l.testeAte).getTime() : criada + 15 * 86_400_000;
      if (fimDoTeste <= agora.getTime()) {
        novasFora++;
        if (l.primeiroPagamentoEm) novasPag++;
      }
    }

    // Perdida: algum mês da janela sem venda depois de um mês com venda, e sem voltar até o fim.
    const sequencia = [mesesAntes(j.meses[0], 1), ...j.meses];
    let parou = false;
    for (let i = 1; i < sequencia.length; i++) {
      const v = mes(sequencia[i])?.vendas ?? 0;
      const vAntes = mes(sequencia[i - 1])?.vendas ?? 0;
      const corrente = sequencia[i] === opcoes.mesCorrente;
      // No mês corrente, "sem venda há 30+ dias" vem do perfil; antes, o mês inteiro sem venda.
      const semVenda = corrente ? (l.agora ? l.agora.diasSemVenda === null || l.agora.diasSemVenda >= 30 : v === 0) && v === 0 : v === 0;
      if (semVenda && vAntes > 0) parou = true;
      else if (v > 0) parou = false;
    }
    if (parou) { perdidas++; perdidasNomes.push(l.nome); }

    j.meses.forEach((ym, i) => {
      const m = mes(ym);
      if (!m) return;
      const ultimoDaJanela = i === j.meses.length - 1;
      if (opcoes.corte && ultimoDaJanela) {
        vendas += l.vendasAnterioresNoCorte; gmv += l.gmvAnteriorNoCorte;
      } else {
        vendas += m.vendas; gmv += m.gmv;
      }
      const fimDoMesMs = fimDoMes(ym, intervalos)?.getTime() ?? 0;
      if (desde < fimDoMesMs) {
        receitas.push(m.receita);
        comP += m.comissaoPrevista;
        comR += m.comissaoRecebida;
      }
    });

    for (const u of l.upsell) {
      const em = new Date(u.em).getTime();
      if (em >= j.inicio.getTime() && em < fimMs) { upsell++; upsellMensal += u.valorMensal; }
    }
  }

  return {
    lojas: n, porSituacao, novas, novasForaDoTeste: novasFora, novasPagantes: novasPag,
    conversaoPct: novasFora > 0 ? Math.round((novasPag / novasFora) * 100) : null,
    perdidas, perdidasNomes, vendas, gmv: c2(gmv), receita: somarReceitas(receitas),
    comissaoPrevista: c2(comP), comissaoRecebida: c2(comR), upsell, upsellMensal: c2(upsellMensal),
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
  atual: NumerosDoPeriodo;
  anterior: NumerosDoPeriodo;
  agora: ReturnType<typeof numerosDeAgora>;
  crm: { atual: AtividadeComercial; anterior: AtividadeComercial } | null;
  variacao: { lojas: number | null; gmv: number | null; receita: number | null; comissao: number | null; vendas: number | null };
};

export function resumirCarteira(
  c: CarteiraDaAnalise,
  periodo: PeriodoDaAnalise,
  intervalos: Record<string, { inicio: Date; fim: Date }>,
  agora: Date,
  fracaoDoMesCorrente: number,
  mesCorrente: string,
  crm: { atual: AtividadeComercial; anterior: AtividadeComercial } | null,
): ResumoDaCarteira {
  const janela = (meses: string[], parcial: boolean): Janela => ({
    meses, inicio: intervalos[meses[0]].inicio,
    fim: parcial ? agora : intervalos[meses[meses.length - 1]].fim,
    fracaoDoUltimo: parcial ? fracaoDoMesCorrente : 1,
  });
  const atual = numerosDaJanela(c.lojas, janela(periodo.meses, periodo.parcial), intervalos, agora, { mesCorrente });
  // O anterior do "mês atual" é cortado no mesmo ponto do mês: o fim da janela também.
  const corte = periodo.chave === "mes";
  const jAnt = janela(periodo.anteriores, false);
  if (corte) {
    const ini = intervalos[periodo.anteriores[0]].inicio.getTime();
    const dur = intervalos[periodo.anteriores[0]].fim.getTime() - ini;
    jAnt.fim = new Date(ini + dur * fracaoDoMesCorrente);
    jAnt.fracaoDoUltimo = 1;
  }
  const anterior = numerosDaJanela(c.lojas, jAnt, intervalos, agora, { corte, mesCorrente });
  return {
    id: c.id, nome: c.nome, papel: c.papel, ativo: c.ativo, atual, anterior,
    agora: numerosDeAgora(c.lojas),
    crm,
    // No "Mês atual" o ciclo aberto soma só o mês até hoje: a receita e a comissão do mês
    // anterior (fechado, inteiro) entram proporcionais ao mesmo ponto do mês.
    variacao: {
      lojas: variacao(atual.lojas, anterior.lojas),
      gmv: variacao(atual.gmv, anterior.gmv),
      receita: variacao(atual.receita.previsto, anterior.receita.previsto * (corte ? fracaoDoMesCorrente : 1)),
      comissao: variacao(atual.comissaoPrevista, anterior.comissaoPrevista * (corte ? fracaoDoMesCorrente : 1)),
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

export function evolucaoDaCarteira(
  c: CarteiraDaAnalise,
  meses: string[],
  intervalos: Record<string, { inicio: Date; fim: Date }>,
  mesCorrente: string,
  fracaoDoMesCorrente: number,
): MesDaEvolucao[] {
  return meses.map((ym) => {
    const int = intervalos[ym];
    let lojas = 0, ativas = 0, vendas = 0, gmv = 0, previsto = 0, faturado = 0, recebido = 0, comissao = 0;
    for (const l of c.lojas) {
      if (new Date(l.desde).getTime() >= int.fim.getTime() || new Date(l.criadaEm).getTime() >= int.fim.getTime()) continue;
      lojas++;
      const m = l.meses[ym];
      const s = situacaoNoMes({
        criadaEm: l.criadaEm, testeAte: l.testeAte, mes: ym, inicioDoMes: int.inicio, fimDoMes: int.fim,
        vendas: m?.vendas ?? 0, vendasDoMesAnterior: l.meses[mesesAntes(ym, 1)]?.vendas ?? 0,
        fracaoDoMes: ym === mesCorrente ? fracaoDoMesCorrente : 1,
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

/** Ordenações do comparativo. */
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
    "Carteira", "Papel", "Período", "Lojas", "Lojas (anterior)", "Ativas", "Esfriando", "Paradas", "Novas", "Novas pagantes", "Conversão do teste %",
    "Perdidas", "Vendas", "GMV", "GMV anterior", "Variação GMV %", "Receita prevista", "Receita faturada", "Receita recebida", "Em aberto",
    "Mensalidades", "Serviços", "Receita anterior", "Variação receita %", "Comissão prevista", "Comissão recebida", "Upsell (serviços novos)",
    "Oportunidades de venda (agora)", "Potencial R$/mês", "Lojas em risco (agora)", "GMV em risco", "Leads (CRM)", "Conversas", "Tempo até 1º contato (min)", "Demos feitas", "Cadastros", "Clientes (CRM)",
  ];
  const linhas = cs.map((c) => {
    const a = c.atual;
    const servicos = c2(a.receita.previsto - a.receita.mensalidade);
    return [
      c.nome, c.papel, periodo.rotulo, a.lojas, c.anterior.lojas, a.porSituacao.ATIVA, a.porSituacao.ESFRIANDO, a.porSituacao.PARADA, a.porSituacao.NOVA,
      a.novasPagantes, pct(a.conversaoPct), a.perdidas, a.vendas, num(a.gmv), num(c.anterior.gmv), pct(c.variacao.gmv),
      num(a.receita.previsto), num(a.receita.faturado), num(a.receita.recebido), num(a.receita.emAberto), num(a.receita.mensalidade), num(servicos),
      num(c.anterior.receita.previsto), pct(c.variacao.receita), num(a.comissaoPrevista), num(a.comissaoRecebida), a.upsell,
      c.agora.oportunidades, num(c.agora.potencial), c.agora.emRisco, num(c.agora.gmvEmRisco),
      c.crm?.atual.leads ?? "", c.crm?.atual.conversas ?? "", c.crm?.atual.tempoAtePrimeiroContatoMin ?? "", c.crm?.atual.demosFeitas ?? "", c.crm?.atual.cadastros ?? "", c.crm?.atual.clientes ?? "",
    ].map(esc).join(";");
  });
  return "﻿" + [cab.join(";"), ...linhas].join("\r\n");
}
