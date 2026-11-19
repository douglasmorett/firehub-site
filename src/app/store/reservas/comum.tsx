"use client";

/**
 * O que as partes da tela de Reservas dividem: os tipos do que a API manda,
 * as cores, a formatação e os pedacinhos visuais (cartão, selo, botão).
 *
 * As cores saem dos tokens do painel (src/styles/fh-tokens.css e fh-painel.css):
 * fogo só na ação principal, estado em etiqueta tonal e nada de roxo
 * ("roxo ELIMINADO" na tabela de substituição dos tokens).
 */
import type { CSSProperties, ReactNode } from "react";
import { Bot, Mic, Monitor, type LucideIcon } from "lucide-react";
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

// ─── Cores (espelho dos tokens do painel) ─────────────────────────────────

/** A ação principal (o fogo que preenche, 5,41:1 com branco). */
export const COR = "#C92E09";
export const COR_CLARA = "#FFF4EF";
export const COR_BORDA = "#FFD3C2";
export const TINTA = "#0F172A";
export const TINTA_2 = "#334155";
export const TINTA_3 = "#64748B";
export const BORDA = "#E2E8F0";
export const BORDA_FORTE = "#CBD5E1";
export const CALHA = "#F8FAFC";
export const CARVAO = "#1C1917";

/** Origem: três cores distintas, sempre com rótulo e ícone junto. */
export const CORES_DA_ORIGEM: Record<OrigemDaReserva, string> = { ROBO: "#C92E09", PAINEL: "#334155", BILL: "#B45309" };
export const NOME_DA_ORIGEM: Record<OrigemDaReserva, string> = { ROBO: "Robô do WhatsApp", PAINEL: "Painel", BILL: "Bill" };
export const ICONE_DA_ORIGEM: Record<OrigemDaReserva, LucideIcon> = { ROBO: Bot, PAINEL: Monitor, BILL: Mic };

/** Status: a família tonal do painel. A palavra vai sempre junto da cor. */
export const STATUS: Record<StatusDaReserva, { nome: string; fundo: string; borda: string; tinta: string; forte: string }> = {
  CONFIRMADA: { nome: "Confirmada", fundo: "#FAF6F2", borda: "#E7DDD3", tinta: "#44403C", forte: CARVAO },
  CHEGOU: { nome: "Chegou", fundo: "#F0FDFA", borda: "#99F6E4", tinta: "#0F766E", forte: "#0F766E" },
  NAO_VEIO: { nome: "Não veio", fundo: "#FFF7E6", borda: "#FDE68A", tinta: "#B45309", forte: "#B45309" },
  CANCELADA: { nome: "Cancelada", fundo: "#F1F5F9", borda: "#E2E8F0", tinta: "#64748B", forte: "#64748B" },
};

/**
 * A cor da ocupação de um horário: status, sempre acompanhado do texto.
 * `semVaga`: a regra recusa reserva nova chegando nesse horário por lotação —
 * às vezes com o horário em si ainda vazio, porque a reserva nova encontraria
 * o salão cheio mais tarde (a duração dela cruza um horário lotado).
 * `barra` é o preenchimento (pode ser listrado); `cor`, a cor sólida da família.
 */
export function corDaOcupacao(pct: number, semVaga: boolean): { cor: string; fundo: string; borda: string; barra: string; rotulo: string } {
  if (semVaga && pct >= 1) return { cor: "#B71C1C", fundo: "#FEF2F2", borda: "#FECACA", barra: "#B71C1C", rotulo: "Lotado" };
  if (semVaga) return { cor: "#B71C1C", fundo: "#FEF2F2", borda: "#FECACA", barra: "repeating-linear-gradient(135deg,#B71C1C 0 3px,#F5B5B5 3px 7px)", rotulo: "Sem vaga (lota logo depois)" };
  if (pct >= 0.7) return { cor: "#B45309", fundo: "#FFF7E6", borda: "#FDE68A", barra: "#D97706", rotulo: "Enchendo" };
  if (pct > 0) return { cor: "#0F766E", fundo: "#F0FDFA", borda: "#99F6E4", barra: "#0F766E", rotulo: "Livre" };
  return { cor: "#94A3B8", fundo: CALHA, borda: BORDA, barra: BORDA_FORTE, rotulo: "Vazio" };
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

export const cartao: CSSProperties = { background: "#fff", border: `1px solid ${BORDA}`, borderRadius: 18, padding: "20px 22px", boxShadow: "0 1px 2px rgba(15,23,42,.06), 0 2px 6px -2px rgba(15,23,42,.06)", minWidth: 0 };
export const h2: CSSProperties = { margin: 0, font: "800 18px/1.25 Inter, system-ui, sans-serif", color: TINTA, letterSpacing: "-0.01em" };
export const texto: CSSProperties = { margin: 0, font: "500 14px/1.55 Inter, system-ui, sans-serif", color: TINTA_3 };
export const micro: CSSProperties = { font: "800 11px/1.2 Inter, system-ui, sans-serif", letterSpacing: ".08em", textTransform: "uppercase", color: "#475569" };

/** O botão do painel (.fh-btn). `pequeno` = 38 px, para as linhas de lista e o cabeçalho dos cartões. */
export function Botao({ children, onClick, tipo = "primario", disabled, style, title, pequeno }: {
  children: ReactNode; onClick?: () => void; tipo?: "primario" | "secundario" | "fantasma" | "perigo" | "verde"; disabled?: boolean; style?: CSSProperties; title?: string; pequeno?: boolean;
}) {
  const classe = { primario: "fh-btn--primario", secundario: "fh-btn--secundario", fantasma: "fh-btn--fantasma", perigo: "rsv-btn--perigo", verde: "rsv-btn--chegou" }[tipo];
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title} className={`fh-btn ${classe}${pequeno ? " rsv-btn--p" : ""}`} style={{ whiteSpace: "nowrap", ...style }}>
      {children}
    </button>
  );
}

export function SeloDaOrigem({ origem, curto }: { origem: OrigemDaReserva; curto?: boolean }) {
  const Icone = ICONE_DA_ORIGEM[origem];
  return (
    <span title={NOME_DA_ORIGEM[origem]} style={{ display: "inline-flex", alignItems: "center", gap: 5, font: "800 12px/1 Inter, system-ui, sans-serif", color: TINTA_3 }}>
      <Icone size={14} strokeWidth={2.2} color={CORES_DA_ORIGEM[origem]} aria-hidden />
      {curto ? (origem === "ROBO" ? "Robô" : NOME_DA_ORIGEM[origem]) : NOME_DA_ORIGEM[origem]}
    </span>
  );
}

export function SeloDoStatus({ status }: { status: StatusDaReserva }) {
  const s = STATUS[status];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 24, padding: "0 10px", borderRadius: 999, background: s.fundo, border: `1px solid ${s.borda}`, color: s.tinta, font: "800 12px/1 Inter, system-ui, sans-serif", whiteSpace: "nowrap" }}>
      <i aria-hidden style={{ width: 7, height: 7, borderRadius: 99, background: s.forte }} />{s.nome}
    </span>
  );
}

/** Um número do topo (KPI): rótulo, valor e a linha de apoio. */
export function Numero({ rotulo, valor, sub, destaque, icone: Icone, medidor }: {
  rotulo: string; valor: ReactNode; sub?: ReactNode; destaque?: boolean; icone?: LucideIcon; medidor?: { valor: number; cor?: string };
}) {
  return (
    <div className={`rsv-kpi${destaque ? " rsv-kpi--destaque" : ""}`}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {Icone && <span className="rsv-kpi__icone" aria-hidden><Icone size={16} strokeWidth={2.2} /></span>}
        <span className="rsv-kpi__rotulo">{rotulo}</span>
      </div>
      <div className="rsv-kpi__valor">{valor}</div>
      {medidor && (
        <div aria-hidden style={{ height: 6, borderRadius: 99, background: destaque ? "rgba(255,255,255,.18)" : "#EEF2F7", overflow: "hidden" }}>
          <i style={{ display: "block", height: "100%", width: `${Math.max(0, Math.min(1, medidor.valor)) * 100}%`, background: medidor.cor || "#0F766E", borderRadius: 99 }} />
        </div>
      )}
      {sub && <div className="rsv-kpi__sub">{sub}</div>}
    </div>
  );
}

/** O estado vazio desenhado (ícone em poço + título + texto + ação). */
export function Vazio({ icone: Icone, titulo, children, acao }: { icone: LucideIcon; titulo: string; children?: ReactNode; acao?: ReactNode }) {
  return (
    <div className="fh-vazio" style={{ padding: "40px 20px" }}>
      <span aria-hidden style={{ width: 56, height: 56, borderRadius: 18, display: "grid", placeItems: "center", background: CALHA, border: `1px dashed ${BORDA_FORTE}`, color: TINTA_3 }}>
        <Icone size={24} strokeWidth={2} />
      </span>
      <div className="fh-vazio__titulo">{titulo}</div>
      {children && <div className="fh-vazio__texto">{children}</div>}
      {acao}
    </div>
  );
}

/** Cabeçalho de cartão: título, apoio e as ações à direita. */
export function CabecaDoCartao({ titulo, sub, children }: { titulo: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
      <div style={{ minWidth: 0, flex: "1 1 260px" }}>
        <h2 style={h2}>{titulo}</h2>
        {sub && <p style={{ ...texto, fontSize: 13, marginTop: 3 }}>{sub}</p>}
      </div>
      {children && <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>{children}</div>}
    </div>
  );
}

export const CSS_DAS_RESERVAS = `
.rsv-tela{max-width:2400px;container:rsv/inline-size;background:transparent;gap:20px;padding:clamp(16px,2vw,32px) clamp(16px,2.2vw,36px) 64px}
.rsv-tela ::selection{background:#FFD3C2;color:#0F172A}
.rsv-tela input[type="date"],.rsv-tela input[type="time"],.rsv-tela input[type="number"],.rsv-tela select,.rsv-tela textarea,.rsv-tela input[type="text"],.rsv-tela input:not([type]){font-size:16px}
.rsv-btn--p{height:40px;padding:0 12px;font-size:14px;border-radius:10px}
@media (pointer:coarse){.rsv-btn--p{height:44px}}
.rsv-btn--chegou{background:#F0FDFA;color:#0F766E;border-color:#99F6E4}
.rsv-btn--chegou:not(:disabled):hover{background:#CCFBF1;border-color:#5EEAD4}
.rsv-btn--perigo{background:#fff;color:#B71C1C;border-color:#FECACA}
.rsv-btn--perigo:not(:disabled):hover{background:#FEF2F2;border-color:#FECACA}
.fh-tela .fh-btn:focus-visible{outline:3px solid #FF4D00;outline-offset:2px}

.rsv-cabecalho{display:flex;align-items:center;gap:18px;flex-wrap:wrap;background:#fff;border:1px solid #E2E8F0;border-radius:24px;padding:20px 24px;box-shadow:0 1px 2px rgba(15,23,42,.06),0 2px 6px -2px rgba(15,23,42,.06)}
.rsv-cabecalho__icone{width:52px;height:52px;flex:none;display:grid;place-items:center;border-radius:14px;background:#FFF4EF;border:1px solid #FFD3C2;color:#C92E09}
.rsv-cabecalho h1{font:900 28px/1.15 Inter,system-ui,sans-serif;letter-spacing:-.02em;color:#0F172A;margin:0}
.rsv-cabecalho__acoes{margin-left:auto;display:flex;gap:10px;align-items:center;flex-wrap:wrap}

.rsv-barra{display:flex;align-items:center;gap:12px;flex-wrap:wrap;justify-content:space-between}
.rsv-abas{display:flex;gap:4px;padding:5px;background:#E2E8F0;border-radius:16px;overflow-x:auto;scrollbar-width:none;max-width:100%}
.rsv-abas::-webkit-scrollbar{display:none}
.rsv-aba{height:44px;padding:0 16px;border:none;background:none;border-radius:12px;color:#475569;font:800 15px/1 Inter,system-ui,sans-serif;cursor:pointer;display:inline-flex;align-items:center;gap:8px;white-space:nowrap;transition:background-color .11s,color .11s,box-shadow .15s}
.rsv-aba:hover{color:#0F172A}
.rsv-aba[aria-selected="true"]{background:#fff;color:#C92E09;box-shadow:0 2px 4px -1px rgba(15,23,42,.07),0 8px 20px -6px rgba(15,23,42,.10)}
.rsv-aba:focus-visible{outline:3px solid #FF4D00;outline-offset:1px}
.rsv-data{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.rsv-data__nome{font:800 18px/1.2 Inter,system-ui,sans-serif;letter-spacing:-.01em;color:#0F172A;min-width:170px;text-align:center;font-variant-numeric:tabular-nums}
.rsv-data input[type="date"]{height:44px;padding:0 12px;border-radius:10px;border:1px solid #7C8DA5;font-family:inherit;color:#0F172A;background:#fff}

.rsv-kpis{display:grid;gap:12px;grid-template-columns:repeat(5,minmax(0,1fr))}
.rsv-kpi{background:#fff;border:1px solid #E2E8F0;border-radius:18px;padding:16px 18px;display:flex;flex-direction:column;gap:8px;min-width:0;box-shadow:0 1px 2px rgba(15,23,42,.06)}
.rsv-kpi__icone{width:28px;height:28px;border-radius:9px;display:grid;place-items:center;background:#F1F5F9;color:#334155;flex:none}
.rsv-kpi__rotulo{font:800 12px/1.2 Inter,system-ui,sans-serif;letter-spacing:.04em;text-transform:uppercase;color:#475569;min-width:0}
.rsv-kpi__valor{font:900 32px/1.02 Inter,system-ui,sans-serif;letter-spacing:-.025em;font-variant-numeric:tabular-nums;color:#0F172A}
.rsv-kpi__sub{font:500 13px/1.4 Inter,system-ui,sans-serif;color:#64748B}
.rsv-kpi--destaque{background:#1C1917;border-color:#1C1917;color:#fff}
.rsv-kpi--destaque .rsv-kpi__icone{background:rgba(255,255,255,.1);color:#FFB59E}
.rsv-kpi--destaque .rsv-kpi__rotulo{color:#D6D3D1}
.rsv-kpi--destaque .rsv-kpi__valor{color:#fff}
.rsv-kpi--destaque .rsv-kpi__sub{color:#D6D3D1}

.rsv-dia{display:grid;gap:20px;grid-template-columns:minmax(0,1fr) 360px;align-items:start}
.rsv-dia__lado{display:grid;gap:16px;position:sticky;top:12px}
.rsv-dia__principal{display:grid;gap:20px;min-width:0}
.rsv-duas{display:grid;gap:20px;grid-template-columns:minmax(0,1fr) 340px;align-items:start}
.rsv-duas>aside{display:grid;gap:16px;position:sticky;top:12px}

.rsv-cartoes{display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(min(100%,320px),1fr))}
/* A caixinha da reserva é CINZA sobre o cartão branco (Douglas, 19/11: "branco no branco some"):
   #EEF2F6 com borda #CBD5E1; os botões e o seletor de mesa, brancos, saltam em cima. */
.rsv-reserva{container:reserva/inline-size;display:flex;flex-direction:column;background:#EEF2F6;border:1px solid #CBD5E1;border-radius:16px;box-shadow:0 1px 2px rgba(15,23,42,.08);transition:box-shadow .15s,border-color .15s;scroll-margin:90px;min-width:0}
.rsv-reserva:hover{border-color:#94A3B8;box-shadow:0 2px 4px -1px rgba(15,23,42,.08),0 8px 20px -6px rgba(15,23,42,.14)}
.rsv-reserva--chegou{background:#E6FAF5;border-color:#7DDCCB}
.rsv-reserva--nao_veio{background:#FFF4DE;border-color:#F5D58A}
.rsv-reserva--cancelada{background:#F5F7FA;border-style:dashed;opacity:.85}
.rsv-reserva--foco{border-color:#E8360C;box-shadow:0 0 0 3px #FFD3C2}
.rsv-reserva__acoes{display:flex;gap:6px;align-items:center;padding:10px 12px;margin-top:auto;border-top:1px solid rgba(15,23,42,.10)}
.rsv-reserva__acoes>.fh-btn:not([title]){flex:1;min-width:0;padding:0 8px}
@container reserva (max-width:360px){.rsv-reserva__acoes{gap:5px;padding:10px}.rsv-reserva__acoes>.fh-btn:not([title]) svg{display:none}.rsv-reserva__acoes>.fh-btn{font-size:13.5px}}
.rsv-reserva__acoes>.fh-btn[title]{margin-left:auto}

.rsv-coluna{transition:background-color .11s}
.rsv-coluna:hover{background:#F8FAFC}
.rsv-coluna:hover .rsv-dica,.rsv-coluna:focus-visible .rsv-dica{opacity:1;transform:translate(-50%,-4px)}
.rsv-coluna:focus-visible{outline:3px solid #FF4D00;outline-offset:1px}
.rsv-dica{opacity:0;transition:opacity .12s,transform .12s;pointer-events:none}
.rsv-barra-v{transition:background-color .2s}
.rsv-celula{transition:transform .07s,box-shadow .15s,border-color .11s}
.rsv-celula:hover{box-shadow:0 2px 4px -1px rgba(15,23,42,.07),0 8px 20px -6px rgba(15,23,42,.12);border-color:#7C8DA5!important}
.rsv-celula:focus-visible{outline:3px solid #FF4D00;outline-offset:1px}
.rsv-linha-btn{transition:background-color .11s}
.rsv-linha-btn:hover{background:#F8FAFC}
.rsv-entra{animation:rsv-entra .24s cubic-bezier(0,0,.38,.9) both}
@keyframes rsv-entra{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
.rsv-folha{animation:rsv-folha .32s cubic-bezier(0,0,.38,.9) both}
@keyframes rsv-folha{from{opacity:0;transform:translateX(24px)}to{opacity:1;transform:none}}
.rsv-grade{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(min(100%,200px),1fr))}
.rsv-rolagem{overflow-x:auto;scrollbar-width:thin;scrollbar-color:#CBD5E1 transparent}

@container rsv (max-width:1500px){.rsv-kpis{grid-template-columns:repeat(5,minmax(0,1fr))}.rsv-kpi__valor{font-size:28px}}
@container rsv (max-width:1240px){.rsv-dia{grid-template-columns:minmax(0,1fr) 300px}.rsv-duas{grid-template-columns:minmax(0,1fr) 300px}.rsv-kpi{padding:14px}}
@container rsv (max-width:1040px){
  .rsv-dia{grid-template-columns:1fr}.rsv-dia__lado{display:contents}.rsv-proximas{order:-1}.rsv-situacao{order:5}
  .rsv-duas{grid-template-columns:1fr}.rsv-duas>aside{position:static}
  .rsv-kpis{grid-template-columns:repeat(3,minmax(0,1fr))}
}
@container rsv (max-width:640px){
  .rsv-kpis{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
  .rsv-kpi{padding:12px 14px;border-radius:16px}.rsv-kpi__valor{font-size:24px}.rsv-kpi__rotulo{font-size:11px}
  .rsv-cabecalho{padding:16px;gap:12px;border-radius:20px}.rsv-cabecalho h1{font-size:22px}.rsv-cabecalho__icone{display:none}
  .rsv-cabecalho__sub{display:none}
  .rsv-cabecalho__acoes{margin-left:0;width:100%}.rsv-cabecalho__acoes>.fh-btn{flex:1}
  .rsv-abas{width:100%}.rsv-aba{padding:0 12px;font-size:14px}
  .rsv-data{width:100%;justify-content:space-between}.rsv-data__nome{min-width:0;flex:1;font-size:16px}
  .rsv-data input[type="date"]{display:none}
  .rsv-tela{gap:16px}
}
@media (prefers-reduced-motion:reduce){.rsv-barra-v,.rsv-entra,.rsv-folha,.rsv-celula,.rsv-aba{animation-duration:.01ms;transition-duration:100ms}}
`;
