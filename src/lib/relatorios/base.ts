/**
 * A base de TODO relatório do FireHub: os filtros, o tipo de venda, o período e
 * a régua do que é venda — num lugar só, puro, para a tela e o servidor lerem
 * igual.
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 *
 * Em 24/09/2026 o levantamento dos relatórios achou três telas com três réguas
 * diferentes para a mesma coisa: o relatório e o DRE excluíam só "CANCELADO"
 * (o pedido do totem antes de pagar e o rascunho do robô contavam como venda);
 * o dia era a meia-noite do NAVEGADOR, não o dia operacional da loja; e o
 * lucro tinha três fórmulas. O lojista que confere o relatório contra o caixa
 * acha diferença e para de confiar nos dois — a queixa mais dura contra a
 * Saipos no Reclame Aqui é exatamente essa ("um ano e meio sem fechamento
 * fiel").
 *
 * Os relatórios novos (/store/relatorios/*) leem os filtros daqui e buscam os
 * pedidos por lib/relatorios/servidor.ts — nunca montam a própria régua.
 *
 * Os filtros seguem os da Saipos, que é o que os lojistas conhecem: período com
 * atalhos, tipo de venda (Entrega/Retirada/Balcão/Mesa/Totem), canal, marca
 * (a loja do iFood/99 quando a conta tem mais de uma), categoria e produto. O
 * "Turno" deles vira FAIXA DE HORÁRIO aqui: o FireHub não tem turno nomeado, e
 * "das 18h às 2h" responde a mesma pergunta sem cadastro novo.
 */

import { STATUS_CANCELADOS } from "@/lib/status-pedido";
import { origemDaVenda, type PedidoParaOrigem } from "@/lib/origem-da-venda";
import { chaveDoCanal, type ChaveDeCanal } from "@/lib/canal-do-pedido";

// ── O QUE É VENDA ───────────────────────────────────────────────────────────

/**
 * Status que NÃO são venda: cancelado, o pedido do totem esperando pagamento e
 * o rascunho do robô. É a régua da cobrança e do relatório de mesas
 * (api/store/mesas/relatorio) — a mesma para todo relatório.
 */
export const STATUS_FORA_DA_VENDA: readonly string[] = ["AGUARDANDO_PAGAMENTO", "CRIANDO_IA", ...STATUS_CANCELADOS];

export function ehCancelado(status: string | null | undefined): boolean {
  return (STATUS_CANCELADOS as readonly string[]).includes(String(status || "").toUpperCase());
}

// ── TIPO DE VENDA ───────────────────────────────────────────────────────────

/** Os "tipos de venda" da Saipos (Entrega/Retirada/Salão/Ficha), no FireHub. */
export type TipoDeVenda = "DELIVERY" | "RETIRADA" | "BALCAO" | "MESA" | "TOTEM";

export const TIPOS_DE_VENDA: TipoDeVenda[] = ["DELIVERY", "RETIRADA", "BALCAO", "MESA", "TOTEM"];

export const ROTULO_DO_TIPO: Record<TipoDeVenda, string> = {
  DELIVERY: "Entrega",
  RETIRADA: "Retirada",
  BALCAO: "Balcão",
  MESA: "Mesa",
  TOTEM: "Totem",
};

/**
 * O tipo de venda do pedido. É `origemDaVenda` (mesa, entrega, balcão,
 * retirada) com o totem separado do balcão: o dono de totem quer saber quanto
 * a máquina vendeu, e na régua da origem ele é balcão.
 */
export function tipoDeVenda(pedido: PedidoParaOrigem & { totemLicenseId?: string | null }): TipoDeVenda {
  const origem = origemDaVenda(pedido);
  if (origem === "BALCAO" && (pedido.totemLicenseId || chaveDoCanal(pedido as any) === "TOTEM")) return "TOTEM";
  return origem;
}

/**
 * O canal do pedido para o relatório. É `chaveDoCanal` com a mesa separada:
 * o lançamento de mesa grava source PRESENCIAL e, sem o número da mesa no
 * pedido, sairia como "PDV" — a mesa sumia do filtro de canal.
 */
export function canalDoRelatorio(pedido: Record<string, unknown> & { tableSessionId?: string | null }): ChaveDeCanal {
  if (pedido.tableSessionId) return "MESA";
  return chaveDoCanal(pedido as any);
}

// ── OS FILTROS ──────────────────────────────────────────────────────────────

export type FiltrosDoRelatorio = {
  /** Primeiro e último dia, "YYYY-MM-DD", no DIA OPERACIONAL da loja (vira às 5h). */
  de: string;
  ate: string;
  /** Faixa de horário "HH:MM" (o "turno"). Vazio = o dia todo. Pode atravessar a meia-noite. */
  horaDe: string;
  horaAte: string;
  /** Vazio = todos. */
  tipos: TipoDeVenda[];
  /** Chaves de canal (lib/canal-do-pedido.ts). Vazio = todos. */
  canais: string[];
  /** Marcas: chave da loja de origem (`loja:…`, lib/origem-do-relatorio.ts). Vazio = todas. */
  marcas: string[];
  /** Lojas da conta (User.id) quando a conta tem mais de uma. Vazio = a loja ativa. */
  lojas: string[];
  /** Categorias e produtos (ids) — só nos relatórios de item. Vazio = todos. */
  categorias: string[];
  produtos: string[];
};

const LISTAS = ["tipos", "canais", "marcas", "lojas", "categorias", "produtos"] as const;

const DIA_RE = /^\d{4}-\d{2}-\d{2}$/;
const HORA_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Os filtros de uma URL. O que vier torto cai no padrão, nunca em erro. */
export function lerFiltros(sp: URLSearchParams, hoje: string): FiltrosDoRelatorio {
  const de = DIA_RE.test(sp.get("de") || "") ? String(sp.get("de")) : hoje;
  const ateBruto = DIA_RE.test(sp.get("ate") || "") ? String(sp.get("ate")) : de;
  const lista = (nome: string) => (sp.get(nome) || "").split(",").map((s) => s.trim()).filter(Boolean);
  return {
    de: de <= ateBruto ? de : ateBruto,
    ate: de <= ateBruto ? ateBruto : de,
    horaDe: HORA_RE.test(sp.get("horaDe") || "") ? String(sp.get("horaDe")) : "",
    horaAte: HORA_RE.test(sp.get("horaAte") || "") ? String(sp.get("horaAte")) : "",
    tipos: lista("tipos").filter((t): t is TipoDeVenda => (TIPOS_DE_VENDA as string[]).includes(t)),
    canais: lista("canais"),
    marcas: lista("marcas"),
    lojas: lista("lojas"),
    categorias: lista("categorias"),
    produtos: lista("produtos"),
  };
}

/** O inverso de `lerFiltros`: a query string (sem "?"), só com o que foi marcado. */
export function filtrosParaQuery(f: Partial<FiltrosDoRelatorio>, extra: Record<string, string | number | boolean | null | undefined> = {}): string {
  const sp = new URLSearchParams();
  if (f.de) sp.set("de", f.de);
  if (f.ate) sp.set("ate", f.ate);
  if (f.horaDe) sp.set("horaDe", f.horaDe);
  if (f.horaAte) sp.set("horaAte", f.horaAte);
  for (const nome of LISTAS) {
    const v = f[nome];
    if (v && v.length) sp.set(nome, v.join(","));
  }
  for (const [k, v] of Object.entries(extra)) {
    if (v === null || v === undefined || v === "" || v === false) continue;
    sp.set(k, v === true ? "1" : String(v));
  }
  return sp.toString();
}

// ── PERÍODO ─────────────────────────────────────────────────────────────────

export type AtalhoDePeriodo = "hoje" | "ontem" | "7d" | "15d" | "30d" | "mes" | "mesAnterior";

export const ATALHOS: { chave: AtalhoDePeriodo; rotulo: string }[] = [
  { chave: "hoje", rotulo: "Hoje" },
  { chave: "ontem", rotulo: "Ontem" },
  { chave: "7d", rotulo: "7 dias" },
  { chave: "15d", rotulo: "15 dias" },
  { chave: "30d", rotulo: "30 dias" },
  { chave: "mes", rotulo: "Este mês" },
  { chave: "mesAnterior", rotulo: "Mês anterior" },
];

/** Soma dias a "YYYY-MM-DD" sem passar por fuso (meio-dia UTC não vira dia). */
export function somarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Dias corridos entre dois "YYYY-MM-DD", contando os dois (01 a 01 = 1). */
export function diasNoPeriodo(de: string, ate: string): number {
  return Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86400000) + 1;
}

/** O período de um atalho, a partir de "hoje" (o dia operacional da loja). */
export function periodoDoAtalho(atalho: AtalhoDePeriodo, hoje: string): { de: string; ate: string } {
  switch (atalho) {
    case "hoje": return { de: hoje, ate: hoje };
    case "ontem": { const o = somarDias(hoje, -1); return { de: o, ate: o }; }
    case "7d": return { de: somarDias(hoje, -6), ate: hoje };
    case "15d": return { de: somarDias(hoje, -14), ate: hoje };
    case "30d": return { de: somarDias(hoje, -29), ate: hoje };
    case "mes": return { de: `${hoje.slice(0, 7)}-01`, ate: hoje };
    case "mesAnterior": {
      const primeiroDoMes = `${hoje.slice(0, 7)}-01`;
      const fimAnterior = somarDias(primeiroDoMes, -1);
      return { de: `${fimAnterior.slice(0, 7)}-01`, ate: fimAnterior };
    }
  }
}

/** O atalho que corresponde ao período, se algum — para acender o botão certo. */
export function atalhoDoPeriodo(de: string, ate: string, hoje: string): AtalhoDePeriodo | null {
  for (const a of ATALHOS) {
    const p = periodoDoAtalho(a.chave, hoje);
    if (p.de === de && p.ate === ate) return a.chave;
  }
  return null;
}

/**
 * O período anterior de MESMO tamanho, para "comparado com antes". A Saipos
 * compara toda métrica do dashboard assim; 7 dias contra os 7 anteriores.
 */
export function periodoAnterior(de: string, ate: string): { de: string; ate: string } {
  const n = diasNoPeriodo(de, ate);
  return { de: somarDias(de, -n), ate: somarDias(de, -1) };
}

// ── HORÁRIO NA LOJA ─────────────────────────────────────────────────────────

/** Hora da virada do dia operacional: o pedido da 1h da manhã é de ontem. */
export const HORA_DA_VIRADA = 5;

const formatadores = new Map<string, Intl.DateTimeFormat>();
function partesNaLoja(instante: Date, tz: string) {
  let f = formatadores.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short",
    });
    formatadores.set(tz, f);
  }
  const p: Record<string, string> = {};
  for (const parte of f.formatToParts(instante)) p[parte.type] = parte.value;
  return p;
}

const DIAS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Onde o instante cai no relógio da loja: o dia OPERACIONAL ("YYYY-MM-DD",
 * virando às 5h), o dia da semana desse dia (0 = domingo), a hora (0-23) e os
 * minutos desde a meia-noite — tudo no fuso da loja, nunca no do navegador.
 */
export function naLoja(instante: Date | string, tz: string | null | undefined): { dia: string; diaSemana: number; hora: number; minutos: number } {
  const d = typeof instante === "string" ? new Date(instante) : instante;
  const p = partesNaLoja(d, tz || "America/Sao_Paulo");
  const hora = Number(p.hour) % 24;
  const minutos = hora * 60 + Number(p.minute);
  let dia = `${p.year}-${p.month}-${p.day}`;
  let diaSemana = DIAS_EN.indexOf(p.weekday);
  if (hora < HORA_DA_VIRADA) {
    dia = somarDias(dia, -1);
    diaSemana = (diaSemana + 6) % 7;
  }
  return { dia, diaSemana, hora, minutos };
}

/** "Hoje" no dia operacional da loja. */
export function hojeNaLoja(tz: string | null | undefined, agora: Date = new Date()): string {
  return naLoja(agora, tz).dia;
}

/** O minuto do dia cai na faixa? A faixa pode atravessar a meia-noite (18:00–02:00). */
export function dentroDaFaixa(minutos: number, horaDe: string, horaAte: string): boolean {
  if (!horaDe && !horaAte) return true;
  const m = (h: string, padrao: number) => (h ? Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5)) : padrao);
  const ini = m(horaDe, 0);
  const fim = m(horaAte, 24 * 60);
  return ini <= fim ? minutos >= ini && minutos < fim : minutos >= ini || minutos < fim;
}

export const NOMES_DOS_DIAS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
export const DIAS_CURTOS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

// ── NÚMEROS ─────────────────────────────────────────────────────────────────

export const c2 = (n: number) => Math.round(n * 100) / 100;

export function fmtReais(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * Quantidade com vírgula e até 2 casas — "0,5", "12", "3,25". A Saipos mostra
 * fração com ponto ("0.25") no meio de valores com vírgula; aqui é tudo igual.
 */
export function fmtQtd(n: number): string {
  return (Math.round(n * 100) / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

export function fmtPct(n: number, casas = 1): string {
  if (!Number.isFinite(n)) return "—";
  return `${n.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`;
}

export function fmtDia(dia: string): string {
  return `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}`;
}

export type { ChaveDeCanal };
