/**
 * "Mês que vem com crescimento" — bloco da aba Projeção do admin. Sem banco:
 * lib/projecao-do-mes.ts lê e monta as lojas; o teste é
 * scripts/teste-projecao-de-crescimento.ts.
 *
 * Pedido do dono (18/10/2026): "na projeção do mês seguinte deveria
 * contabilizar a projeção de crescimento — quantos entraram esse mês, quantos
 * ativaram e ficaram; se continuar crescendo igual, mês que vem bate quanto?".
 *
 * O número principal (`mesmoPadrao`, pedido do dono no mesmo dia: "se eu
 * cresci 10 mil com a galera que entrou, a projeção do mês que vem deveria
 * bater uns 20 — algo coerente") é aditivo, em R$: o mês atual menos a perda
 * do último mês, mais a receita nova que entrou no mês atual de novo. A
 * segunda leitura faz a mesma conta com os últimos 30 dias.
 *
 * A conta por coorte (`projetarComCrescimento`) virou o cenário CONSERVADOR:
 * usa a conversão medida de quem já saiu do teste, que sai baixa enquanto as
 * contas do mês acabaram de sair dele (não tiveram tempo de virar pagantes).
 *
 * ── AS ETAPAS DO FUNIL (por mês de cadastro, em Brasília) ──────────────────
 *   Cadastro       conta nova: não isenta (Hakim, casa, isentada pelo dono) e
 *                  não é loja extra de uma conta que já existe (accountGroupId
 *                  de outra loja — o dono já é cliente). `entraNoFunil`.
 *   Ativou         tem pedido não cancelado (o 1º pedido), em qualquer data.
 *   Ainda em teste o fim do teste é depois de agora.
 *   Saiu do teste  o contrário (sem data de teste = sem teste = saiu).
 *   Pagante        saiu do teste e: pagou um boleto (ciclo PAID no Asaas) ou
 *                  tem boleto previsto no mês atual vendendo depois do teste
 *                  (situação PAGANDO da projeção). O "mínimo sem venda" não
 *                  conta: não ativou e a chance de pagar é baixa.
 *   Continua       pagante com pedido há menos de DIAS_PARA_PARADA dias.
 *   Parou          pagante sem pedido há DIAS_PARA_PARADA dias ou mais.
 */
import { calcMensalidade, FIREHUB_PLAN } from "@/lib/firehub-billing";
import { DIA, DIAS_PARA_PARADA, diaNoFuso, mesCheioNoRitmo, projetarMes } from "@/lib/projecao-do-mes-regras";
import { VENDAS_PARA_ATIVAR } from "@/lib/perfil-da-loja/regras";

/** Abaixo disto de lojas que já saíram do teste, a taxa é chute: a tela avisa. */
export const LOJAS_PARA_TAXA_FIRME = 30;
/** Abaixo disto de meses com boleto medidos, a perda é chute: a tela avisa. */
export const MESES_PARA_PERDA_FIRME = 3;
/** Meses completos que entram na "média dos últimos meses". */
export const MESES_DA_MEDIA = 3;

export type Boleto = { mes: string; pago: boolean; base: number; valor: number };

export type LojaNoCrescimento = {
  id: string;
  /** Conta nova de verdade (ver `entraNoFunil`). Só estas entram no funil e nas conversões. */
  doFunil: boolean;
  cadastro: Date;
  fimDoTeste: Date | null;
  primeiroPedido: Date | null;
  ultimoPedido: Date | null;
  /** Boletos dos meses ANTES do atual: ciclo fechado/pago com valor, ou perdoado. */
  boletos: Boleto[];
  /** Base projetada do boleto do mês atual quando a loja já paga e vende (PAGANDO); null = não tem. */
  previstoNoMes: number | null;
  /** Boleto previsto do mês atual em QUALQUER situação (a linha da projeção): total e chance. null = nenhum. */
  noMes: { total: number; chance: number } | null;
  /** Pedidos não cancelados nos últimos 30 dias (para "vendendo constante"). */
  pedidos30d: number;
  /** Venda por dia nos últimos 7 dias (ritmoPorDia). */
  porDia: number;
};

/** Conta nova: nem isenta, nem loja extra de outra conta. */
export function entraNoFunil(l: { id: string; isenta: boolean; accountGroupId: string | null }): boolean {
  return !l.isenta && (!l.accountGroupId || l.accountGroupId === l.id);
}

export function etapasDaLoja(l: LojaNoCrescimento, agora: Date) {
  const ativou = !!l.primeiroPedido && l.primeiroPedido <= agora;
  const emTeste = !!l.fimDoTeste && l.fimDoTeste > agora;
  const saiuDoTeste = !emTeste;
  // Sem teste gravado, nada foi vendido "no teste".
  const vendeuNoTeste = ativou && !!l.fimDoTeste && l.primeiroPedido! < l.fimDoTeste;
  const pagou = l.boletos.some((b) => b.pago);
  const previsto = l.previstoNoMes !== null;
  const pagante = saiuDoTeste && (pagou || previsto);
  const vendendo = !!l.ultimoPedido && agora.getTime() - l.ultimoPedido.getTime() < DIAS_PARA_PARADA * DIA;
  return { ativou, emTeste, saiuDoTeste, vendeuNoTeste, pagou, previsto, pagante, vendendo, continua: pagante && vendendo, parou: pagante && !vendendo };
}

export type FunilDoMes = {
  mes: string; cadastros: number; ativaram: number; emTeste: number; sairamDoTeste: number;
  pagantes: number; pagaram: number; continuam: number; pararam: number;
  /** pagantes ÷ saíram do teste; null sem ninguém fora do teste. */
  conversao: number | null;
};

export const mesNoFuso = (d: Date, fuso = "America/Sao_Paulo") => diaNoFuso(d, fuso).slice(0, 7);

/** O funil de cada mês de cadastro (só as contas do funil). */
export function funilPorMes(lojas: LojaNoCrescimento[], meses: string[], agora: Date, fuso = "America/Sao_Paulo"): FunilDoMes[] {
  const linhas = new Map(meses.map((mes) => [mes, {
    mes, cadastros: 0, ativaram: 0, emTeste: 0, sairamDoTeste: 0, pagantes: 0, pagaram: 0, continuam: 0, pararam: 0, conversao: null,
  } as FunilDoMes]));
  for (const l of lojas) {
    if (!l.doFunil) continue;
    const f = linhas.get(mesNoFuso(l.cadastro, fuso));
    if (!f) continue;
    const e = etapasDaLoja(l, agora);
    f.cadastros++;
    if (e.ativou) f.ativaram++;
    if (e.emTeste) f.emTeste++; else f.sairamDoTeste++;
    if (e.pagante) f.pagantes++;
    if (e.pagante && e.pagou) f.pagaram++;
    if (e.continua) f.continuam++;
    if (e.parou) f.pararam++;
  }
  for (const f of linhas.values()) f.conversao = f.sairamDoTeste ? f.pagantes / f.sairamDoTeste : null;
  return meses.map((m) => linhas.get(m)!);
}

/** Uma taxa medida: `s` de `n`, com a faixa de 90% (Wilson) — larga quando há pouca loja. */
export type Taxa = { s: number; n: number; taxa: number | null; min: number; max: number };

export function taxa(s: number, n: number): Taxa {
  if (n <= 0) return { s, n, taxa: null, min: 0, max: 0 };
  const z = 1.645;
  const p = s / n;
  const den = 1 + (z * z) / n;
  const centro = (p + (z * z) / (2 * n)) / den;
  const meia = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den;
  return { s, n, taxa: p, min: Math.max(0, centro - meia), max: Math.min(1, centro + meia) };
}

/** Mês "AAAA-MM" somado de `n`. */
export function somarMeses(mes: string, n: number): string {
  const [a, m] = mes.split("-").map(Number);
  const t = a * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

/**
 * Perda mensal: das lojas com boleto num mês, quantas não tiveram boleto no
 * mês seguinte. A passagem para o mês atual usa o que já se sabe dele: ficou
 * quem tem boleto previsto vendendo (PAGANDO) e não está parada.
 */
export function perdaMensal(lojas: LojaNoCrescimento[], mesAtual: string, agora: Date): Taxa & { meses: number } {
  const porMes = new Map<string, LojaNoCrescimento[]>();
  for (const l of lojas) for (const b of l.boletos) {
    if (b.mes >= mesAtual) continue;
    porMes.set(b.mes, [...(porMes.get(b.mes) || []), l]);
  }
  let n = 0, s = 0;
  for (const [mes, ls] of porMes) {
    const seguinte = somarMeses(mes, 1);
    for (const l of ls) {
      const ficou = seguinte === mesAtual
        ? l.previstoNoMes !== null && etapasDaLoja(l, agora).vendendo
        : l.boletos.some((b) => b.mes === seguinte);
      n++;
      if (!ficou) s++;
    }
  }
  return { ...taxa(s, n), meses: porMes.size };
}

/**
 * A mensalidade de uma conta NOVA no 1º mês pago, pela conta do boleto do mês
 * que vem (calcMensalidade): base do 1º boleto (ou a projetada do mês atual,
 * se é o primeiro) a 2%, mínimo e teto. 1º mês costuma ser pedaço de mês — o
 * teste come o começo —, e é isso que a média quer medir.
 */
export function mensalidadeDaNova(lojas: LojaNoCrescimento[], mesSeguinte: string, agora: Date): { valor: number; n: number; reserva: boolean } {
  const valores: number[] = [];
  for (const l of lojas) {
    if (!l.doFunil || !etapasDaLoja(l, agora).pagante) continue;
    const primeiro = [...l.boletos].sort((a, b) => a.mes.localeCompare(b.mes))[0];
    const base = primeiro ? primeiro.base : l.previstoNoMes;
    if (base === null) continue;
    valores.push(calcMensalidade(Math.max(0, base), true, mesSeguinte).mensalidade);
  }
  if (!valores.length) return { valor: FIREHUB_PLAN.MIN_MONTHLY, n: 0, reserva: true };
  return { valor: valores.reduce((s, v) => s + v, 0) / valores.length, n: valores.length, reserva: false };
}

/** Duração típica do teste (mediana, em dias) das contas do funil; 15 sem dado. */
export function diasDeTesteTipico(lojas: LojaNoCrescimento[]): number {
  const d = lojas
    .filter((l) => l.doFunil && l.fimDoTeste)
    .map((l) => Math.round((l.fimDoTeste!.getTime() - l.cadastro.getTime()) / DIA))
    .filter((x) => x > 0)
    .sort((a, b) => a - b);
  if (!d.length) return FIREHUB_PLAN.TRIAL_DAYS;
  return d.length % 2 ? d[(d.length - 1) / 2] : Math.round((d[d.length / 2 - 1] + d[d.length / 2]) / 2);
}

/**
 * Quem se cadastra num mês só paga nele se o teste acabar antes do fim do
 * mês. Com cadastros espalhados pelo mês, é a fração (dias − teste) ÷ dias;
 * o resto paga só no mês depois.
 */
export function fracaoQueSaiDoTesteNoMes(diasDoMes: number, diasDeTeste: number): number {
  return Math.max(0, Math.min(1, (diasDoMes - diasDeTeste) / diasDoMes));
}

export type Taxas = { perda: number; convVendeu: number; convNaoVendeu: number; convCadastro: number; mensalidadeNova: number };

export type Partes = {
  /** Fora do teste e vendendo: mês cheio no ritmo. */
  pagantesNoRitmo: { valor: number; lojas: number };
  /** Em teste e vendendo: só os dias do mês que vem depois do teste. */
  emTesteVendendo: { valor: number; valorMesCheio: number; lojas: number };
  /** Em teste, sem venda nos últimos 7 dias, e o teste acaba antes do fim do mês que vem. */
  emTesteSemVenda: number;
};

export type Cenario = {
  cadastros: number; base: number; perdido: number; testeVendendo: number; testeSemVenda: number;
  novasLojas: number; novas: number; pagantes: number; total: number;
};

/**
 * Mês que vem = (pagantes no ritmo − perda) + em teste vendendo × conversão de
 * quem vende no teste + em teste sem venda × conversão de quem não vendia ×
 * mensalidade da nova + cadastros esperados × fração que sai do teste no mês ×
 * conversão cadastro→pagante × mensalidade da nova.
 */
export function projetarComCrescimento(p: Partes, cadastros: number, fracaoNoMes: number, t: Taxas): Cenario {
  const base = p.pagantesNoRitmo.valor * (1 - t.perda);
  const testeVendendo = p.emTesteVendendo.valor * t.convVendeu;
  const testeSemVenda = p.emTesteSemVenda * t.convNaoVendeu * t.mensalidadeNova;
  const novasLojas = cadastros * fracaoNoMes * t.convCadastro;
  const novas = novasLojas * t.mensalidadeNova;
  const pagantes = p.pagantesNoRitmo.lojas * (1 - t.perda) + p.emTesteVendendo.lojas * t.convVendeu
    + p.emTesteSemVenda * t.convNaoVendeu + novasLojas;
  const r = (v: number) => Math.round(v * 100) / 100;
  return {
    cadastros: r(cadastros), base: r(base), perdido: r(p.pagantesNoRitmo.valor - base), testeVendendo: r(testeVendendo),
    testeSemVenda: r(testeSemVenda), novasLojas: r(novasLojas), novas: r(novas), pagantes: r(pagantes),
    total: r(base + testeVendendo + testeSemVenda + novas),
  };
}

/** As partes do mês que vem, loja a loja (todas as não isentas que vieram). */
export function partesDoMesSeguinte(
  lojas: LojaNoCrescimento[], agora: Date, mesSeguinte: string, inicioDoSeguinte: Date, fimDoSeguinte: Date,
): Partes {
  const p: Partes = { pagantesNoRitmo: { valor: 0, lojas: 0 }, emTesteVendendo: { valor: 0, valorMesCheio: 0, lojas: 0 }, emTesteSemVenda: 0 };
  for (const l of lojas) {
    const emTeste = !!l.fimDoTeste && l.fimDoTeste > agora;
    if (l.porDia > 0 && !emTeste) {
      p.pagantesNoRitmo.valor += mesCheioNoRitmo(l.porDia, mesSeguinte);
      p.pagantesNoRitmo.lojas++;
    } else if (l.porDia > 0) {
      // Teste que passa do mês que vem inteiro: nada a cobrar nele.
      if (l.fimDoTeste! >= fimDoSeguinte) continue;
      const inicio = l.fimDoTeste! > inicioDoSeguinte ? l.fimDoTeste! : inicioDoSeguinte;
      p.emTesteVendendo.valor += projetarMes({
        mes: mesSeguinte, contaAntesDaVirada: 0, contaDepois: 0, porDia: l.porDia,
        inicioDaCobranca: inicio, agora: inicioDoSeguinte, fimDoMes: fimDoSeguinte,
      }).mensalidade;
      p.emTesteVendendo.valorMesCheio += mesCheioNoRitmo(l.porDia, mesSeguinte);
      p.emTesteVendendo.lojas++;
    } else if (emTeste && l.doFunil && l.fimDoTeste! < fimDoSeguinte) {
      p.emTesteSemVenda++;
    }
  }
  return p;
}

/** A taxa central, ou a reserva quando não há loja para medir. */
const ou = (t: Taxa, reserva: number) => t.taxa ?? reserva;

export function montarCrescimento(e: {
  /** Todas as lojas não isentas (as extras de conta entram na base e na perda, fora do funil). */
  lojas: LojaNoCrescimento[];
  agora: Date;
  mes: string;
  mesSeguinte: string;
  /** Do mais antigo ao atual. */
  meses: string[];
  inicioDoMes: Date; fimDoMes: Date;
  inicioDoSeguinte: Date; fimDoSeguinte: Date;
  /** Boletos previstos do mês atual (a projeção de cima): quantos e a aposta. */
  previstoDoMes: { boletos: number; aposta: number; seTodas: number };
  mesAnterior: string;
  /** Boletos do mês anterior: recebido e em aberto (a inadimplência esperada). */
  mesPassado: { recebido: number; emAberto: number; boletosEmAberto: number; lojasPagas: number };
  fuso?: string;
}) {
  const { lojas, agora, mes, mesSeguinte, meses } = e;
  const fuso = e.fuso || "America/Sao_Paulo";
  const funil = funilPorMes(lojas, meses, agora, fuso);

  // Conversões: só as contas do funil que já saíram do teste.
  let saiu = 0, pagou = 0, saiuVendendo = 0, pagouVendendo = 0;
  for (const l of lojas) {
    if (!l.doFunil || !meses.includes(mesNoFuso(l.cadastro, fuso))) continue;
    const x = etapasDaLoja(l, agora);
    if (!x.saiuDoTeste) continue;
    saiu++;
    if (x.pagante) pagou++;
    if (x.vendeuNoTeste) { saiuVendendo++; if (x.pagante) pagouVendendo++; }
  }
  const noFunil = lojas.filter((l) => meses.includes(mesNoFuso(l.cadastro, fuso)));
  const taxas = {
    convCadastro: taxa(pagou, saiu),
    convVendeu: taxa(pagouVendendo, saiuVendendo),
    convNaoVendeu: taxa(pagou - pagouVendendo, saiu - saiuVendendo),
    perda: perdaMensal(lojas, mes, agora),
    mensalidadeNova: mensalidadeDaNova(noFunil, mesSeguinte, agora),
  };

  // Cadastros: o ritmo do mês atual e a média dos meses completos.
  const diasDoMes = (e.fimDoMes.getTime() - e.inicioDoMes.getTime()) / DIA;
  const diasDoSeguinte = Math.round((e.fimDoSeguinte.getTime() - e.inicioDoSeguinte.getTime()) / DIA);
  const decorridos = Math.max(1, (agora.getTime() - e.inicioDoMes.getTime()) / DIA);
  const ateAgora = funil.find((f) => f.mes === mes)?.cadastros || 0;
  const porDia = ateAgora / decorridos;
  const completos = funil.filter((f) => f.mes < mes);
  const desdeOPrimeiro = completos.slice(Math.max(0, completos.findIndex((f) => f.cadastros > 0)));
  const daMedia = completos.some((f) => f.cadastros > 0) ? desdeOPrimeiro.slice(-MESES_DA_MEDIA) : [];
  const ritmoDeCadastro = {
    ateAgora, porDia, fechaEm: Math.round(porDia * Math.round(diasDoMes)),
    igual: porDia * diasDoSeguinte, diasDoSeguinte,
    media: daMedia.length ? daMedia.reduce((s, f) => s + f.cadastros, 0) / daMedia.length : null,
    mesesDaMedia: daMedia.map((f) => f.mes),
  };

  const diasDeTeste = diasDeTesteTipico(noFunil);
  const fracaoNoMes = fracaoQueSaiDoTesteNoMes(diasDoSeguinte, diasDeTeste);
  const partes = partesDoMesSeguinte(lojas, agora, mesSeguinte, e.inicioDoSeguinte, e.fimDoSeguinte);

  const conv = ou(taxas.convCadastro, 0);
  const central: Taxas = {
    perda: ou(taxas.perda, 0),
    convCadastro: conv,
    convVendeu: ou(taxas.convVendeu, conv),
    convNaoVendeu: ou(taxas.convNaoVendeu, conv),
    mensalidadeNova: taxas.mensalidadeNova.valor,
  };
  // A faixa: as pontas de 90% de cada taxa, todas para o mesmo lado.
  const ponta = (lado: "min" | "max"): Taxas => {
    const de = (t: Taxa, reserva: number) => (t.n ? t[lado] : reserva);
    const c = de(taxas.convCadastro, 0);
    return {
      perda: taxas.perda.n ? taxas.perda[lado === "min" ? "max" : "min"] : 0,
      convCadastro: c, convVendeu: de(taxas.convVendeu, c), convNaoVendeu: de(taxas.convNaoVendeu, c),
      mensalidadeNova: taxas.mensalidadeNova.valor,
    };
  };
  const igual = projetarComCrescimento(partes, ritmoDeCadastro.igual, fracaoNoMes, central);
  const media = ritmoDeCadastro.media === null ? null : projetarComCrescimento(partes, ritmoDeCadastro.media, fracaoNoMes, central);
  const menos = Math.min(ritmoDeCadastro.igual, ritmoDeCadastro.media ?? Infinity);
  const mais = Math.max(ritmoDeCadastro.igual, ritmoDeCadastro.media ?? 0);
  const cenarios = {
    igual, media,
    pessimista: projetarComCrescimento(partes, menos, fracaoNoMes, ponta("min")),
    otimista: projetarComCrescimento(partes, mais, fracaoNoMes, ponta("max")),
    taxasUsadas: central,
  };

  // Boletos por mês (todas as não isentas) + o previsto do mês atual.
  const serie = meses.map((m) => {
    if (m === mes) return { mes: m, boletos: e.previstoDoMes.boletos, cobrado: e.previstoDoMes.aposta, seTodas: e.previstoDoMes.seTodas, pago: 0, tipo: "previsto" as const };
    let boletos = 0, cobrado = 0, pago = 0;
    for (const l of lojas) for (const b of l.boletos) if (b.mes === m) { boletos++; cobrado += b.valor; if (b.pago) pago += b.valor; }
    return { mes: m, boletos, cobrado, seTodas: cobrado, pago, tipo: "real" as const };
  });
  const primeiroComBoleto = serie.findIndex((s) => s.boletos > 0);

  // O número principal: o mesmo padrão do último mês (e dos últimos 30 dias).
  const ctx = { mesAnterior: e.mesAnterior, mesSeguinte, agora, fimDoMes: e.fimDoMes, inicioDoSeguinte: e.inicioDoSeguinte, fimDoSeguinte: e.fimDoSeguinte };
  const doMes = mesmoPadrao(lojas, ctx, e.previstoDoMes, "mes");
  const de30dias = mesmoPadrao(lojas, ctx, e.previstoDoMes, "30dias");
  const crescimentoDoMesAtual = crescimentoDoMes({ ...e.mesPassado, seTodas: e.previstoDoMes.seTodas, aposta: e.previstoDoMes.aposta });
  const pontas = [doMes.total, doMes.totalAposta, de30dias.total, de30dias.totalAposta, igual.total];
  const faixaPrincipal = { min: Math.min(...pontas), max: Math.max(...pontas) };

  const avisos: string[] = [];
  if (saiu < LOJAS_PARA_TAXA_FIRME) avisos.push(`a conversão sai de só ${saiu} ${saiu === 1 ? "conta" : "contas"} que já saíram do teste`);
  if (taxas.perda.meses < MESES_PARA_PERDA_FIRME) avisos.push(`a perda sai de ${taxas.perda.meses} ${taxas.perda.meses === 1 ? "mês" : "meses"} com boleto (${taxas.perda.n} boletos)`);
  if (taxas.mensalidadeNova.reserva) avisos.push("nenhuma conta nova pagou ainda: a mensalidade da nova é o mínimo");

  return {
    mesmoPadrao: { doMes, de30dias, faixa: faixaPrincipal, crescimento: crescimentoDoMesAtual, mesAtual: e.previstoDoMes },
    funil, taxas, ritmoDeCadastro, diasDeTeste, fracaoNoMes, partes, cenarios,
    serie: primeiroComBoleto < 0 ? serie.slice(-1) : serie.slice(primeiroComBoleto),
    historicoCurto: avisos.length ? avisos : null,
  };
}

export type Crescimento = ReturnType<typeof montarCrescimento>;

/** Quando a cobrança da loja começa: o fim do teste, ou o cadastro sem teste. */
export const inicioDaCobrancaDaLoja = (l: LojaNoCrescimento) => l.fimDoTeste ?? l.cadastro;

export type LeituraAditiva = {
  /** R$ dos boletos do mês anterior que entram na conta da perda. */
  anterior: number;
  perdido: number; lojasPerdidas: number; lojasAnteriores: number;
  /** perdido ÷ anterior. */
  perda: number;
  /** Receita nova (se todas pagarem e na aposta) e quantas lojas. */
  nova: number; novaAposta: number; lojasNovas: number;
  /** Lojas em teste vendendo constante que ficam (mensalidade do mês que vem no ritmo, chance 100%). */
  ficam: number; lojasFicam: number;
  /** Mês atual × (1 − perda) + receita nova + as que ficam. */
  total: number; totalAposta: number;
};

/**
 * Loja em teste "vendendo constante" — a que vai ficar (dono, 18/10/2026: "elas
 * estão ativas, vendendo constante, você vai entender que elas vão ficar"):
 * ainda em teste, com pedido há menos de DIAS_PARA_PARADA dias, ritmo dos
 * últimos 7 dias acima de zero e pelo menos VENDAS_PARA_ATIVAR pedidos nos
 * últimos 30 dias — o "teste ativado" do perfil da loja
 * (lib/perfil-da-loja/regras.ts). Em teste sem venda, parada ou com poucas
 * vendas fica fora (entra só no conservador).
 */
export function vendeConstanteNoTeste(l: LojaNoCrescimento, agora: Date): boolean {
  const e = etapasDaLoja(l, agora);
  return e.emTeste && e.vendendo && l.porDia > 0 && l.pedidos30d >= VENDAS_PARA_ATIVAR;
}

/** Mensalidade do mês que vem no ritmo de hoje, só com os dias depois do teste (calcMensalidade). */
export function mensalidadeNoMesSeguinte(l: LojaNoCrescimento, mesSeguinte: string, inicioDoSeguinte: Date, fimDoSeguinte: Date): number {
  if (l.porDia <= 0 || (l.fimDoTeste && l.fimDoTeste >= fimDoSeguinte)) return 0;
  const inicio = l.fimDoTeste && l.fimDoTeste > inicioDoSeguinte ? l.fimDoTeste : inicioDoSeguinte;
  return projetarMes({ mes: mesSeguinte, contaAntesDaVirada: 0, contaDepois: 0, porDia: l.porDia, inicioDaCobranca: inicio, agora: inicioDoSeguinte, fimDoMes: fimDoSeguinte }).mensalidade;
}

/**
 * Mês que vem "no mesmo padrão" — a leitura aditiva do dono:
 *   próximo = mês atual × (1 − perda) + receita nova + lojas em teste que ficam
 *
 * Último mês (calendário):
 *   receita nova = boleto previsto deste mês das lojas cujo PRIMEIRO boleto é
 *     este mês (inclui quem sai do teste até o fim do mês);
 *   ficam = loja em teste vendendo constante cujo teste só acaba no mês que
 *     vem (não tem boleto neste mês, ficaria de fora dos dois lados): a
 *     mensalidade dela no mês que vem;
 *   perda = R$ do boleto do mês anterior das lojas que não têm boleto previsto
 *     neste mês ÷ R$ de todos os boletos do mês anterior.
 * Últimos 30 dias:
 *   receita nova = boleto previsto deste mês das lojas cuja cobrança COMEÇOU
 *     nos últimos 30 dias;
 *   ficam = TODAS as lojas em teste vendendo constante, pela mensalidade do mês
 *     que vem no ritmo (não pelo pedaço deste mês);
 *   perda = como a do último mês, contando também quem já pagava e está parado
 *     agora (7+ dias sem pedido). Loja em teste nunca entra na perda: ela não
 *     teve boleto no mês anterior.
 * As que ficam e as novas em teste vendendo constante entram com 100% na
 * aposta, não com os 25–50% do teste.
 */
export function mesmoPadrao(
  lojas: LojaNoCrescimento[],
  c: { mesAnterior: string; mesSeguinte: string; agora: Date; fimDoMes: Date; inicioDoSeguinte: Date; fimDoSeguinte: Date },
  mesAtual: { seTodas: number; aposta: number }, janela: "mes" | "30dias",
): LeituraAditiva {
  const { agora } = c;
  const desde = agora.getTime() - 30 * DIA;
  let anterior = 0, perdido = 0, lojasPerdidas = 0, lojasAnteriores = 0, nova = 0, novaAposta = 0, lojasNovas = 0, ficam = 0, lojasFicam = 0;
  for (const l of lojas) {
    if (l.boletos.some((b) => b.mes === c.mesAnterior)) {
      const doAnterior = l.boletos.filter((b) => b.mes === c.mesAnterior).reduce((s, b) => s + b.valor, 0);
      lojasAnteriores++;
      anterior += doAnterior;
      const saiu = !l.noMes || (janela === "30dias" && !etapasDaLoja(l, agora).vendendo);
      if (saiu) { perdido += doAnterior; lojasPerdidas++; }
    }
    const constante = vendeConstanteNoTeste(l, agora);
    // As que ficam: no último mês, só a que não tem boleto agora (o teste acaba no mês que vem); nos 30 dias, todas.
    if (constante && (janela === "30dias" || !l.noMes)) {
      const v = mensalidadeNoMesSeguinte(l, c.mesSeguinte, c.inicioDoSeguinte, c.fimDoSeguinte);
      if (v > 0) { ficam += v; lojasFicam++; }
      continue;
    }
    if (!l.noMes) continue;
    const ehNova = janela === "mes"
      ? l.boletos.length === 0
      : inicioDaCobrancaDaLoja(l).getTime() >= desde && inicioDaCobrancaDaLoja(l) <= agora;
    if (ehNova) { nova += l.noMes.total; novaAposta += l.noMes.total * (constante ? 1 : l.noMes.chance); lojasNovas++; }
  }
  const perda = anterior > 0 ? perdido / anterior : 0;
  const r = (v: number) => Math.round(v * 100) / 100;
  return {
    anterior: r(anterior), perdido: r(perdido), lojasPerdidas, lojasAnteriores, perda,
    nova: r(nova), novaAposta: r(novaAposta), lojasNovas, ficam: r(ficam), lojasFicam,
    total: r(mesAtual.seTodas * (1 - perda) + nova + ficam), totalAposta: r(mesAtual.aposta * (1 - perda) + novaAposta + ficam),
  };
}

/**
 * Quanto o mês atual cresceu sobre o que entrou de verdade no mês anterior:
 * recebido (boleto pago) × previsto agora. Os boletos do mês anterior em
 * aberto ficam à parte — são a inadimplência esperada, não receita.
 */
export function crescimentoDoMes(p: { recebido: number; emAberto: number; boletosEmAberto: number; lojasPagas: number; seTodas: number; aposta: number }) {
  const vezes = (v: number) => (p.recebido > 0 ? Math.round((v / p.recebido) * 10) / 10 : null);
  return { ...p, cobrado: Math.round((p.recebido + p.emAberto) * 100) / 100, vezesSeTodas: vezes(p.seTodas), vezesAposta: vezes(p.aposta) };
}
