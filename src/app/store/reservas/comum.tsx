"use client";

/**
 * O que as partes da tela de Reservas dividem: os tipos do que a API manda,
 * as cores, a formatação e os pedacinhos visuais (cartão, selo, botão).
 */
import type { CSSProperties, ReactNode } from "react";
import type { ConfigDasReservas, HorarioDoDia, NumerosDasReservas, OrigemDaReserva, StatusDaReserva, Sugestao } from "@/lib/reservas/regras";

export type Estado = { ativo: boolean; cobradoEsteMes: boolean; testeAte: string | null; emTeste: boolean; jaTestou: boolean; isento: boolean; desligaEm: string | null; fimDoMes: string | null };

export type ReservaDaTela = {
  id: string; nome: string; telefone: string | null; data: string; hora: string; pessoas: number; observacao: string | null;
  origem: OrigemDaReserva; status: StatusDaReserva; mesaId: string | null; criadaPor: string | null; criadoEm: string;
  chegouEm: string | null; canceladaEm: string | null; consumo?: number | null;
};

export type Mesa = { id: string; nome: string; capacidade: number };

export type Dados = {
  estado: Estado;
  podeContratar: boolean;
  preco: number;
  diasDeTeste: number;
  mensalidade: { percentual: number; minimo: number; teto: number };
  // Só com o módulo ligado:
  hoje?: string;
  agoraMin?: number;
  data?: string;
  config?: ConfigDasReservas;
  configurado?: boolean;
  dia?: { reservas: ReservaDaTela[]; horarios: HorarioDoDia[] };
  semana?: { data: string; horarios: { hora: string; ocupadas: number; pessoas: number; livre: boolean; semVaga: boolean }[]; reservas: number; pessoas: number }[];
  calendario?: { data: string; aceita: boolean; reservas: number; pessoas: number; pico: number }[];
  valor?: { mes: string; numeros: NumerosDasReservas; anterior: { reservas: number; pessoas: number; comparecimento: number | null } };
  mesas?: Mesa[];
};

export type Aviso = { tipo: "ok" | "erro"; titulo: string; detalhe?: string; sugestoes?: Sugestao[]; aoEscolher?: (s: Sugestao) => void; encaixar?: () => void };

// ─── Cores ────────────────────────────────────────────────────────────────

export const COR = "#5B21B6";
export const COR_CLARA = "#EDE9FE";
export const TINTA = "#0F172A";
export const TINTA_2 = "#475569";
export const TINTA_3 = "#94A3B8";
export const BORDA = "#E2E8F0";

/** Origem: paleta categórica validada (dataviz, 19/11/2026) — sempre com rótulo junto. */
export const CORES_DA_ORIGEM: Record<OrigemDaReserva, string> = { ROBO: "#6D28D9", PAINEL: "#0891B2", BILL: "#D97706" };
export const NOME_DA_ORIGEM: Record<OrigemDaReserva, string> = { ROBO: "Robô do WhatsApp", PAINEL: "Painel", BILL: "Bill" };
export const ICONE_DA_ORIGEM: Record<OrigemDaReserva, string> = { ROBO: "🤖", PAINEL: "🖥️", BILL: "🎙️" };

export const STATUS: Record<StatusDaReserva, { nome: string; fundo: string; tinta: string; icone: string }> = {
  CONFIRMADA: { nome: "Confirmada", fundo: "#EDE9FE", tinta: "#5B21B6", icone: "📌" },
  CHEGOU: { nome: "Chegou", fundo: "#DCFCE7", tinta: "#166534", icone: "✅" },
  NAO_VEIO: { nome: "Não veio", fundo: "#FEF3C7", tinta: "#92400E", icone: "⌛" },
  CANCELADA: { nome: "Cancelada", fundo: "#F1F5F9", tinta: "#64748B", icone: "✖" },
};

/**
 * A cor da ocupação de um horário: status, sempre acompanhado do texto.
 * `semVaga`: a regra recusa reserva nova chegando nesse horário por lotação —
 * às vezes com o horário em si ainda vazio, porque a reserva nova encontraria
 * o salão cheio mais tarde (a duração dela cruza um horário lotado).
 */
export function corDaOcupacao(pct: number, semVaga: boolean): { cor: string; fundo: string; rotulo: string } {
  if (semVaga && pct >= 1) return { cor: "#DC2626", fundo: "#FEE2E2", rotulo: "Lotado" };
  if (semVaga) return { cor: "#F87171", fundo: "#FEF2F2", rotulo: "Sem vaga (lota logo depois)" };
  if (pct >= 0.7) return { cor: "#F59E0B", fundo: "#FEF3C7", rotulo: "Enchendo" };
  if (pct > 0) return { cor: "#16A34A", fundo: "#DCFCE7", rotulo: "Livre" };
  return { cor: "#CBD5E1", fundo: "#F8FAFC", rotulo: "Vazio" };
}

// ─── Formatação ───────────────────────────────────────────────────────────

export const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const reaisCurto = (v: number) => (v >= 10000 ? `R$ ${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil` : reais(v));
export const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);
export const diaMes = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
export const telefoneBonito = (t: string | null) => {
  const d = String(t || "").replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d;
};
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
export const nomeDoMes = (ym: string) => `${MESES[Number(ym.slice(5, 7)) - 1]} de ${ym.slice(0, 4)}`;

// ─── Peças ────────────────────────────────────────────────────────────────

export const cartao: CSSProperties = { background: "#fff", border: `1px solid ${BORDA}`, borderRadius: 18, padding: "18px 20px", boxShadow: "0 1px 2px rgba(15,23,42,.04)" };
export const h2: CSSProperties = { margin: 0, fontSize: 17, fontWeight: 800, color: TINTA, letterSpacing: "-0.01em" };
export const texto: CSSProperties = { margin: 0, fontSize: 14, color: TINTA_2, lineHeight: 1.6 };

export function Botao({ children, onClick, tipo = "primario", disabled, style, title }: {
  children: ReactNode; onClick?: () => void; tipo?: "primario" | "secundario" | "fantasma" | "perigo" | "verde"; disabled?: boolean; style?: CSSProperties; title?: string;
}) {
  const t = {
    primario: { background: COR, color: "#fff", border: "none" },
    verde: { background: "#16A34A", color: "#fff", border: "none" },
    secundario: { background: "#fff", color: TINTA, border: `1px solid ${BORDA}` },
    fantasma: { background: "transparent", color: TINTA_2, border: "1px solid transparent" },
    perigo: { background: "#fff", color: "#B91C1C", border: "1px solid #FECACA" },
  }[tipo];
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title} className="rsv-botao"
      style={{ ...t, padding: "9px 14px", borderRadius: 10, fontWeight: 800, fontSize: 13.5, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.55 : 1, fontFamily: "inherit", whiteSpace: "nowrap", ...style }}>
      {children}
    </button>
  );
}

export function SeloDaOrigem({ origem }: { origem: OrigemDaReserva }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 700, color: TINTA_2 }}>
      <i style={{ width: 8, height: 8, borderRadius: 2, background: CORES_DA_ORIGEM[origem] }} />
      {ICONE_DA_ORIGEM[origem]} {NOME_DA_ORIGEM[origem]}
    </span>
  );
}

export function SeloDoStatus({ status }: { status: StatusDaReserva }) {
  const s = STATUS[status];
  return <span style={{ fontSize: 11.5, fontWeight: 800, padding: "3px 9px", borderRadius: 999, background: s.fundo, color: s.tinta, whiteSpace: "nowrap" }}>{s.icone} {s.nome}</span>;
}

/** Um número grande com rótulo (os cartões de valor). */
export function Numero({ rotulo, valor, sub, destaque, icone }: { rotulo: string; valor: ReactNode; sub?: ReactNode; destaque?: boolean; icone?: string }) {
  return (
    <div style={{ ...cartao, padding: "14px 16px", background: destaque ? `linear-gradient(135deg, ${COR}, #7C3AED)` : "#fff", border: destaque ? "none" : cartao.border, color: destaque ? "#fff" : TINTA, minWidth: 0 }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: destaque ? "rgba(255,255,255,.85)" : TINTA_2, display: "flex", gap: 6, alignItems: "center" }}>{icone && <span aria-hidden>{icone}</span>}{rotulo}</div>
      <div style={{ fontSize: 26, fontWeight: 900, marginTop: 4, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>{valor}</div>
      {sub && <div style={{ fontSize: 12, marginTop: 2, color: destaque ? "rgba(255,255,255,.85)" : TINTA_3, fontWeight: 600 }}>{sub}</div>}
    </div>
  );
}

export const CSS_DAS_RESERVAS = `
.rsv-botao{transition:transform .12s ease, box-shadow .12s ease, filter .12s ease}
.rsv-botao:not(:disabled):hover{filter:brightness(1.05);box-shadow:0 4px 12px rgba(15,23,42,.10)}
.rsv-botao:not(:disabled):active{transform:scale(.97)}
.rsv-barra{transition:height .35s cubic-bezier(.2,.8,.2,1), background .2s}
.rsv-coluna:hover .rsv-dica{opacity:1;transform:translate(-50%,-4px)}
.rsv-dica{opacity:0;transition:opacity .12s, transform .12s;pointer-events:none}
.rsv-celula{transition:transform .12s ease, box-shadow .12s ease}
.rsv-celula:hover{transform:translateY(-1px);box-shadow:0 6px 14px rgba(15,23,42,.10)}
.rsv-entra{animation:rsv-entra .35s cubic-bezier(.2,.8,.2,1) both}
@keyframes rsv-entra{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.rsv-grade{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(180px,1fr))}
.rsv-abas{display:flex;gap:4px;overflow-x:auto;scrollbar-width:none}
.rsv-abas::-webkit-scrollbar{display:none}
@media (prefers-reduced-motion:reduce){.rsv-barra,.rsv-entra,.rsv-celula,.rsv-botao{transition:none;animation:none}}
`;
