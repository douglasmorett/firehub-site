/**
 * O PAINEL DO BILL LIGADO (/store/bill) — as regras puras: o que cada tipo de
 * registro quer dizer, o resumo do período, quem mandou, os filtros e o cursor
 * do histórico. Sem banco: a tela importa os rótulos e o teste
 * (scripts/teste-painel-do-bill.ts) confere as contas.
 *
 * Douglas, 17/10/2026: "melhorar o painel dele, deixar mais intuitivo, com
 * mais informação, registro de histórico… dar uma geral no Bill assessor".
 *
 * Os números saem dos AssessorRegistro (o que o Bill gravou) e o valor de cada
 * um sai do lançamento de verdade (StockInvoice, DespesaLancada, Payable) — o
 * texto do resumo nunca é lido como número. O período é o dia de operação da
 * loja (vira às 5h, no fuso dela), o mesmo dos Relatórios (lib/relatorios/base.ts).
 */
import { periodoDoAtalho, type AtalhoDePeriodo } from "@/lib/relatorios/base";

export const TIPOS_DO_REGISTRO = ["COMPRA", "SAIDA", "DESPESA", "CONTA", "CONTA_PAGA", "PAUSADO", "REATIVADO", "SITE", "ENTREGA"] as const;
export type TipoDoRegistro = (typeof TIPOS_DO_REGISTRO)[number];

export type GrupoDoRegistro = "Estoque" | "Financeiro" | "Cardápio" | "Loja";

export const ROTULO_DO_REGISTRO: Record<TipoDoRegistro, { texto: string; cor: string; grupo: GrupoDoRegistro }> = {
  COMPRA: { texto: "Compra", cor: "#2563EB", grupo: "Estoque" },
  SAIDA: { texto: "Saída / perda", cor: "#D97706", grupo: "Estoque" },
  DESPESA: { texto: "Despesa", cor: "#DC2626", grupo: "Financeiro" },
  CONTA: { texto: "Conta a pagar", cor: "#7C3AED", grupo: "Financeiro" },
  CONTA_PAGA: { texto: "Conta paga", cor: "#059669", grupo: "Financeiro" },
  PAUSADO: { texto: "Pausado", cor: "#B45309", grupo: "Cardápio" },
  REATIVADO: { texto: "Reativado", cor: "#0891B2", grupo: "Cardápio" },
  SITE: { texto: "Site aberto/fechado", cor: "#475569", grupo: "Loja" },
  ENTREGA: { texto: "Entrega por bairro", cor: "#0D9488", grupo: "Loja" },
};

export function rotuloDoRegistro(tipo: string) {
  return ROTULO_DO_REGISTRO[tipo as TipoDoRegistro] || { texto: tipo, cor: "#475569", grupo: "Loja" as GrupoDoRegistro };
}

/** Onde o lançamento aparece no resto do painel (o "ver no sistema" de cada linha). */
export function ondeVer(tipo: string): { href: string; rotulo: string } | null {
  switch (tipo) {
    case "COMPRA": return { href: "/store/estoque/compras", rotulo: "Compras do estoque" };
    case "SAIDA": return { href: "/store/estoque", rotulo: "Estoque" };
    case "DESPESA": return { href: "/store/financeiro?tab=dre", rotulo: "Financeiro › DRE" };
    case "CONTA":
    case "CONTA_PAGA": return { href: "/store/financeiro?tab=contasapagar", rotulo: "Contas a pagar" };
    case "PAUSADO":
    case "REATIVADO": return { href: "/store/cardapio", rotulo: "Cardápio" };
    case "ENTREGA": return { href: "/store/minha-loja#entrega", rotulo: "Minha Loja › Entrega" };
    default: return null;
  }
}

// ── PERÍODO DO RESUMO ───────────────────────────────────────────────────────

export const PERIODOS_DO_RESUMO = [
  { chave: "hoje", rotulo: "Hoje" },
  { chave: "7d", rotulo: "7 dias" },
  { chave: "mes", rotulo: "Este mês" },
] as const;
export type PeriodoDoResumo = (typeof PERIODOS_DO_RESUMO)[number]["chave"];

export function lerPeriodoDoResumo(v: string | null | undefined): PeriodoDoResumo {
  return v === "7d" || v === "mes" ? v : "hoje";
}

/** Hoje / 7 dias (são 7, contando hoje) / este mês — a partir do dia de operação da loja. */
export function diasDoResumo(p: PeriodoDoResumo, hoje: string): { de: string; ate: string } {
  return periodoDoAtalho(p, hoje);
}

// ── QUEM MANDOU ─────────────────────────────────────────────────────────────

/** "(22) •••••-1680": o DDD e o final bastam para o dono reconhecer o número. */
export function mascararTelefone(t: string | null | undefined): string | null {
  const d = String(t ?? "").replace(/\D/g, "");
  if (d.length < 10) return null;
  const n = d.startsWith("55") && d.length >= 12 ? d.slice(2) : d;
  return `(${n.slice(0, 2)}) ${"•".repeat(Math.max(0, n.length - 6))}-${n.slice(-4)}`;
}

/**
 * Quem pediu o lançamento. Pelo WhatsApp, o número (mascarado); pelo painel, o
 * nome de quem estava logado — gravado no registro desde 17/10/2026 (`refs.autor`);
 * antes disso só se sabe que foi pelo painel.
 */
export function quemMandou(r: { canal: string; telefone?: string | null; autor?: string | null }): string {
  if (r.canal === "PAINEL") return r.autor ? `Painel · ${r.autor}` : "Painel";
  const tel = mascararTelefone(r.telefone);
  return tel ? `WhatsApp · ${tel}` : "WhatsApp";
}

/**
 * Quem estava no painel vai junto nas refs do registro (a tabela não tem coluna
 * de autor): o histórico mostra "Painel · Douglas". Pelo WhatsApp quem mandou
 * é o `telefone` do próprio registro.
 */
export function comAutor(refs: Record<string, unknown>, ctx: { canal: string; autor?: string | null }): Record<string, unknown> {
  return ctx.canal === "PAINEL" && ctx.autor ? { ...refs, autor: String(ctx.autor).slice(0, 60) } : refs;
}

// ── O RESUMO DO PERÍODO ─────────────────────────────────────────────────────

export type RegistroDoResumo = {
  tipo: string;
  desfeitoEm: Date | string | null;
  /** O valor do lançamento de verdade (compra, despesa, conta); null = não tem ou não achou. */
  valor: number | null;
};

export type ContagemComValor = { qtd: number; valor: number };

export type ResumoDoBill = {
  /** Lançamentos que valem (desfeitos ficam de fora de tudo, menos de `desfeitos`). */
  lancamentos: number;
  desfeitos: number;
  porTipo: Partial<Record<TipoDoRegistro, number>>;
  compras: ContagemComValor;
  despesas: ContagemComValor;
  contasAnotadas: ContagemComValor;
  contasPagas: ContagemComValor;
  saidas: number;
  pausados: number;
  reativados: number;
};

const c2 = (n: number) => Math.round(n * 100) / 100;

export function resumirRegistros(regs: RegistroDoResumo[]): ResumoDoBill {
  const r: ResumoDoBill = {
    lancamentos: 0, desfeitos: 0, porTipo: {},
    compras: { qtd: 0, valor: 0 }, despesas: { qtd: 0, valor: 0 }, contasAnotadas: { qtd: 0, valor: 0 }, contasPagas: { qtd: 0, valor: 0 },
    saidas: 0, pausados: 0, reativados: 0,
  };
  const somar = (c: ContagemComValor, v: number | null) => {
    c.qtd += 1;
    if (v !== null && Number.isFinite(v)) c.valor = c2(c.valor + v);
  };
  for (const g of regs) {
    if (g.desfeitoEm) { r.desfeitos += 1; continue; }
    r.lancamentos += 1;
    const tipo = g.tipo as TipoDoRegistro;
    r.porTipo[tipo] = (r.porTipo[tipo] || 0) + 1;
    if (tipo === "COMPRA") somar(r.compras, g.valor);
    else if (tipo === "DESPESA") somar(r.despesas, g.valor);
    else if (tipo === "CONTA") somar(r.contasAnotadas, g.valor);
    else if (tipo === "CONTA_PAGA") somar(r.contasPagas, g.valor);
    else if (tipo === "SAIDA") r.saidas += 1;
    else if (tipo === "PAUSADO") r.pausados += 1;
    else if (tipo === "REATIVADO") r.reativados += 1;
  }
  return r;
}

/**
 * Os produtos que o Bill pausou e que seguem pausados pelo que o Bill fez: para
 * cada produto vale o registro MAIS NOVO do Bill que não foi desfeito. Se for
 * PAUSADO, entra (a tela ainda confere no cardápio se está pausado agora).
 * `registros` vem do mais novo para o mais antigo.
 */
export function pausadosPeloBill(
  registros: { tipo: string; refs: unknown; criadoEm: Date | string; desfeitoEm: Date | string | null; canal: string }[],
): Map<string, { pausadoEm: string; canal: string }> {
  const visto = new Set<string>();
  const pausados = new Map<string, { pausadoEm: string; canal: string }>();
  for (const r of registros) {
    if (r.desfeitoEm || (r.tipo !== "PAUSADO" && r.tipo !== "REATIVADO")) continue;
    const ids: unknown = (r.refs as any)?.ids;
    if (!Array.isArray(ids)) continue;
    for (const id of ids) {
      const k = String(id);
      if (visto.has(k)) continue;
      visto.add(k);
      if (r.tipo === "PAUSADO") pausados.set(k, { pausadoEm: new Date(r.criadoEm).toISOString(), canal: r.canal });
    }
  }
  return pausados;
}

// ── FILTROS E CURSOR DO HISTÓRICO ───────────────────────────────────────────

export type FiltrosDoHistorico = {
  tipos: TipoDoRegistro[];
  canal: "WHATSAPP" | "PAINEL" | null;
  /** Dias de operação "YYYY-MM-DD" (os dois inclusive); null = sem limite. */
  de: string | null;
  ate: string | null;
  busca: string;
  /** Mostrar os desfeitos (padrão: sim, riscados). */
  comDesfeitos: boolean;
  cursor: { criadoEm: Date; id: string } | null;
  limite: number;
};

const DIA_RE = /^\d{4}-\d{2}-\d{2}$/;
export const LIMITE_DO_HISTORICO = 30;

export function codificarCursor(r: { criadoEm: Date | string; id: string }): string {
  return `${new Date(r.criadoEm).toISOString()}_${r.id}`;
}

export function lerCursor(v: string | null | undefined): { criadoEm: Date; id: string } | null {
  const m = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)_([A-Za-z0-9_-]{1,64})$/.exec(String(v ?? ""));
  if (!m) return null;
  const d = new Date(m[1]);
  return Number.isNaN(d.getTime()) ? null : { criadoEm: d, id: m[2] };
}

/** Atalhos de período do histórico (os mesmos dos Relatórios). */
export const PERIODOS_DO_HISTORICO = [
  { chave: "", rotulo: "Tudo" },
  { chave: "hoje", rotulo: "Hoje" },
  { chave: "ontem", rotulo: "Ontem" },
  { chave: "7d", rotulo: "7 dias" },
  { chave: "30d", rotulo: "30 dias" },
  { chave: "mes", rotulo: "Este mês" },
  { chave: "mesAnterior", rotulo: "Mês anterior" },
] as const;

/**
 * `?periodo=7d` vira de/ate a partir do "hoje" da loja (dia de operação);
 * `?de`/`?ate` explícitos ganham do atalho.
 */
export function lerFiltrosDoHistorico(sp: URLSearchParams, hoje?: string): FiltrosDoHistorico {
  const tipos = (sp.get("tipo") || "")
    .split(",")
    .map((t) => t.trim().toUpperCase())
    .filter((t): t is TipoDoRegistro => (TIPOS_DO_REGISTRO as readonly string[]).includes(t));
  const canalBruto = (sp.get("canal") || "").toUpperCase();
  let de = DIA_RE.test(sp.get("de") || "") ? sp.get("de")! : null;
  let ate = DIA_RE.test(sp.get("ate") || "") ? sp.get("ate")! : null;
  const atalho = sp.get("periodo") || "";
  if (!de && !ate && hoje && PERIODOS_DO_HISTORICO.some((p) => p.chave && p.chave === atalho)) {
    ({ de, ate } = periodoDoAtalho(atalho as AtalhoDePeriodo, hoje));
  }
  if (de && ate && de > ate) [de, ate] = [ate, de];
  const limite = Math.min(100, Math.max(1, Number(sp.get("limite")) || LIMITE_DO_HISTORICO));
  return {
    tipos: [...new Set(tipos)],
    canal: canalBruto === "WHATSAPP" || canalBruto === "PAINEL" ? canalBruto : null,
    de, ate,
    busca: (sp.get("q") || "").trim().slice(0, 80),
    comDesfeitos: sp.get("desfeitos") !== "nao",
    cursor: lerCursor(sp.get("cursor")),
    limite,
  };
}

/**
 * A regra do desfazer é a do "desfaz" do WhatsApp (ferramentas.ts →
 * desfazerUltimo): só o lançamento MAIS NOVO da loja que ainda não foi
 * desfeito. Os anteriores dependem do que veio depois (a compra que entrou e
 * já foi usada, a conta paga em cima da conta lançada) e se corrigem na tela de
 * cada um.
 */
export function podeDesfazer(r: { id: string; desfeitoEm: Date | string | null }, ultimoDesfazivelId: string | null): boolean {
  return !r.desfeitoEm && r.id === ultimoDesfazivelId;
}
