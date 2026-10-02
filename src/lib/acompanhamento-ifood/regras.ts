/**
 * Regras do ACOMPANHAMENTO iFOOD (a consultoria paga), sem banco — usadas pela
 * aba do admin e pelas rotas. O contrato de referência é o da Divinos Burger
 * (30/09/2026): % do Repasse da Semana acima de uma base semanal, com teto; e
 * o relatório do mês sai até o dia 10 do mês seguinte.
 */

export type ModeloDeCobranca = "PERCENTUAL" | "FIXO";
export type StatusDoCliente = "ATIVO" | "PAUSADO" | "ENCERRADO";
export type StatusDoRelatorio = "RASCUNHO" | "ENVIADO";

/** Dia do mês seguinte até quando o relatório do mês tem de ter saído. */
export const DIA_DO_RELATORIO = 10;

export type Contrato = {
  modelo: string;
  percentual: number;
  baseSemanal: number;
  tetoSemanal: number | null;
  valorFixoSemanal: number | null;
};

/**
 * O honorário de uma semana. Repasse acima da base é o "dinheiro novo";
 * negativo vira zero. No fixo, o valor da semana não depende do repasse.
 */
export function honorarioDaSemana(c: Contrato, repasseDaSemana: number) {
  if (c.modelo === "FIXO") {
    const v = c.valorFixoSemanal ?? c.tetoSemanal ?? 0;
    return { novo: Math.max(0, repasseDaSemana - c.baseSemanal), honorario: v, noTeto: true };
  }
  const novo = Math.max(0, repasseDaSemana - c.baseSemanal);
  const cheio = (novo * c.percentual) / 100;
  const teto = c.tetoSemanal && c.tetoSemanal > 0 ? c.tetoSemanal : Infinity;
  const honorario = Math.round(Math.min(cheio, teto) * 100) / 100;
  return { novo, honorario, noTeto: cheio >= teto };
}

/** "5% acima de R$ 49,31/sem · teto R$ 250" — o contrato numa linha. */
export function contratoEmUmaLinha(c: Contrato): string {
  const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  if (c.modelo === "FIXO") return `Fixo de ${brl(c.valorFixoSemanal ?? c.tetoSemanal ?? 0)}/semana`;
  const pct = c.percentual.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  const teto = c.tetoSemanal && c.tetoSemanal > 0 ? ` · teto ${brl(c.tetoSemanal)}` : "";
  return `${pct}% acima de ${brl(c.baseSemanal)}/sem${teto}`;
}

/** Hoje em Brasília: ano, mês (1–12) e dia. O container roda em UTC. */
export function hojeEmBrasilia(agora = new Date()) {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(agora);
  const n = (t: string) => Number(p.find((x) => x.type === t)!.value);
  return { ano: n("year"), mes: n("month"), dia: n("day") };
}

/** "2026-09" deslocado de `delta` meses. */
export function somarMeses(mes: string, delta: number): string {
  const [a, m] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function mesAtual(agora = new Date()): string {
  const h = hojeEmBrasilia(agora);
  return `${h.ano}-${String(h.mes).padStart(2, "0")}`;
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** "setembro/2026" — ou "setembro" com `semAno`. */
export function nomeDoMes(mes: string, semAno = false): string {
  const [a, m] = mes.split("-").map(Number);
  const nome = MESES[m - 1] || mes;
  return semAno ? nome : `${nome}/${a}`;
}

/** "set/26" para o eixo do gráfico. */
export function mesCurto(mes: string): string {
  const [a, m] = mes.split("-").map(Number);
  return `${(MESES[m - 1] || "").slice(0, 3)}/${String(a).slice(2)}`;
}

/** A base do contrato no tamanho do mês: base semanal ÷ 7 × dias do mês. */
export function baseDoMes(baseSemanal: number, mes: string): number {
  const [a, m] = mes.split("-").map(Number);
  const dias = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return Math.round(((baseSemanal / 7) * dias) * 100) / 100;
}

export type SituacaoDoRelatorio =
  | { tipo: "ENVIADO"; mes: string }
  | { tipo: "RASCUNHO"; mes: string; diasParaOPrazo: number }
  | { tipo: "NO_PRAZO"; mes: string; diasParaOPrazo: number }
  | { tipo: "ATRASADO"; mes: string; diasDeAtraso: number }
  | { tipo: "NADA_DEVIDO" };

/**
 * O relatório que o cliente está esperando agora: o do mês passado, até o dia
 * 10. Cliente que começou neste mês, pausado ou encerrado não deve nenhum.
 */
export function situacaoDoRelatorio(
  cliente: { status: string; inicioEm: Date | string | null; createdAt: Date | string },
  relatorios: { mes: string; status: string }[],
  agora = new Date(),
): SituacaoDoRelatorio {
  if (cliente.status !== "ATIVO") return { tipo: "NADA_DEVIDO" };
  const hoje = hojeEmBrasilia(agora);
  const atual = `${hoje.ano}-${String(hoje.mes).padStart(2, "0")}`;
  const devido = somarMeses(atual, -1);

  const inicio = mesAtual(new Date(cliente.inicioEm || cliente.createdAt));
  if (inicio > devido) return { tipo: "NADA_DEVIDO" };

  const rel = relatorios.find((r) => r.mes === devido);
  if (rel?.status === "ENVIADO") return { tipo: "ENVIADO", mes: devido };
  const diasParaOPrazo = DIA_DO_RELATORIO - hoje.dia;
  if (rel) return { tipo: "RASCUNHO", mes: devido, diasParaOPrazo };
  if (diasParaOPrazo >= 0) return { tipo: "NO_PRAZO", mes: devido, diasParaOPrazo };
  return { tipo: "ATRASADO", mes: devido, diasDeAtraso: -diasParaOPrazo };
}

/**
 * Os números do relatório, todos opcionais: o que se tira do Portal do
 * Parceiro (Financeiro e Desempenho) no fechamento do mês.
 */
export type NumerosDoRelatorio = {
  /** Vendas do mês (valor dos pedidos no portal). */
  vendas?: number | null;
  /** "Total faturamento" do Financeiro — o líquido que o iFood repassa. */
  totalFaturamento?: number | null;
  pedidos?: number | null;
  ticketMedio?: number | null;
  visitas?: number | null;
  /** % de visitas que viraram pedido. */
  conversao?: number | null;
  nota?: number | null;
  /** % de pedidos cancelados. */
  cancelamentos?: number | null;
  /** Honorário apurado no mês (soma das semanas). */
  honorario?: number | null;
};

export const CAMPOS_DOS_NUMEROS: { chave: keyof NumerosDoRelatorio; rotulo: string; tipo: "reais" | "inteiro" | "pct" | "nota" }[] = [
  { chave: "totalFaturamento", rotulo: "Total faturamento (líquido)", tipo: "reais" },
  { chave: "vendas", rotulo: "Vendas", tipo: "reais" },
  { chave: "pedidos", rotulo: "Pedidos", tipo: "inteiro" },
  { chave: "ticketMedio", rotulo: "Ticket médio", tipo: "reais" },
  { chave: "visitas", rotulo: "Visitas", tipo: "inteiro" },
  { chave: "conversao", rotulo: "Conversão", tipo: "pct" },
  { chave: "nota", rotulo: "Nota", tipo: "nota" },
  { chave: "cancelamentos", rotulo: "Cancelamentos", tipo: "pct" },
  { chave: "honorario", rotulo: "Honorário do mês", tipo: "reais" },
];

/**
 * Número digitado em pt-BR: "1.200,50", "R$ 49,31", "6,1%", "4.8". Vazio ou
 * ilegível = null. Dinheiro é texto no formulário — type="number" no Chrome
 * pt-BR lê "1.200,00" como 1,2 sem avisar.
 */
export function lerNumeroBR(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  let t = v.replace(/r\$|%/gi, "").replace(/\s+/g, "");
  if (!t) return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Aceita só número finito; o resto fica de fora. */
export function limparNumeros(entrada: unknown): NumerosDoRelatorio {
  const saida: NumerosDoRelatorio = {};
  if (!entrada || typeof entrada !== "object") return saida;
  for (const { chave } of CAMPOS_DOS_NUMEROS) {
    const n = lerNumeroBR((entrada as Record<string, unknown>)[chave]);
    if (n !== null) saida[chave] = n;
  }
  return saida;
}
