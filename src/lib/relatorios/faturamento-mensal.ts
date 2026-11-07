/**
 * O relatório "Faturamento mensal" — os 12 meses de um ano, cada um com
 * faturamento, vendas, ticket médio e média por dia, e ao lado o MESMO mês do
 * ano anterior com a variação. Pedido do Alex (Hambúrgueria Avenida, veio do
 * SWFast, 07/11/2026): ele olha o mês contra o mês ("155 mil em janeiro, 148
 * mil em outubro"), e o FireHub só comparava com o período logo antes.
 *
 * ── A régua: a mesma do Faturamento por dia ────────────────────────────────
 *
 * Cada mês é o `faturamentoPorDia` do dia 1 ao último dia do mês — a MESMA
 * função, não uma conta parecida. Por isso o mês daqui bate com a soma do
 * Faturamento por dia aberto naquele mês (e com o Vendas por período): valor
 * pelo `totalAmount` do pedido no dia operacional (vira às 5h), a mesa é UMA
 * venda no primeiro lançamento dentro do mês, ticket = valor ÷ vendas
 * (lib/relatorios/regua-da-venda.ts).
 *
 * A mesa que atravessa a virada do mês (lançou às 04h50 do dia 1º e de novo
 * às 05h10) é uma venda em cada mês, como seria abrindo o Faturamento por dia
 * de cada mês. O total do ANO é a soma dos meses — o que o lojista confere de
 * cabeça —, então essa mesa rara conta duas vezes lá também.
 *
 * ── O que o SWF não faz e este faz ──────────────────────────────────────────
 *
 * - O mês corrente é "até hoje", com a PROJEÇÃO do fechamento no ritmo dos
 *   dias que já fecharam (a régua da meta do Faturamento por dia: hoje ainda
 *   está vendendo e não entra no ritmo).
 * - O mês corrente se compara com o mesmo mês do ano passado ATÉ O MESMO DIA
 *   E HORÁRIO — o dia 7 às 15h contra o novembro inteiro do ano passado dava
 *   "↓ 78%" todo começo de mês. O mês inteiro do ano passado aparece ao lado,
 *   como alvo para a projeção.
 * - Mês sem dado no FireHub (antes do 1º pedido da loja — o Alex chegou do
 *   SWF agora) não é zero: é "sem dados". Zero viraria "↑ 100%" ou "↓ 100%".
 *   O mês em que a loja COMEÇOU, no meio, também não tem variação: metade de
 *   um mês contra um mês inteiro não diz nada.
 *
 * Puro: recebe os pedidos de cada mês já buscados e filtrados
 * (api/store/relatorios/faturamento-mensal). Testado em
 * scripts/teste-faturamento-mensal.ts.
 */
import { cent, reais, ticketMedio } from "@/lib/relatorios/regua-da-venda";
import { faturamentoPorDia, ultimoDiaDoMes, variacao, type PedidoParaFaturamento } from "@/lib/relatorios/faturamento-por-dia";

export const NOMES_DOS_MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

/**
 * "fechado" = o mês acabou; "corrente" = o mês de hoje; "futuro" = não chegou;
 * "sem-dados" = acabou antes do 1º pedido da loja no FireHub.
 */
export type EstadoDoMes = "fechado" | "corrente" | "futuro" | "sem-dados";

export type ResumoDoMes = {
  /** "YYYY-MM". */
  mes: string;
  estado: EstadoDoMes;
  /** A loja começou no meio deste mês (o dia do 1º pedido), ou null. */
  comecouEm: string | null;
  valor: number;
  vendas: number;
  /** Das vendas, quantas são contas de mesa. */
  mesas: number;
  /** Pedidos que são venda (cada rodada de mesa é um). */
  lancamentos: number;
  ticketMedio: number | null;
  /** Média por dia dos dias que já fecharam (a do Faturamento por dia). */
  mediaPorDia: number | null;
  /** Último dia somado: o fim do mês, ou hoje no mês corrente. null no futuro e sem dados. */
  ateODia: string | null;
  /** Só no mês corrente: onde o mês fecha no ritmo dos dias fechados. null sem dia fechado. */
  projecao: number | null;
  /** Pedidos deixados fora por valor impossível (≥ R$ 1 milhão). */
  valoresImpossiveis: number;
};

export type EntradaDoMes = {
  /** "YYYY-MM". */
  mes: string;
  tz: string;
  /** "Hoje" no dia operacional da loja. */
  hoje: string;
  /** Dia operacional do 1º pedido da loja (qualquer status). null = nenhum pedido ainda. */
  primeiroDia: string | null;
  /** Os pedidos do mês (a janela do dia 1 ao último dia), já com os filtros. */
  pedidos: PedidoParaFaturamento[];
  /**
   * Corta no instante: só os pedidos de ANTES dele contam. É o mês do ano
   * passado visto "até o mesmo dia e horário" de hoje.
   */
  corte?: Date | string | null;
  /** Com `corte`: o dia que faz o papel de "hoje" (o mesmo dia, um ano antes). */
  hojeDoCorte?: string;
};

export const primeiroDiaDoMes = (mes: string) => `${mes}-01`;

/** O estado do mês em relação a hoje e ao 1º pedido da loja. */
export function estadoDoMes(mes: string, hoje: string, primeiroDia: string | null): EstadoDoMes {
  if (primeiroDiaDoMes(mes) > hoje) return "futuro";
  if (!primeiroDia || ultimoDiaDoMes(mes) < primeiroDia) return "sem-dados";
  return hoje <= ultimoDiaDoMes(mes) ? "corrente" : "fechado";
}

/** Um mês: o Faturamento por dia do dia 1 ao último dia, somado. */
export function resumoDoMes(e: EntradaDoMes): ResumoDoMes {
  const de = primeiroDiaDoMes(e.mes);
  const ate = ultimoDiaDoMes(e.mes);
  const hoje = e.corte && e.hojeDoCorte ? e.hojeDoCorte : e.hoje;
  const estado = estadoDoMes(e.mes, hoje, e.primeiroDia);
  const comecouEm = e.primeiroDia && e.primeiroDia > de && e.primeiroDia <= ate ? e.primeiroDia : null;
  const vazio: ResumoDoMes = {
    mes: e.mes, estado, comecouEm, valor: 0, vendas: 0, mesas: 0, lancamentos: 0, ticketMedio: null, mediaPorDia: null,
    ateODia: null, projecao: null, valoresImpossiveis: 0,
  };
  if (estado === "futuro" || estado === "sem-dados") return vazio;

  const limite = e.corte ? new Date(e.corte).getTime() : null;
  const pedidos = limite === null ? e.pedidos : e.pedidos.filter((p) => new Date(p.createdAt).getTime() < limite);
  const r = faturamentoPorDia({ de, ate, tz: e.tz, hoje, primeiroDia: e.primeiroDia, pedidos });

  // A projeção é a régua da meta (progressoDaMeta): os dias fechados dão o
  // ritmo, hoje e os dias que faltam entram pela média deles. O dia antes do
  // 1º pedido não é dia de venda — nem no ritmo, nem no que falta.
  let projecao: number | null = null;
  if (estado === "corrente") {
    const fechados = r.dias.filter((d) => d.estado === "fechado");
    const restantes = r.dias.filter((d) => d.estado === "hoje" || d.estado === "futuro").length;
    if (fechados.length) {
      const acumulado = fechados.reduce((s, d) => s + cent(d.valor), 0);
      projecao = reais(acumulado + Math.round((acumulado / fechados.length) * restantes));
    }
  }

  return {
    ...vazio,
    valor: r.total.valor,
    vendas: r.total.vendas,
    mesas: r.total.mesas,
    lancamentos: r.total.lancamentos,
    ticketMedio: r.total.ticketMedio,
    mediaPorDia: r.media.base === "nenhum" ? null : r.media.valor,
    ateODia: estado === "corrente" ? hoje : ate,
    projecao,
    valoresImpossiveis: r.valoresImpossiveis,
  };
}

// ── O MESMO DIA, UM ANO ANTES ───────────────────────────────────────────────

/** "2026-11-07" → "2025-11-07"; 29/02 vira 28/02. */
export function mesmoDiaNoAnoAnterior(dia: string): string {
  const ano = Number(dia.slice(0, 4)) - 1;
  const mes = dia.slice(5, 7);
  const ultimo = ultimoDiaDoMes(`${ano}-${mes}`);
  const candidato = `${ano}-${mes}-${dia.slice(8, 10)}`;
  return candidato > ultimo ? ultimo : candidato;
}

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * O instante de agora, um ano antes: o corte do mês corrente do ano passado.
 * Recua o número de dias entre os dois "hoje" — a mesma conta de
 * `anteriorAteEsteHorario` (lib/relatorios/regua-da-venda.ts).
 */
export function corteDoAnoAnterior(hoje: string, agora: number = Date.now()): { dia: string; instante: Date } {
  const dia = mesmoDiaNoAnoAnterior(hoje);
  const recuo = Math.round((new Date(`${hoje}T12:00:00Z`).getTime() - new Date(`${dia}T12:00:00Z`).getTime()) / DIA_MS);
  return { dia, instante: new Date(agora - recuo * DIA_MS) };
}

// ── O ANO ───────────────────────────────────────────────────────────────────

export type LinhaDoMes = {
  mes: string;
  /** 0 = janeiro. */
  indice: number;
  atual: ResumoDoMes;
  /** O mesmo mês do ano anterior, inteiro. */
  anterior: ResumoDoMes;
  /** No mês corrente: o ano anterior até o mesmo dia e horário (é com ele que se compara). */
  anteriorAteOMesmoDia: ResumoDoMes | null;
  /** Os dois lados têm o mês inteiro no FireHub (ou o corrente contra o mesmo pedaço)? */
  comparavel: boolean;
  variacao: { valor: number | null; vendas: number | null; ticketMedio: number | null };
};

export type SomaDoAno = { valor: number; vendas: number; ticketMedio: number | null };

export type ResultadoMensal = {
  ano: number;
  meses: LinhaDoMes[];
  /** O ano até hoje (meses fechados + o corrente até agora). */
  total: SomaDoAno;
  /** O ano anterior inteiro. */
  totalAnterior: SomaDoAno;
  /**
   * Este ano contra o anterior só nos meses COMPARÁVEIS (dado nos dois anos;
   * o corrente até o mesmo dia). `meses` diz quantos entraram.
   */
  comparacao: { meses: number; atual: SomaDoAno; anterior: SomaDoAno; variacao: { valor: number | null; vendas: number | null; ticketMedio: number | null } };
  /** O mês de maior faturamento do ano (fechado ou corrente). */
  melhorMes: { mes: string; valor: number } | null;
  /** O mês corrente, quando o ano escolhido é o de hoje. */
  mesCorrente: string | null;
  valoresImpossiveis: number;
};

const somar = (ms: ResumoDoMes[]): SomaDoAno => {
  const valor = ms.reduce((s, m) => s + cent(m.valor), 0);
  const vendas = ms.reduce((s, m) => s + m.vendas, 0);
  return { valor: reais(valor), vendas, ticketMedio: vendas > 0 ? ticketMedio(reais(valor), vendas) : null };
};

const temDado = (m: ResumoDoMes) => m.estado === "fechado" || m.estado === "corrente";

const variacoes = (a: SomaDoAno | ResumoDoMes, b: SomaDoAno | ResumoDoMes) => ({
  valor: variacao(a.valor, b.valor),
  vendas: variacao(a.vendas, b.vendas),
  ticketMedio: a.ticketMedio !== null && b.ticketMedio !== null ? variacao(a.ticketMedio, b.ticketMedio) : null,
});

/**
 * Junta os 24 meses (12 do ano, 12 do anterior) numa tabela. `atual[i]` e
 * `anterior[i]` são os resumos de cada mês (janeiro = 0); `anteriorAteOMesmoDia`
 * é o mês corrente do ano passado cortado no mesmo instante, quando há.
 */
export function faturamentoMensal(e: {
  ano: number;
  atual: ResumoDoMes[];
  anterior: ResumoDoMes[];
  anteriorAteOMesmoDia?: ResumoDoMes | null;
}): ResultadoMensal {
  const meses: LinhaDoMes[] = e.atual.map((atual, indice) => {
    const anterior = e.anterior[indice];
    const corrente = atual.estado === "corrente";
    const parcial = corrente ? e.anteriorAteOMesmoDia ?? null : null;
    const base = corrente ? parcial : anterior;
    // Comparável: dado dos dois lados, e nenhum dos dois é o mês em que a loja
    // começou no meio (meio mês contra mês inteiro inventa um "↑ 90%").
    const comparavel = Boolean(base && temDado(atual) && temDado(base) && !atual.comecouEm && !base.comecouEm);
    return {
      mes: atual.mes, indice, atual, anterior, anteriorAteOMesmoDia: parcial, comparavel,
      variacao: comparavel && base ? variacoes(atual, base) : { valor: null, vendas: null, ticketMedio: null },
    };
  });

  const comparaveis = meses.filter((m) => m.comparavel);
  const atualC = somar(comparaveis.map((m) => m.atual));
  const anteriorC = somar(comparaveis.map((m) => m.anteriorAteOMesmoDia ?? m.anterior));
  const comDado = e.atual.filter(temDado);
  const melhor = comDado.filter((m) => m.lancamentos > 0).reduce<ResumoDoMes | null>((x, m) => (!x || m.valor > x.valor ? m : x), null);

  return {
    ano: e.ano,
    meses,
    total: somar(comDado),
    totalAnterior: somar(e.anterior.filter(temDado)),
    comparacao: {
      meses: comparaveis.length,
      atual: atualC,
      anterior: anteriorC,
      variacao: comparaveis.length ? variacoes(atualC, anteriorC) : { valor: null, vendas: null, ticketMedio: null },
    },
    melhorMes: melhor ? { mes: melhor.mes, valor: melhor.valor } : null,
    mesCorrente: e.atual.find((m) => m.estado === "corrente")?.mes ?? null,
    valoresImpossiveis: e.atual.reduce((s, m) => s + m.valoresImpossiveis, 0),
  };
}

/** Os 12 meses do ano, "YYYY-MM". */
export function mesesDoAno(ano: number): string[] {
  return Array.from({ length: 12 }, (_, i) => `${ano}-${String(i + 1).padStart(2, "0")}`);
}

/**
 * O ano pedido na URL, ou o de hoje. Só anos com venda possível: do ano do 1º
 * pedido da loja até o de hoje — ano que não existe para a loja abriria 24
 * meses de "sem dados".
 */
export function lerAno(bruto: string | null | undefined, hoje: string, primeiroDia: string | null): number {
  const atual = Number(hoje.slice(0, 4));
  const primeiro = primeiroDia ? Number(primeiroDia.slice(0, 4)) : atual;
  const n = Number(bruto);
  return Number.isInteger(n) && n >= primeiro && n <= atual ? n : atual;
}

/** Os meses que valem uma ida ao banco: os que têm dado (nem futuro, nem antes do 1º pedido). */
export function mesesParaBuscar(meses: string[], hoje: string, primeiroDia: string | null): string[] {
  return meses.filter((m) => {
    const estado = estadoDoMes(m, hoje, primeiroDia);
    return estado === "fechado" || estado === "corrente";
  });
}
