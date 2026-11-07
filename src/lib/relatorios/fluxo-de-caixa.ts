/**
 * O FLUXO DE CAIXA — dia a dia, o saldo de ontem, o que entrou, o que saiu, o
 * que ainda vai entrar e sair, e o SALDO PREVISTO. O do SWFast tem as mesmas
 * colunas; aqui vão três coisas que lá não têm:
 *
 *   1. o a receber nasce da venda, sozinho (lib/relatorios/recebiveis.ts);
 *   2. as VENDAS QUE AINDA VÃO ACONTECER entram, se o lojista quiser, pelo
 *      ritmo das últimas 4 semanas — sem elas, todo fluxo de restaurante
 *      "fica negativo" no dia do aluguel, porque só os boletos estão no
 *      futuro;
 *   3. o aviso do PRIMEIRO dia em que o saldo previsto fica negativo, com as
 *      contas que mais pesam até lá.
 *
 * ── O que é realizado e o que é previsto ────────────────────────────────────
 *
 *   • recebível que cai ANTES de hoje: entrada realizada; de hoje em diante: a
 *     receber. É estimativa (o prazo e a taxa são os cadastrados), e a tela diz;
 *   • conta a pagar paga: saída realizada no dia do "Já paguei"; pendente: a
 *     pagar no vencimento — a VENCIDA entra hoje, marcada, porque ainda vai sair;
 *   • conta recorrente ativa: a do mês que ainda não foi gerada entra prevista
 *     no dia do vencimento (o cadastro só gera a 1ª parcela — app/actions/finance.ts);
 *   • despesa lançada: saída realizada no dia dela (lançada para o futuro, a pagar).
 *
 * Não entram: os custos fixos do DRE (não têm dia — cadastre como conta
 * recorrente) e as sangrias/suprimentos (dinheiro que muda de gaveta, não sai
 * da loja; estão no relatório Sangrias e suprimentos).
 *
 * ── O saldo ─────────────────────────────────────────────────────────────────
 *
 * O FireHub não sabe quanto tem no banco. O lojista informa o saldo de um dia
 * (caixa + banco, no começo daquele dia) e o fluxo anda para a frente e para
 * trás a partir dele. Sem saldo informado, a linha começa em R$ 0 e mostra só
 * a VARIAÇÃO — e não há aviso de saldo negativo, que seria falso.
 *
 * Puro, sem banco: a rota (api/store/relatorios/fluxo-de-caixa) busca.
 */
import { c2, somarDias } from "@/lib/relatorios/base";
import { cent, reais } from "@/lib/relatorios/regua-da-venda";
import type { Recebivel } from "@/lib/relatorios/recebiveis";

// ── O QUE ENTRA ─────────────────────────────────────────────────────────────

export type ContaParaFluxo = {
  id: string;
  fornecedor: string;
  valor: number;
  /** "YYYY-MM-DD". */
  vencimento: string;
  pago: boolean;
  /** "YYYY-MM-DD" no fuso da loja; só da paga. */
  pagoEm: string | null;
  recorrenteId?: string | null;
};

export type RecorrenteParaFluxo = { id: string; fornecedor: string; valor: number; diaDoVencimento: number; ativa: boolean };

export type DespesaParaFluxo = { id: string; dia: string; categoria: string; descricao: string | null; valor: number };

export type SaldoInformado = { valor: number; dia: string };

// ── O QUE SAI ───────────────────────────────────────────────────────────────

export type MovimentoDoDia = {
  tipo: "ENTRADA" | "SAIDA";
  /** realizado (já aconteceu) ou previsto. */
  previsto: boolean;
  origem: "RECEBIVEL" | "VENDA_PREVISTA" | "CONTA" | "RECORRENTE" | "DESPESA";
  descricao: string;
  valor: number;
  /** Conta pendente com vencimento antes de hoje (entra hoje). */
  vencidaEm?: string;
};

export type DiaDoFluxo = {
  dia: string;
  diaSemana: number;
  saldoAnterior: number;
  entradasRealizadas: number;
  saidasRealizadas: number;
  aReceber: number;
  /** As vendas que ainda vão acontecer, pelo ritmo das últimas 4 semanas (só com a opção ligada). */
  vendasPrevistas: number;
  aPagar: number;
  saldo: number;
  /** antes de hoje, hoje, depois. */
  quando: "passado" | "hoje" | "futuro";
  movimentos: MovimentoDoDia[];
};

export type ResultadoDoFluxo = {
  dias: DiaDoFluxo[];
  total: { entradasRealizadas: number; saidasRealizadas: number; aReceber: number; vendasPrevistas: number; aPagar: number };
  saldoInicial: number;
  saldoFinal: number;
  /** O saldo informado que ancora a linha; null = a linha começa em zero. */
  saldoInformado: SaldoInformado | null;
  menorSaldo: { dia: string; valor: number } | null;
  /** O 1º dia, de hoje em diante, em que o saldo previsto fica negativo — só com saldo informado. */
  negativo: { dia: string; saldo: number; maioresContas: { descricao: string; dia: string; valor: number }[] } | null;
  /** Contas pendentes que já venceram (somadas no a pagar de hoje). */
  vencidas: { quantidade: number; valor: number };
};

// ── AS VENDAS PREVISTAS ─────────────────────────────────────────────────────

/** Quantos dias de venda a previsão repete: 4 semanas, para cada dia da semana vir de um igual. */
export const DIAS_DA_BASE = 28;

/**
 * As vendas de amanhã em diante, pelo ritmo das últimas 4 semanas: o dia
 * futuro repete o MESMO dia da semana mais recente já fechado (hoje + 1 ←
 * hoje − 27, hoje + 28 ← hoje − 28…), e o dinheiro dele cai no mesmo prazo.
 * Hoje fica de fora: a venda de hoje já está acontecendo e é real.
 * `base` são os recebíveis das vendas de [hoje − 28, hoje − 1].
 */
export function vendasPrevistas(base: Recebivel[], opcoes: { hoje: string; ate: string }): Recebivel[] {
  const inicioDaBase = somarDias(opcoes.hoje, -DIAS_DA_BASE);
  const saida: Recebivel[] = [];
  for (const r of base) {
    if (r.diaDaVenda < inicioDaBase || r.diaDaVenda >= opcoes.hoje) continue;
    for (let k = 1; ; k++) {
      const salto = DIAS_DA_BASE * k;
      const diaDaVenda = somarDias(r.diaDaVenda, salto);
      if (diaDaVenda > opcoes.ate) break;
      if (diaDaVenda <= opcoes.hoje) continue;
      const dia = somarDias(r.dia, salto);
      if (dia > opcoes.ate) continue;
      saida.push({ ...r, diaDaVenda, dia });
    }
  }
  return saida;
}

// ── A CONTA ─────────────────────────────────────────────────────────────────

const diasEntre = (de: string, ate: string) => Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86400000) + 1;
const ultimoDia = (mes: string) => new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0)).getUTCDate();

/** As parcelas de conta recorrente que ainda não existem, de hoje até `ate`. */
export function recorrentesPrevistas(recorrentes: RecorrenteParaFluxo[], contas: ContaParaFluxo[], opcoes: { hoje: string; ate: string }): ContaParaFluxo[] {
  const saida: ContaParaFluxo[] = [];
  const geradas = new Set(contas.filter((c) => c.recorrenteId).map((c) => `${c.recorrenteId}|${c.vencimento.slice(0, 7)}`));
  for (const r of recorrentes) {
    if (!r.ativa || !(r.valor > 0)) continue;
    let mes = opcoes.hoje.slice(0, 7);
    while (mes <= opcoes.ate.slice(0, 7)) {
      const dia = `${mes}-${String(Math.min(Math.max(1, r.diaDoVencimento), ultimoDia(mes))).padStart(2, "0")}`;
      if (dia >= opcoes.hoje && dia <= opcoes.ate && !geradas.has(`${r.id}|${mes}`)) {
        saida.push({ id: `rec:${r.id}:${mes}`, fornecedor: r.fornecedor, valor: r.valor, vencimento: dia, pago: false, pagoEm: null, recorrenteId: r.id });
      }
      const [a, m] = mes.split("-").map(Number);
      mes = m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, "0")}`;
    }
  }
  return saida;
}

export function fluxoDeCaixa(e: {
  de: string;
  ate: string;
  hoje: string;
  recebiveis: Recebivel[];
  /** As vendas previstas (vendasPrevistas), ou [] com a opção desligada. */
  previstas: Recebivel[];
  contas: ContaParaFluxo[];
  recorrentes: RecorrenteParaFluxo[];
  despesas: DespesaParaFluxo[];
  saldo: SaldoInformado | null;
}): ResultadoDoFluxo {
  const { hoje } = e;
  // A linha é calculada desde o dia do saldo informado, quando ele é de antes do período.
  const ancora = e.saldo && e.saldo.dia < e.de ? e.saldo.dia : e.de;
  const fimDaConta = e.saldo && e.saldo.dia > e.ate ? e.saldo.dia : e.ate;
  const n = diasEntre(ancora, fimDaConta);
  type Acc = { er: number; sr: number; ar: number; vp: number; ap: number; movs: MovimentoDoDia[] };
  const acc: Acc[] = Array.from({ length: n }, () => ({ er: 0, sr: 0, ar: 0, vp: 0, ap: 0, movs: [] }));
  const dias = Array.from({ length: n }, (_, i) => somarDias(ancora, i));
  const indice = new Map(dias.map((d, i) => [d, i]));
  const em = (dia: string) => indice.get(dia);
  const vencidas = { q: 0, c: 0 };

  // Recebíveis agrupados por (dia, forma) para a lista do dia não ter uma linha por venda.
  const agrupar = (lista: Recebivel[], previsto: "real" | "venda") => {
    const g = new Map<string, { dia: string; rotulo: string; c: number }>();
    for (const r of lista) {
      if (em(r.dia) === undefined) continue;
      const k = `${r.dia}|${r.chave}`;
      const x = g.get(k) || { dia: r.dia, rotulo: r.rotulo, c: 0 };
      x.c += cent(r.liquido);
      g.set(k, x);
    }
    for (const x of g.values()) {
      if (x.c === 0) continue;
      const a = acc[em(x.dia)!];
      if (previsto === "venda") {
        a.vp += x.c;
        a.movs.push({ tipo: "ENTRADA", previsto: true, origem: "VENDA_PREVISTA", descricao: `${x.rotulo} — vendas previstas`, valor: reais(x.c) });
      } else if (x.dia < hoje) {
        a.er += x.c;
        a.movs.push({ tipo: "ENTRADA", previsto: false, origem: "RECEBIVEL", descricao: x.rotulo, valor: reais(x.c) });
      } else {
        a.ar += x.c;
        a.movs.push({ tipo: "ENTRADA", previsto: true, origem: "RECEBIVEL", descricao: x.rotulo, valor: reais(x.c) });
      }
    }
  };
  agrupar(e.recebiveis, "real");
  agrupar(e.previstas, "venda");

  const contas = [...e.contas, ...recorrentesPrevistas(e.recorrentes, e.contas, { hoje, ate: fimDaConta })];
  for (const c of contas) {
    const v = cent(c.valor);
    if (!(v > 0)) continue;
    const recorrente = c.id.startsWith("rec:");
    if (c.pago) {
      const i = c.pagoEm ? em(c.pagoEm) : undefined;
      if (i === undefined) continue;
      acc[i].sr += v;
      acc[i].movs.push({ tipo: "SAIDA", previsto: false, origem: "CONTA", descricao: c.fornecedor, valor: reais(v) });
      continue;
    }
    const vencida = c.vencimento < hoje;
    const i = em(vencida ? hoje : c.vencimento);
    if (vencida) { vencidas.q++; vencidas.c += v; }
    if (i === undefined) continue;
    acc[i].ap += v;
    acc[i].movs.push({
      tipo: "SAIDA", previsto: true, origem: recorrente ? "RECORRENTE" : "CONTA",
      descricao: recorrente ? `${c.fornecedor} (recorrente)` : c.fornecedor, valor: reais(v), ...(vencida ? { vencidaEm: c.vencimento } : {}),
    });
  }

  for (const d of e.despesas) {
    const v = cent(d.valor);
    const i = em(d.dia);
    if (!(v > 0) || i === undefined) continue;
    const descricao = d.descricao ? `${d.categoria} — ${d.descricao}` : d.categoria;
    if (d.dia <= hoje) { acc[i].sr += v; acc[i].movs.push({ tipo: "SAIDA", previsto: false, origem: "DESPESA", descricao, valor: reais(v) }); }
    else { acc[i].ap += v; acc[i].movs.push({ tipo: "SAIDA", previsto: true, origem: "DESPESA", descricao, valor: reais(v) }); }
  }

  // O saldo no começo de cada dia: ancorado no informado, para a frente e para trás.
  const liquido = acc.map((a) => a.er + a.ar + a.vp - a.sr - a.ap);
  const inicio = new Array<number>(n).fill(0);
  const iSaldo = e.saldo ? em(e.saldo.dia) : undefined;
  if (e.saldo && iSaldo !== undefined) {
    inicio[iSaldo] = cent(e.saldo.valor);
    for (let i = iSaldo + 1; i < n; i++) inicio[i] = inicio[i - 1] + liquido[i - 1];
    for (let i = iSaldo - 1; i >= 0; i--) inicio[i] = inicio[i + 1] - liquido[i];
  } else {
    for (let i = 1; i < n; i++) inicio[i] = inicio[i - 1] + liquido[i - 1];
  }

  const saida: DiaDoFluxo[] = [];
  for (let i = 0; i < n; i++) {
    const dia = dias[i];
    if (dia < e.de || dia > e.ate) continue;
    const a = acc[i];
    a.movs.sort((x, y) => (x.tipo === y.tipo ? y.valor - x.valor : x.tipo === "ENTRADA" ? -1 : 1));
    saida.push({
      dia, diaSemana: new Date(`${dia}T12:00:00Z`).getUTCDay(),
      saldoAnterior: reais(inicio[i]),
      entradasRealizadas: reais(a.er), saidasRealizadas: reais(a.sr), aReceber: reais(a.ar), vendasPrevistas: reais(a.vp), aPagar: reais(a.ap),
      saldo: reais(inicio[i] + liquido[i]),
      quando: dia < hoje ? "passado" : dia === hoje ? "hoje" : "futuro",
      movimentos: a.movs,
    });
  }

  const soma = (k: keyof Pick<DiaDoFluxo, "entradasRealizadas" | "saidasRealizadas" | "aReceber" | "vendasPrevistas" | "aPagar">) =>
    reais(saida.reduce((s, d) => s + cent(d[k]), 0));
  const menor = saida.reduce<DiaDoFluxo | null>((m, d) => (!m || d.saldo < m.saldo ? d : m), null);

  let negativo: ResultadoDoFluxo["negativo"] = null;
  if (e.saldo && iSaldo !== undefined) {
    const primeiro = saida.find((d) => d.dia >= hoje && d.saldo < -0.005);
    if (primeiro) {
      const ate = saida.filter((d) => d.dia >= hoje && d.dia <= primeiro.dia);
      const maioresContas = ate
        .flatMap((d) => d.movimentos.filter((m) => m.tipo === "SAIDA").map((m) => ({ descricao: m.descricao, dia: d.dia, valor: m.valor })))
        .sort((x, y) => y.valor - x.valor)
        .slice(0, 3);
      negativo = { dia: primeiro.dia, saldo: primeiro.saldo, maioresContas };
    }
  }

  return {
    dias: saida,
    total: { entradasRealizadas: soma("entradasRealizadas"), saidasRealizadas: soma("saidasRealizadas"), aReceber: soma("aReceber"), vendasPrevistas: soma("vendasPrevistas"), aPagar: soma("aPagar") },
    saldoInicial: saida[0]?.saldoAnterior ?? 0,
    saldoFinal: saida[saida.length - 1]?.saldo ?? 0,
    saldoInformado: e.saldo && iSaldo !== undefined ? e.saldo : null,
    menorSaldo: menor ? { dia: menor.dia, valor: menor.saldo } : null,
    negativo,
    vencidas: { quantidade: vencidas.q, valor: reais(vencidas.c) },
  };
}

// ── POR SEMANA E POR MÊS ────────────────────────────────────────────────────

export type LinhaAgrupada = Omit<DiaDoFluxo, "dia" | "diaSemana" | "quando" | "movimentos"> & { de: string; ate: string; rotulo: string; temNegativo: boolean };

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** A semana (segunda a domingo) ou o mês: soma os movimentos, saldo do 1º e do último dia. */
export function agruparFluxo(dias: DiaDoFluxo[], por: "semana" | "mes"): LinhaAgrupada[] {
  const grupos = new Map<string, DiaDoFluxo[]>();
  for (const d of dias) {
    const k = por === "mes" ? d.dia.slice(0, 7) : somarDias(d.dia, -((d.diaSemana + 6) % 7));
    const g = grupos.get(k) || [];
    g.push(d);
    grupos.set(k, g);
  }
  return [...grupos.entries()].map(([k, g]) => {
    const s = (f: (d: DiaDoFluxo) => number) => c2(g.reduce((t, d) => t + f(d), 0));
    const de = g[0].dia, ate = g[g.length - 1].dia;
    return {
      de, ate,
      rotulo: por === "mes" ? `${MESES[Number(k.slice(5, 7)) - 1]}/${k.slice(0, 4)}` : `${de.slice(8, 10)}/${de.slice(5, 7)} a ${ate.slice(8, 10)}/${ate.slice(5, 7)}`,
      saldoAnterior: g[0].saldoAnterior,
      entradasRealizadas: s((d) => d.entradasRealizadas), saidasRealizadas: s((d) => d.saidasRealizadas),
      aReceber: s((d) => d.aReceber), vendasPrevistas: s((d) => d.vendasPrevistas), aPagar: s((d) => d.aPagar),
      saldo: g[g.length - 1].saldo,
      temNegativo: g.some((d) => d.saldo < -0.005),
    };
  });
}

// ── O SALDO GRAVADO ─────────────────────────────────────────────────────────

/**
 * O saldo que o lojista informou, em `User.financialGoals.saldoDoFluxo`
 * ({ valor, dia }) — o Json da configuração financeira, junto da comissão dos
 * apps e dos prazos. O que vier torto é "não informado".
 */
export function lerSaldoInformado(financialGoals: unknown): SaldoInformado | null {
  const s = financialGoals && typeof financialGoals === "object" ? (financialGoals as any).saldoDoFluxo : null;
  if (!s || typeof s !== "object") return null;
  const valor = Number(s.valor);
  const dia = String(s.dia || "");
  if (!Number.isFinite(valor) || !/^\d{4}-\d{2}-\d{2}$/.test(dia)) return null;
  return { valor: c2(valor), dia };
}
