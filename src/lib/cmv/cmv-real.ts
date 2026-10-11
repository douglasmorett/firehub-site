/**
 * O CMV REAL — o que a loja de fato gastou de mercadoria, pela contagem.
 *
 *     CMV = estoque da contagem de abertura
 *         + compras lançadas depois dela, até o dia da contagem de fechamento
 *         − estoque da contagem de fechamento
 *
 *     CMV % = CMV ÷ vendas (valor vendido sem a taxa de entrega) dos mesmos dias
 *
 * Nada de ficha técnica aqui: a ficha diz quanto DEVERIA ter saído; a contagem
 * diz quanto SAIU. É o número do McDonald's e o que o Douglas pediu em
 * 11/10/2026 ("não quero CMV teórico").
 *
 * ── A janela ────────────────────────────────────────────────────────────────
 *
 * Toda contagem fecha um dia operacional. A semana de segunda 13 a domingo 19
 * abre na contagem do domingo 12 e fecha na última contagem até o dia 19: com
 * a contagem rápida no fechamento de cada dia, o ponteiro da semana anda a
 * cada dia que fecha. Sem contagem na véspera do período, a janela abre na
 * primeira contagem DENTRO dele, e a tela diz de que dia a que dia o número
 * vale (`parcial`).
 *
 * Puro: quem busca é src/lib/cmv/painel.ts. Testado em scripts/teste-cmv-real.ts.
 */
import { somarDias } from "@/lib/relatorios/base";

export type ContagemFechada = { id: string; dia: string; tipo: string; valorTotal: number };

/** O que aconteceu num dia operacional. */
export type DiaDoCmv = {
  dia: string;
  /** R$ das compras que entraram no estoque neste dia. */
  compras: number;
  /** Valor vendido sem a taxa de entrega. */
  vendas: number;
};

export type JanelaDoCmv = {
  abertura: ContagemFechada | null;
  fechamento: ContagemFechada | null;
  /** A janela não cobre o período inteiro (começa depois ou termina antes). */
  parcial: boolean;
  /** O que falta para ter número, quando falta. */
  falta: null | "NENHUMA_CONTAGEM" | "SO_UMA_CONTAGEM";
};

export type CmvDoTrecho = {
  /** Primeiro e último dia operacional cobertos (o dia seguinte à abertura até o fechamento). */
  de: string;
  ate: string;
  estoqueInicial: number;
  compras: number;
  estoqueFinal: number;
  cmv: number;
  vendas: number;
  /** CMV ÷ vendas × 100. Nulo sem venda. */
  pct: number | null;
  tipoDoFechamento: string;
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Escolhe as contagens que abrem e fecham o período. `contagens` em qualquer ordem. */
export function janelaDoPeriodo(contagens: ContagemFechada[], de: string, ate: string): JanelaDoCmv {
  const ordem = [...contagens].sort((a, b) => a.dia.localeCompare(b.dia));
  const vespera = somarDias(de, -1);

  let abertura = [...ordem].reverse().find((c) => c.dia <= vespera) ?? null;
  let parcial = false;
  if (!abertura) {
    abertura = ordem.find((c) => c.dia >= de && c.dia <= ate) ?? null;
    parcial = Boolean(abertura);
  }
  if (!abertura) return { abertura: null, fechamento: null, parcial: false, falta: "NENHUMA_CONTAGEM" };

  const fechamento = [...ordem].reverse().find((c) => c.dia > abertura!.dia && c.dia <= ate) ?? null;
  if (!fechamento) return { abertura, fechamento: null, parcial, falta: "SO_UMA_CONTAGEM" };
  if (fechamento.dia < ate) parcial = true;
  return { abertura, fechamento, parcial, falta: null };
}

/** CMV entre duas contagens, com as compras e vendas dos dias do meio. */
export function cmvEntre(abertura: ContagemFechada, fechamento: ContagemFechada, dias: DiaDoCmv[]): CmvDoTrecho {
  let compras = 0, vendas = 0;
  for (const d of dias) {
    if (d.dia <= abertura.dia || d.dia > fechamento.dia) continue;
    compras += d.compras;
    vendas += d.vendas;
  }
  const cmv = r2(abertura.valorTotal + compras - fechamento.valorTotal);
  return {
    de: somarDias(abertura.dia, 1),
    ate: fechamento.dia,
    estoqueInicial: r2(abertura.valorTotal),
    compras: r2(compras),
    estoqueFinal: r2(fechamento.valorTotal),
    cmv,
    vendas: r2(vendas),
    pct: vendas > 0 ? r1((cmv / vendas) * 100) : null,
    tipoDoFechamento: fechamento.tipo,
  };
}

/**
 * Um trecho por par de contagens seguidas dentro da janela: com contagem todo
 * dia, um trecho por dia — é o gráfico do CMV dia a dia.
 */
export function trechosDaJanela(contagens: ContagemFechada[], janela: JanelaDoCmv, dias: DiaDoCmv[]): CmvDoTrecho[] {
  if (!janela.abertura || !janela.fechamento) return [];
  const dentro = [...contagens]
    .filter((c) => c.dia >= janela.abertura!.dia && c.dia <= janela.fechamento!.dia)
    .sort((a, b) => a.dia.localeCompare(b.dia));
  const trechos: CmvDoTrecho[] = [];
  for (let i = 1; i < dentro.length; i++) trechos.push(cmvEntre(dentro[i - 1], dentro[i], dias));
  return trechos;
}

export type ZonaDoCmv = "verde" | "amarelo" | "vermelho" | "sem";

/** Meta da planilha de custo do Hakim: "CMV ideal 30 a 33%". */
export const META_PADRAO_DO_CMV = 33;
/** CMO de referência para restaurante de delivery. */
export const META_PADRAO_DO_CMO = 25;

/** Segunda-feira da semana do dia (a semana do CMV vai de segunda a domingo). */
export function segundaDaSemana(dia: string): string {
  const dow = new Date(`${dia}T12:00:00Z`).getUTCDay(); // 0 = domingo
  return somarDias(dia, -((dow + 6) % 7));
}
/** Pontos acima da meta que ainda são "atenção" antes do vermelho. */
export const FAIXA_DE_ATENCAO = 3;

export function zonaDoCmv(pct: number | null, meta: number = META_PADRAO_DO_CMV): ZonaDoCmv {
  if (pct == null || !Number.isFinite(pct)) return "sem";
  if (pct <= meta) return "verde";
  if (pct <= meta + FAIXA_DE_ATENCAO) return "amarelo";
  return "vermelho";
}

/** A meta gravada em `User.financialGoals.cmvPct` (aceita "32,5"), ou a padrão. */
export function lerMeta(goals: unknown, chave: "cmvPct" | "cmoPct", padrao: number): number {
  const g = goals && typeof goals === "object" ? (goals as Record<string, unknown>) : {};
  const n = Number(String(g[chave] ?? "").replace(",", "."));
  return Number.isFinite(n) && n > 0 && n < 100 ? n : padrao;
}
