/**
 * A SEMANA DO CMV segue o dia da contagem completa da loja.
 *
 * O Hakim conta tudo na TERÇA, antes de abrir às 17h30 (domingo tem movimento
 * demais — Douglas, 11/10/2026). Contagem de terça à tarde é o que sobrou do
 * expediente de SEGUNDA, então ela fecha a segunda, e a semana do CMV vai de
 * terça a segunda: começa no dia seguinte ao dia que a contagem fecha.
 *
 *   contagem completa      fecha o dia     semana do CMV
 *   terça, antes de abrir  segunda         terça a segunda
 *   terça, depois de fechar terça          quarta a terça
 *   domingo, depois         domingo         segunda a domingo (padrão)
 *
 * Gravado em `User.financialGoals.semanaDoCmv` ({ diaDaContagem: 0-6, momento }),
 * pela aba Metas da tela Dados sensíveis. Puro; testado em scripts/teste-cmv-real.ts.
 */
import { naLoja, somarDias } from "@/lib/relatorios/base";
import { normalizeStoreHours } from "@/lib/store-hours";

export type MomentoDaContagem = "ANTES_DE_ABRIR" | "DEPOIS_DE_FECHAR";
export type SemanaDoCmv = {
  /** Dia da semana em que a contagem completa é feita (0 = domingo). */
  diaDaContagem: number;
  momento: MomentoDaContagem;
  /** O dia da semana que a contagem FECHA. */
  fecha: number;
  /** O dia da semana em que a semana do CMV começa. */
  comecaEm: number;
};

export const NOMES_DOS_DIAS_DA_SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

export function semanaDoCmv(diaDaContagem: number, momento: MomentoDaContagem): SemanaDoCmv {
  const d = ((Math.round(diaDaContagem) % 7) + 7) % 7;
  const fecha = momento === "ANTES_DE_ABRIR" ? (d + 6) % 7 : d;
  return { diaDaContagem: d, momento, fecha, comecaEm: (fecha + 1) % 7 };
}

/** O que está gravado na loja; sem nada, domingo depois de fechar (semana de segunda a domingo). */
export function lerSemanaDoCmv(goals: unknown): SemanaDoCmv {
  const g = goals && typeof goals === "object" ? (goals as Record<string, any>).semanaDoCmv : null;
  const dia = Number(g?.diaDaContagem);
  const momento: MomentoDaContagem = g?.momento === "ANTES_DE_ABRIR" ? "ANTES_DE_ABRIR" : "DEPOIS_DE_FECHAR";
  return semanaDoCmv(Number.isInteger(dia) && dia >= 0 && dia <= 6 ? dia : 0, momento);
}

const diaDaSemana = (dia: string) => new Date(`${dia}T12:00:00Z`).getUTCDay();

/** O primeiro dia da semana do CMV que contém `dia`. */
export function inicioDaSemanaDoCmv(dia: string, comecaEm: number): string {
  return somarDias(dia, -((diaDaSemana(dia) - comecaEm + 7) % 7));
}

/**
 * Que dia a contagem feita AGORA fecha. Antes do horário de abrir de hoje, o
 * que está na prateleira é o que sobrou de ontem; depois de abrir (ou com a
 * loja fechada hoje), é o de hoje. O dia operacional já vira às 5h
 * (lib/relatorios/base.ts): contar à 1h da manhã fecha o dia que acabou.
 */
export function diaQueAContagemFecha(agora: Date, tz: string, storeHours: unknown): string {
  const { dia, minutos, hora } = naLoja(agora, tz);
  // Antes das 5h o "hoje" operacional já é o dia anterior: é depois do expediente.
  if (hora < 5) return dia;
  const nomes = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
  const horarios = normalizeStoreHours(storeHours);
  const hoje = horarios.find((h) => h.day === nomes[diaDaSemana(dia)]);
  if (!hoje || !hoje.active) return dia;
  const turnos = hoje.shifts?.length ? hoje.shifts : [{ open: hoje.open, close: hoje.close }];
  const abre = Math.min(...turnos.map((t) => {
    const [h, m] = String(t.open || "").split(":").map(Number);
    return Number.isFinite(h) ? h * 60 + (m || 0) : 24 * 60;
  }));
  return minutos < abre ? somarDias(dia, -1) : dia;
}
