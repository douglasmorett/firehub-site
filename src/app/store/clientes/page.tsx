"use client";
/**
 * Aba Clientes — a base de clientes da loja e o saldo de cashback de cada um.
 *
 * Pedido do Flavio (Showrrascão, 03/10/2026): os clientes tinham saldo na
 * carteira do Gama Delivery e, para virar a loja para o FireHub, ele precisava
 * achar o cliente e depositar o saldo. Daí: ver a base, ver o saldo, dar e
 * tirar saldo (um a um ou colando a lista), o extrato com quem lançou e por
 * quê, e o que a loja sabe do cliente (pedidos, gasto, endereços).
 *
 * A lista vem de /api/store/clientes (lib/clientes-da-loja.ts); o saldo é o
 * mesmo que o cardápio deixa usar (lib/cashback-no-banco.ts).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownCircle, ArrowUpCircle, ChevronLeft, ChevronRight, Contact, Download, FileUp,
  MessageCircle, Plus, Search, Wallet, X,
} from "lucide-react";

type Filtro = "todos" | "com_saldo" | "pediram" | "nunca" | "sumidos";
type Ordem = "recentes" | "pedidos" | "gasto" | "saldo" | "nome";

type ClienteDaLista = {
  telefone: string;
  nome: string | null;
  pedidos: number;
  gasto: number;
  ultimo: string | null;
  primeiro: string | null;
  importado: boolean;
  saldo: number;
};

type RegraDoCashback = { ativo: boolean; taxa: number; validadeDias: number; maxResgatePct: number };

type Lista = {
  clientes: ClienteDaLista[];
  total: number;
  porPagina: number;
  resumo: { clientes: number; pediram: number; ativos30: number; sumidos: number; novos30: number; comSaldo: number; saldoTotal: number };
  cashback: RegraDoCashback;
};

type Movimento = {
  em: string;
  tipo: "ganho" | "uso" | "credito_manual" | "debito_manual" | "vencido";
  valor: number;
  saldoDepois: number;
  pedidoNumero?: number | null;
  motivo?: string | null;
  criadoPor?: string | null;
};

type Detalhe = {
  encontrado: boolean;
  telefone: string;
  nome: string | null;
  aniversario: string | null;
  importado: boolean;
  clienteDesde: string | null;
  pedidos: { id: string; numero: number | null; em: string; status: string; total: number; tipo: string; canal: string; pagamento: string | null; cashbackGerado: number; cashbackUsado: number }[];
  enderecos: string[];
  numeros: { pedidos: number; gasto: number; ticketMedio: number; primeiro: string | null; ultimo: string | null; cancelados: number };
  cashback: RegraDoCashback & { saldo: number; proximoVencimento: { valor: number; em: string } | null; movimentos: Movimento[]; aReceber: number };
};

type LinhaDoLote = { linha: number; texto: string; telefone: string | null; valor: number | null; nome: string | null; erro: string | null };

// ── Aviso que desce do topo e some sozinho (no lugar do alert()) ──────────
// Mesma interface do components/AvisoNoTopo.tsx de outra frente (ver
// store/financeiro/DespesasLancadas.tsx): quando estiver no master, trocar pelo import.
type Aviso = { tipo: "ok" | "erro" | "atencao" | "info"; titulo: string; detalhe?: string };
const COR_DO_AVISO: Record<Aviso["tipo"], { cor: string; fundo: string }> = {
  ok: { cor: "#059669", fundo: "#ECFDF5" },
  erro: { cor: "#DC2626", fundo: "#FEF2F2" },
  atencao: { cor: "#D97706", fundo: "#FFFBEB" },
  info: { cor: "#2563EB", fundo: "#EFF6FF" },
};
function AvisoNoTopo({ aviso, onFechar }: { aviso: Aviso | null; onFechar: () => void }) {
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(onFechar, aviso.tipo === "erro" ? 12000 : 6000);
    return () => clearTimeout(t);
  }, [aviso, onFechar]);
  if (!aviso) return null;
  const { cor, fundo } = COR_DO_AVISO[aviso.tipo];
  return (
    <div
      role={aviso.tipo === "erro" ? "alert" : "status"}
      onClick={onFechar}
      style={{
        position: "fixed", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 1100,
        width: "min(440px, calc(100vw - 24px))", background: fundo, borderLeft: `4px solid ${cor}`,
        borderRadius: 12, padding: "12px 14px", boxShadow: "0 10px 30px rgba(15,23,42,.18)", cursor: "pointer",
      }}
    >
      <div style={{ fontWeight: 800, fontSize: 14, color: "#0F172A" }}>{aviso.titulo}</div>
      {aviso.detalhe && <div style={{ fontSize: 13, color: "#475569", marginTop: 2 }}>{aviso.detalhe}</div>}
    </div>
  );
}

// ── Formatos ─────────────────────────────────────────────────────────────────
const fmt = (v: number) => (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const FUSO = "America/Sao_Paulo";
const data = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: FUSO }) : "—");
const dataHora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { timeZone: FUSO, day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
function haQuanto(iso: string | null): string {
  if (!iso) return "nunca pediu";
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (dias <= 0) return "hoje";
  if (dias === 1) return "ontem";
  if (dias < 30) return `há ${dias} dias`;
  const meses = Math.floor(dias / 30);
  return meses === 1 ? "há 1 mês" : meses < 12 ? `há ${meses} meses` : `há ${Math.floor(meses / 12)} ano${meses >= 24 ? "s" : ""}`;
}
function telefoneBonito(t: string): string {
  const d = String(t || "").replace(/\D/g, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return t;
}
const linkDoWhatsApp = (t: string) => `https://wa.me/55${String(t).replace(/\D/g, "")}`;

const ROTULO_DO_FILTRO: Record<Filtro, string> = {
  todos: "Todos",
  com_saldo: "Com saldo",
  pediram: "Já pediram",
  nunca: "Nunca pediram",
  sumidos: "Sumidos (30+ dias)",
};
const ROTULO_DA_ORDEM: Record<Ordem, string> = {
  recentes: "Pedido mais recente",
  pedidos: "Mais pedidos",
  gasto: "Maior gasto",
  saldo: "Maior saldo",
  nome: "Nome (A–Z)",
};
const ROTULO_DO_MOVIMENTO: Record<Movimento["tipo"], string> = {
  ganho: "Cashback do pedido",
  uso: "Usado no pedido",
  credito_manual: "Saldo lançado pela loja",
  debito_manual: "Saldo tirado pela loja",
  vencido: "Venceu",
};
const STATUS: Record<string, string> = {
  NOVO: "Novo", PENDENTE: "Pendente", ACEITO: "Aceito", PREPARANDO: "Preparando", EM_PREPARO: "Em preparo",
  PRONTO: "Pronto", SAIU_PARA_ENTREGA: "Saiu para entrega", EM_ROTA: "Saiu para entrega", ENTREGUE: "Entregue",
  FINALIZADO: "Finalizado", CONCLUIDO: "Concluído", CANCELADO: "Cancelado", CANCELED: "Cancelado", RECUSADO: "Recusado",
};
const MOTIVOS_DE_DAR = ["Saldo do sistema antigo", "Cortesia", "Compensação de pedido", "Correção"];
const MOTIVOS_DE_TIRAR = ["Usado no balcão", "Correção", "Lançado errado"];

const corDoTexto = "#0F172A";
const corSuave = "#64748B";
const borda = "1.5px solid #E2E8F0";
const vermelho = "#EA1D2C";

const botao = (cor: string, fundo: string, extra: React.CSSProperties = {}): React.CSSProperties => ({
  padding: "9px 14px", borderRadius: 10, border: "none", background: fundo, color: cor, fontWeight: 700,
  fontSize: "0.84rem", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, ...extra,
});
const campo: React.CSSProperties = {
  width: "100%", padding: "9px 12px", borderRadius: 10, border: borda, fontSize: "0.88rem", outline: "none",
  fontFamily: "inherit", boxSizing: "border-box", background: "#fff", color: corDoTexto,
};

export default function ClientesPage() {
  const [lista, setLista] = useState<Lista | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState("");
  const [buscaFeita, setBuscaFeita] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [ordem, setOrdem] = useState<Ordem>("recentes");
  const [pagina, setPagina] = useState(1);
  const [aberto, setAberto] = useState<string | null>(null);
  const [novoAberto, setNovoAberto] = useState(false);
  const [loteAberto, setLoteAberto] = useState(false);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const fecharAviso = useCallback(() => setAviso(null), []);
  const pedidoAtual = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => { setBuscaFeita(busca.trim()); setPagina(1); }, 350);
    return () => clearTimeout(t);
  }, [busca]);

  const consulta = useMemo(() => {
    const p = new URLSearchParams({ filtro, ordem, pagina: String(pagina) });
    if (buscaFeita) p.set("q", buscaFeita);
    return p.toString();
  }, [buscaFeita, filtro, ordem, pagina]);

  const carregar = useCallback(async () => {
    const meu = ++pedidoAtual.current;
    setCarregando(true);
    try {
      const r = await fetch(`/api/store/clientes?${consulta}`, { cache: "no-store" });
      const j = await r.json();
      if (meu !== pedidoAtual.current) return;
      if (!r.ok) throw new Error(j.error || "Não foi possível carregar os clientes.");
      setLista(j);
    } catch (e: any) {
      if (meu === pedidoAtual.current) setAviso({ tipo: "erro", titulo: "Clientes não carregaram", detalhe: e?.message });
    } finally {
      if (meu === pedidoAtual.current) setCarregando(false);
    }
  }, [consulta]);

  useEffect(() => { carregar(); }, [carregar]);

  const paginas = lista ? Math.max(1, Math.ceil(lista.total / (lista.porPagina || 50))) : 1;
  const resumo = lista?.resumo;
  const regra = lista?.cashback;

  return (
    <div style={{ padding: 20, maxWidth: 1200, margin: "0 auto", fontFamily: "'Inter', sans-serif", color: corDoTexto }}>
      <style>{`
        .cl-tabela { width: 100%; border-collapse: collapse; }
        .cl-tabela th { text-align: left; font-size: .72rem; text-transform: uppercase; letter-spacing: .03em; color: ${corSuave}; font-weight: 700; padding: 10px 12px; border-bottom: 1.5px solid #E2E8F0; white-space: nowrap; }
        .cl-tabela td { padding: 11px 12px; border-bottom: 1px solid #F1F5F9; font-size: .86rem; vertical-align: middle; }
        .cl-tabela tbody tr { cursor: pointer; }
        .cl-tabela tbody tr:hover { background: #F8FAFC; }
        .cl-tabela .cl-num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .cl-cards { display: none; }
        @media (max-width: 760px) {
          .cl-tabela { display: none; }
          .cl-cards { display: grid; gap: 10px; }
        }
      `}</style>
      <AvisoNoTopo aviso={aviso} onFechar={fecharAviso} />

      {/* Cabeçalho */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: "1.6rem", fontWeight: 800, margin: 0, display: "flex", alignItems: "center", gap: 10 }}>
            <Contact size={28} color={vermelho} /> Clientes
          </h1>
          <p style={{ color: corSuave, fontSize: "0.88rem", margin: "4px 0 0", maxWidth: 620 }}>
            Quem já pediu na loja e quem veio de outro sistema, com o saldo de cashback de cada um. Clique no cliente para ver pedidos, extrato e dar ou tirar saldo.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={() => setNovoAberto(true)} style={botao("#fff", vermelho)}><Plus size={16} /> Lançar saldo</button>
          <button onClick={() => setLoteAberto(true)} style={botao(corDoTexto, "#F1F5F9")}><FileUp size={16} /> Importar saldos</button>
          <a href={`/api/store/clientes?formato=csv&${consulta}`} style={{ ...botao(corDoTexto, "#F1F5F9"), textDecoration: "none" }}>
            <Download size={16} /> Exportar
          </a>
        </div>
      </div>

      {regra && !regra.ativo && (
        <div style={{ background: "#FFFBEB", border: "1.5px solid #FDE68A", borderRadius: 12, padding: "12px 14px", marginBottom: 16, fontSize: "0.86rem", color: "#92400E" }}>
          <strong>O cashback está desligado na loja.</strong> O saldo lançado aqui fica guardado, mas o cliente só consegue usar no cardápio
          depois que você ligar em{" "}
          <a href="/store/minha-loja#fidelidade" style={{ color: "#92400E", fontWeight: 800 }}>Minha loja → Fidelidade &amp; trilha</a>.
        </div>
      )}

      {/* Resumo */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12, marginBottom: 16 }}>
        <Cartao titulo="Clientes" valor={resumo ? resumo.clientes.toLocaleString("pt-BR") : "…"} detalhe={resumo ? `${resumo.pediram.toLocaleString("pt-BR")} já pediram` : ""} />
        <Cartao titulo="Pediram em 30 dias" valor={resumo ? resumo.ativos30.toLocaleString("pt-BR") : "…"} detalhe={resumo ? `${resumo.novos30.toLocaleString("pt-BR")} pela primeira vez` : ""} />
        <Cartao
          titulo="Sumidos"
          valor={resumo ? resumo.sumidos.toLocaleString("pt-BR") : "…"}
          detalhe="sem pedir há mais de 30 dias"
          onClick={() => { setFiltro("sumidos"); setPagina(1); }}
        />
        <Cartao
          titulo="Saldo na carteira"
          valor={resumo ? fmt(resumo.saldoTotal) : "…"}
          detalhe={resumo ? `${resumo.comSaldo.toLocaleString("pt-BR")} ${resumo.comSaldo === 1 ? "cliente com saldo" : "clientes com saldo"}` : ""}
          destaque
          onClick={() => { setFiltro("com_saldo"); setOrdem("saldo"); setPagina(1); }}
        />
      </div>

      {/* Busca e filtros */}
      <div style={{ background: "#fff", border: borda, borderRadius: 14, padding: "12px 14px", marginBottom: 14, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ position: "relative", flex: "1 1 260px" }}>
          <Search size={16} style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "#94A3B8" }} />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome ou telefone…" style={{ ...campo, paddingLeft: 34 }} />
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {(Object.keys(ROTULO_DO_FILTRO) as Filtro[]).map((f) => (
            <button
              key={f}
              onClick={() => { setFiltro(f); setPagina(1); }}
              style={{
                padding: "7px 12px", borderRadius: 8, border: "none", fontSize: "0.78rem", fontWeight: 700, cursor: "pointer",
                background: filtro === f ? vermelho : "#F1F5F9", color: filtro === f ? "#fff" : corSuave,
              }}
            >
              {ROTULO_DO_FILTRO[f]}
            </button>
          ))}
        </div>
        <select value={ordem} onChange={(e) => { setOrdem(e.target.value as Ordem); setPagina(1); }} style={{ ...campo, width: "auto", padding: "7px 10px", fontSize: "0.8rem" }} aria-label="Ordenar">
          {(Object.keys(ROTULO_DA_ORDEM) as Ordem[]).map((o) => <option key={o} value={o}>{ROTULO_DA_ORDEM[o]}</option>)}
        </select>
      </div>

      {/* Lista */}
      <div style={{ background: "#fff", border: borda, borderRadius: 14, overflow: "hidden", opacity: carregando && lista ? 0.6 : 1, transition: "opacity .15s" }}>
        {!lista && carregando ? (
          <div style={{ padding: "3rem", textAlign: "center", color: corSuave }}>Carregando clientes…</div>
        ) : !lista || lista.clientes.length === 0 ? (
          <div style={{ padding: "3rem 1rem", textAlign: "center" }}>
            <Contact size={40} color="#CBD5E1" style={{ margin: "0 auto 10px" }} />
            <div style={{ fontWeight: 700, color: "#475569" }}>{buscaFeita || filtro !== "todos" ? "Nenhum cliente com esse filtro" : "Nenhum cliente ainda"}</div>
            <div style={{ fontSize: "0.82rem", color: "#94A3B8", marginTop: 4 }}>
              {buscaFeita || filtro !== "todos" ? "Tente outro nome, número ou filtro." : "Os clientes aparecem aqui a partir do primeiro pedido."}
            </div>
          </div>
        ) : (
          <>
            <table className="cl-tabela">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Telefone</th>
                  <th className="cl-num">Pedidos</th>
                  <th className="cl-num">Gasto</th>
                  <th>Último pedido</th>
                  <th className="cl-num">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {lista.clientes.map((c) => (
                  <tr key={c.telefone} onClick={() => setAberto(c.telefone)}>
                    <td>
                      <div style={{ fontWeight: 700 }}>{c.nome || <span style={{ color: "#94A3B8" }}>Sem nome</span>}</div>
                      {c.importado && c.pedidos === 0 && <span style={selo("#EFF6FF", "#1D4ED8")}>veio de outro sistema</span>}
                    </td>
                    <td style={{ whiteSpace: "nowrap", color: "#334155" }}>{telefoneBonito(c.telefone)}</td>
                    <td className="cl-num">{c.pedidos || "—"}</td>
                    <td className="cl-num">{c.pedidos ? fmt(c.gasto) : "—"}</td>
                    <td style={{ color: corSuave, whiteSpace: "nowrap" }}>{c.ultimo ? `${data(c.ultimo)} · ${haQuanto(c.ultimo)}` : "—"}</td>
                    <td className="cl-num" style={{ fontWeight: 800, color: c.saldo > 0 ? "#047857" : "#94A3B8" }}>{c.saldo > 0 ? fmt(c.saldo) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="cl-cards" style={{ padding: 10 }}>
              {lista.clientes.map((c) => (
                <button
                  key={c.telefone}
                  onClick={() => setAberto(c.telefone)}
                  style={{ textAlign: "left", background: "#fff", border: borda, borderRadius: 12, padding: 12, cursor: "pointer", fontFamily: "inherit" }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <div style={{ fontWeight: 800, color: corDoTexto }}>{c.nome || "Sem nome"}</div>
                    {c.saldo > 0 && <div style={{ fontWeight: 800, color: "#047857", whiteSpace: "nowrap" }}>{fmt(c.saldo)}</div>}
                  </div>
                  <div style={{ fontSize: "0.82rem", color: "#334155", marginTop: 2 }}>{telefoneBonito(c.telefone)}</div>
                  <div style={{ fontSize: "0.78rem", color: corSuave, marginTop: 4 }}>
                    {c.pedidos ? `${c.pedidos} ${c.pedidos === 1 ? "pedido" : "pedidos"} · ${fmt(c.gasto)} · último ${haQuanto(c.ultimo)}` : c.importado ? "Veio de outro sistema · nunca pediu aqui" : "Nunca pediu"}
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {lista && lista.total > 0 && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, fontSize: "0.82rem", color: corSuave, gap: 10, flexWrap: "wrap" }}>
          <span>
            {lista.total.toLocaleString("pt-BR")} {lista.total === 1 ? "cliente" : "clientes"}
            {paginas > 1 && ` · página ${pagina} de ${paginas}`}
          </span>
          {paginas > 1 && (
            <div style={{ display: "flex", gap: 6 }}>
              <button disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)} style={botao(corDoTexto, "#F1F5F9", { opacity: pagina <= 1 ? 0.4 : 1 })}>
                <ChevronLeft size={16} /> Anterior
              </button>
              <button disabled={pagina >= paginas} onClick={() => setPagina((p) => p + 1)} style={botao(corDoTexto, "#F1F5F9", { opacity: pagina >= paginas ? 0.4 : 1 })}>
                Próxima <ChevronRight size={16} />
              </button>
            </div>
          )}
        </div>
      )}

      {aberto && (
        <FichaDoCliente
          telefone={aberto}
          onFechar={() => setAberto(null)}
          onMudou={carregar}
          avisar={setAviso}
        />
      )}
      {novoAberto && (
        <LancarParaTelefone
          onFechar={() => setNovoAberto(false)}
          onLancou={(tel) => { setNovoAberto(false); carregar(); setAberto(tel); }}
          avisar={setAviso}
        />
      )}
      {loteAberto && (
        <ImportarSaldos
          regra={regra}
          onFechar={() => setLoteAberto(false)}
          onGravou={() => { setLoteAberto(false); setFiltro("com_saldo"); setOrdem("saldo"); setPagina(1); carregar(); }}
          avisar={setAviso}
        />
      )}
    </div>
  );
}

function selo(fundo: string, cor: string): React.CSSProperties {
  return { display: "inline-block", marginTop: 3, fontSize: "0.68rem", fontWeight: 700, background: fundo, color: cor, padding: "2px 7px", borderRadius: 6 };
}

function Cartao({ titulo, valor, detalhe, destaque, onClick }: { titulo: string; valor: string; detalhe?: string; destaque?: boolean; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: destaque ? "linear-gradient(135deg, #ECFDF5, #F0FDFA)" : "#fff",
        border: `1.5px solid ${destaque ? "#A7F3D0" : "#E2E8F0"}`, borderRadius: 14, padding: 14,
        cursor: onClick ? "pointer" : "default",
      }}
    >
      <div style={{ fontSize: "0.74rem", fontWeight: 700, color: destaque ? "#047857" : corSuave, textTransform: "uppercase", display: "flex", alignItems: "center", gap: 6 }}>
        {destaque && <Wallet size={14} />} {titulo}
      </div>
      <div style={{ fontSize: "1.5rem", fontWeight: 900, color: destaque ? "#047857" : corDoTexto, marginTop: 4 }}>{valor}</div>
      {detalhe && <div style={{ fontSize: "0.75rem", color: destaque ? "#047857" : corSuave, marginTop: 2 }}>{detalhe}</div>}
    </div>
  );
}

function Janela({ titulo, onFechar, children, largura = 560 }: { titulo: React.ReactNode; onFechar: () => void; children: React.ReactNode; largura?: number }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onFechar(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onFechar]);
  return (
    <div
      onClick={onFechar}
      style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", zIndex: 1000, display: "flex", justifyContent: "flex-end" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        style={{ width: `min(${largura}px, 100vw)`, height: "100%", background: "#F8FAFC", overflowY: "auto", boxShadow: "-10px 0 30px rgba(15,23,42,.18)" }}
      >
        <div style={{ position: "sticky", top: 0, zIndex: 2, background: "#fff", borderBottom: borda, padding: "14px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <div style={{ fontWeight: 800, fontSize: "1.05rem", minWidth: 0 }}>{titulo}</div>
          <button onClick={onFechar} aria-label="Fechar" style={{ ...botao(corSuave, "#F1F5F9"), padding: 8 }}><X size={18} /></button>
        </div>
        <div style={{ padding: 16 }}>{children}</div>
      </div>
    </div>
  );
}

// ── Dar / tirar saldo ────────────────────────────────────────────────────────

function FormularioDeSaldo({
  telefone, nome, operacao, saldo, regra, onFeito, onCancelar, avisar, focar = true,
}: {
  /** Falso quando o formulário aparece no meio de outro (o nome ainda está sendo digitado). */
  focar?: boolean;
  telefone: string;
  nome?: string | null;
  operacao: "dar" | "tirar";
  saldo: number;
  regra: RegraDoCashback;
  onFeito: (saldoNovo: number) => void;
  onCancelar: () => void;
  avisar: (a: Aviso) => void;
}) {
  const [valor, setValor] = useState("");
  const [motivo, setMotivo] = useState("");
  const [semVencimento, setSemVencimento] = useState(false);
  const [gravando, setGravando] = useState(false);
  const dar = operacao === "dar";
  const motivos = dar ? MOTIVOS_DE_DAR : MOTIVOS_DE_TIRAR;

  const gravar = async () => {
    setGravando(true);
    try {
      const r = await fetch("/api/store/clientes/cashback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telefone, nome, operacao, valor, motivo, semVencimento: dar && semVencimento }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Não foi possível gravar.");
      avisar({ tipo: "ok", titulo: dar ? "Saldo lançado" : "Saldo tirado", detalhe: `Saldo agora: ${fmt(j.saldo)}` });
      onFeito(j.saldo);
    } catch (e: any) {
      avisar({ tipo: "erro", titulo: "Não gravou", detalhe: e?.message });
    } finally {
      setGravando(false);
    }
  };

  return (
    <div style={{ background: "#fff", border: `1.5px solid ${dar ? "#A7F3D0" : "#FECACA"}`, borderRadius: 12, padding: 14, marginTop: 12 }}>
      <div style={{ fontWeight: 800, marginBottom: 10, color: dar ? "#047857" : "#B91C1C" }}>{dar ? "Dar saldo" : "Tirar saldo"}</div>
      <label style={{ fontSize: "0.78rem", fontWeight: 700, color: corSuave }}>Valor (R$)</label>
      <input
        autoFocus={focar}
        inputMode="decimal"
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        placeholder="0,00"
        style={{ ...campo, fontSize: "1.1rem", fontWeight: 800, marginTop: 4 }}
      />
      {!dar && (
        <div style={{ fontSize: "0.76rem", color: corSuave, marginTop: 4 }}>
          O cliente tem {fmt(saldo)}.{" "}
          {saldo > 0 && <button onClick={() => setValor(saldo.toFixed(2).replace(".", ","))} style={{ border: "none", background: "none", color: vermelho, fontWeight: 700, cursor: "pointer", padding: 0 }}>Tirar tudo</button>}
        </div>
      )}
      <label style={{ fontSize: "0.78rem", fontWeight: 700, color: corSuave, display: "block", marginTop: 10 }}>Motivo {dar ? "(opcional)" : ""}</label>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "4px 0 6px" }}>
        {motivos.map((m) => (
          <button
            key={m}
            onClick={() => setMotivo(m)}
            style={{ padding: "5px 10px", borderRadius: 8, border: "none", fontSize: "0.76rem", fontWeight: 700, cursor: "pointer", background: motivo === m ? corDoTexto : "#F1F5F9", color: motivo === m ? "#fff" : corSuave }}
          >
            {m}
          </button>
        ))}
      </div>
      <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder={dar ? "Ex.: saldo que tinha no sistema antigo" : "Ex.: usou R$ 10 no balcão"} style={campo} maxLength={200} />
      {dar && (
        <label style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 10, fontSize: "0.82rem", color: "#334155", cursor: "pointer" }}>
          <input type="checkbox" checked={semVencimento} onChange={(e) => setSemVencimento(e.target.checked)} style={{ marginTop: 3 }} />
          <span>
            Este saldo não vence
            <span style={{ display: "block", color: corSuave, fontSize: "0.76rem" }}>
              {regra.validadeDias > 0
                ? `Sem marcar, vence em ${regra.validadeDias} dias, como o cashback da loja.`
                : "O cashback da loja já não vence."}
            </span>
          </span>
        </label>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button onClick={gravar} disabled={gravando || !valor} style={botao("#fff", dar ? "#059669" : "#DC2626", { opacity: gravando || !valor ? 0.6 : 1 })}>
          {gravando ? "Gravando…" : dar ? "Dar saldo" : "Tirar saldo"}
        </button>
        <button onClick={onCancelar} style={botao(corSuave, "#F1F5F9")}>Cancelar</button>
      </div>
    </div>
  );
}

// ── Ficha do cliente ─────────────────────────────────────────────────────────

function FichaDoCliente({ telefone, onFechar, onMudou, avisar }: { telefone: string; onFechar: () => void; onMudou: () => void; avisar: (a: Aviso) => void }) {
  const [d, setD] = useState<Detalhe | null>(null);
  const [erro, setErro] = useState("");
  const [operacao, setOperacao] = useState<"dar" | "tirar" | null>(null);
  const [aba, setAba] = useState<"extrato" | "pedidos" | "enderecos">("extrato");

  const carregar = useCallback(async () => {
    try {
      const r = await fetch(`/api/store/clientes/detalhe?telefone=${encodeURIComponent(telefone)}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Não foi possível abrir o cliente.");
      setD(j);
    } catch (e: any) {
      setErro(e?.message || "Não foi possível abrir o cliente.");
    }
  }, [telefone]);
  useEffect(() => { carregar(); }, [carregar]);

  const cb = d?.cashback;
  return (
    <Janela
      onFechar={onFechar}
      titulo={
        <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {d?.nome || "Cliente"} <span style={{ color: corSuave, fontWeight: 600, fontSize: "0.88rem" }}>· {telefoneBonito(telefone)}</span>
        </span>
      }
    >
      {erro ? (
        <div style={{ color: "#B91C1C" }}>{erro}</div>
      ) : !d || !cb ? (
        <div style={{ color: corSuave }}>Carregando…</div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            <a href={linkDoWhatsApp(d.telefone)} target="_blank" rel="noreferrer" style={{ ...botao("#fff", "#16A34A"), textDecoration: "none" }}>
              <MessageCircle size={16} /> WhatsApp
            </a>
            {d.importado && <span style={{ ...selo("#EFF6FF", "#1D4ED8"), alignSelf: "center", marginTop: 0 }}>veio de outro sistema</span>}
            {d.aniversario && <span style={{ ...selo("#FDF2F8", "#BE185D"), alignSelf: "center", marginTop: 0 }}>🎂 {d.aniversario}</span>}
          </div>

          {/* Carteira */}
          <div style={{ background: "linear-gradient(135deg, #ECFDF5, #F0FDFA)", border: "1.5px solid #A7F3D0", borderRadius: 14, padding: 14 }}>
            <div style={{ fontSize: "0.74rem", fontWeight: 700, color: "#047857", textTransform: "uppercase" }}>Saldo de cashback</div>
            <div style={{ fontSize: "2rem", fontWeight: 900, color: "#047857" }}>{fmt(cb.saldo)}</div>
            <div style={{ fontSize: "0.78rem", color: "#065F46", display: "grid", gap: 2 }}>
              {cb.proximoVencimento && <span>{fmt(cb.proximoVencimento.valor)} vence em {data(cb.proximoVencimento.em)}</span>}
              {cb.aReceber > 0 && <span>+ {fmt(cb.aReceber)} a receber quando o pedido em andamento for entregue</span>}
              {cb.ativo ? (
                <span>Usa no pedido pelo site: até {cb.maxResgatePct}% dos produtos.</span>
              ) : (
                <span style={{ color: "#92400E" }}>O cashback está desligado: o cliente ainda não consegue usar este saldo.</span>
              )}
            </div>
            {!operacao && (
              <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                <button onClick={() => setOperacao("dar")} style={botao("#fff", "#059669")}><ArrowUpCircle size={16} /> Dar saldo</button>
                <button onClick={() => setOperacao("tirar")} disabled={cb.saldo <= 0} style={botao("#B91C1C", "#fff", { border: "1.5px solid #FECACA", opacity: cb.saldo <= 0 ? 0.5 : 1 })}>
                  <ArrowDownCircle size={16} /> Tirar saldo
                </button>
              </div>
            )}
          </div>
          {operacao && (
            <FormularioDeSaldo
              key={operacao}
              telefone={d.telefone}
              nome={d.nome}
              operacao={operacao}
              saldo={cb.saldo}
              regra={cb}
              avisar={avisar}
              onCancelar={() => setOperacao(null)}
              onFeito={() => { setOperacao(null); carregar(); onMudou(); }}
            />
          )}

          {/* Números */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8, marginTop: 12 }}>
            <Numero titulo="Pedidos" valor={String(d.numeros.pedidos)} detalhe={d.numeros.cancelados ? `${d.numeros.cancelados} cancelado(s)` : undefined} />
            <Numero titulo="Gasto" valor={fmt(d.numeros.gasto)} />
            <Numero titulo="Ticket médio" valor={d.numeros.pedidos ? fmt(d.numeros.ticketMedio) : "—"} />
            <Numero titulo="Último pedido" valor={d.numeros.ultimo ? haQuanto(d.numeros.ultimo) : "—"} detalhe={d.numeros.ultimo ? data(d.numeros.ultimo) : undefined} />
            <Numero titulo="Cliente desde" valor={d.clienteDesde ? data(d.clienteDesde) : "—"} />
          </div>

          {/* Abas */}
          <div style={{ display: "flex", gap: 6, marginTop: 16, borderBottom: borda }}>
            {([["extrato", `Extrato (${cb.movimentos.length})`], ["pedidos", `Pedidos (${d.pedidos.length})`], ["enderecos", `Endereços (${d.enderecos.length})`]] as const).map(([k, rot]) => (
              <button
                key={k}
                onClick={() => setAba(k)}
                style={{ padding: "8px 10px", border: "none", background: "none", fontWeight: 700, fontSize: "0.84rem", cursor: "pointer", color: aba === k ? vermelho : corSuave, borderBottom: `2.5px solid ${aba === k ? vermelho : "transparent"}`, marginBottom: -1.5 }}
              >
                {rot}
              </button>
            ))}
          </div>

          {aba === "extrato" && (
            <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
              {cb.movimentos.length === 0 && <Vazio texto="Nenhuma movimentação de cashback ainda." />}
              {cb.movimentos.map((m, i) => (
                <div key={i} style={{ background: "#fff", border: borda, borderRadius: 10, padding: "9px 12px", display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: "0.86rem" }}>
                      {ROTULO_DO_MOVIMENTO[m.tipo]}{m.pedidoNumero ? ` #${m.pedidoNumero}` : ""}
                    </div>
                    <div style={{ fontSize: "0.76rem", color: corSuave }}>
                      {dataHora(m.em)}{m.motivo ? ` · ${m.motivo}` : ""}{m.criadoPor ? ` · por ${m.criadoPor}` : ""}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <div style={{ fontWeight: 800, color: m.valor >= 0 ? "#047857" : "#B91C1C" }}>{m.valor >= 0 ? "+" : "−"} {fmt(Math.abs(m.valor))}</div>
                    <div style={{ fontSize: "0.72rem", color: corSuave }}>saldo {fmt(m.saldoDepois)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {aba === "pedidos" && (
            <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
              {d.pedidos.length === 0 && <Vazio texto="Este cliente ainda não pediu na loja." />}
              {d.pedidos.map((p) => {
                const cancelado = /CANCEL|RECUS|REJEIT/.test(p.status.toUpperCase());
                return (
                  <div key={p.id} style={{ background: "#fff", border: borda, borderRadius: 10, padding: "9px 12px", display: "flex", justifyContent: "space-between", gap: 10, opacity: cancelado ? 0.6 : 1 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: "0.86rem" }}>
                        {p.numero ? `#${p.numero} · ` : ""}{p.canal} · {STATUS[p.status.toUpperCase()] || p.status}
                      </div>
                      <div style={{ fontSize: "0.76rem", color: corSuave }}>
                        {dataHora(p.em)}{p.pagamento ? ` · ${p.pagamento}` : ""}
                        {p.cashbackUsado > 0 ? ` · usou ${fmt(p.cashbackUsado)} de cashback` : ""}
                        {p.cashbackGerado > 0 ? ` · gerou ${fmt(p.cashbackGerado)}` : ""}
                      </div>
                    </div>
                    <div style={{ fontWeight: 800, whiteSpace: "nowrap", textDecoration: cancelado ? "line-through" : "none" }}>{fmt(p.total)}</div>
                  </div>
                );
              })}
            </div>
          )}
          {aba === "enderecos" && (
            <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
              {d.enderecos.length === 0 && <Vazio texto="Nenhum endereço de entrega ainda." />}
              {d.enderecos.map((e) => (
                <div key={e} style={{ background: "#fff", border: borda, borderRadius: 10, padding: "9px 12px", fontSize: "0.86rem" }}>{e}</div>
              ))}
            </div>
          )}
        </>
      )}
    </Janela>
  );
}

function Numero({ titulo, valor, detalhe }: { titulo: string; valor: string; detalhe?: string }) {
  return (
    <div style={{ background: "#fff", border: borda, borderRadius: 10, padding: "9px 11px" }}>
      <div style={{ fontSize: "0.68rem", fontWeight: 700, color: corSuave, textTransform: "uppercase" }}>{titulo}</div>
      <div style={{ fontWeight: 800, fontSize: "0.98rem", marginTop: 2 }}>{valor}</div>
      {detalhe && <div style={{ fontSize: "0.7rem", color: corSuave }}>{detalhe}</div>}
    </div>
  );
}

function Vazio({ texto }: { texto: string }) {
  return <div style={{ padding: "1.5rem", textAlign: "center", color: "#94A3B8", fontSize: "0.84rem" }}>{texto}</div>;
}

// ── Lançar saldo para um telefone (o cliente pode ainda não estar na lista) ──

function LancarParaTelefone({ onFechar, onLancou, avisar }: { onFechar: () => void; onLancou: (telefone: string) => void; avisar: (a: Aviso) => void }) {
  const [telefone, setTelefone] = useState("");
  const [nome, setNome] = useState("");
  const [achado, setAchado] = useState<Detalhe | null>(null);
  const [procurando, setProcurando] = useState(false);
  const digitos = telefone.replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
  const completo = digitos.length === 10 || digitos.length === 11;

  useEffect(() => {
    setAchado(null);
    if (!completo) return;
    let vivo = true;
    setProcurando(true);
    fetch(`/api/store/clientes/detalhe?telefone=${digitos}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (vivo && j?.telefone) { setAchado(j); if (j.nome) setNome(j.nome); } })
      .catch(() => {})
      .finally(() => vivo && setProcurando(false));
    return () => { vivo = false; };
  }, [digitos, completo]);

  return (
    <Janela titulo="Lançar saldo" onFechar={onFechar} largura={480}>
      <label style={{ fontSize: "0.78rem", fontWeight: 700, color: corSuave }}>Telefone do cliente (com DDD)</label>
      <input autoFocus inputMode="tel" value={telefone} onChange={(e) => setTelefone(e.target.value)} placeholder="(22) 99999-1234" style={{ ...campo, marginTop: 4 }} />
      {completo && (
        <div style={{ fontSize: "0.8rem", marginTop: 6, color: corSuave }}>
          {procurando
            ? "Procurando…"
            : achado?.encontrado
              ? <>Cliente da loja{achado.nome ? `: ${achado.nome}` : ""} · saldo atual <strong style={{ color: "#047857" }}>{fmt(achado.cashback.saldo)}</strong></>
              : "Ainda não é cliente da loja — o saldo fica guardado para quando ele pedir com este número."}
        </div>
      )}
      <label style={{ fontSize: "0.78rem", fontWeight: 700, color: corSuave, display: "block", marginTop: 12 }}>Nome</label>
      <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome do cliente" style={{ ...campo, marginTop: 4 }} maxLength={120} />
      {completo && achado && (
        <FormularioDeSaldo
          focar={false}
          telefone={digitos}
          nome={nome}
          operacao="dar"
          saldo={achado.cashback.saldo}
          regra={achado.cashback}
          avisar={avisar}
          onCancelar={onFechar}
          onFeito={() => onLancou(digitos)}
        />
      )}
    </Janela>
  );
}

// ── Importar saldos (lista colada) ───────────────────────────────────────────

function ImportarSaldos({ regra, onFechar, onGravou, avisar }: { regra?: RegraDoCashback; onFechar: () => void; onGravou: () => void; avisar: (a: Aviso) => void }) {
  const [texto, setTexto] = useState("");
  const [motivo, setMotivo] = useState("Saldo do sistema antigo");
  const [semVencimento, setSemVencimento] = useState(false);
  const [conferido, setConferido] = useState<{ linhas: LinhaDoLote[]; validas: number; total: number } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const enviar = async (simular: boolean) => {
    setOcupado(true);
    try {
      const r = await fetch("/api/store/clientes/cashback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lote: texto, motivo, semVencimento, simular }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Não foi possível ler a lista.");
      if (simular) setConferido(j);
      else {
        avisar({ tipo: "ok", titulo: `${j.gravadas} ${j.gravadas === 1 ? "saldo lançado" : "saldos lançados"}`, detalhe: `Total de ${fmt(j.total)}${j.ignoradas ? ` · ${j.ignoradas} linha(s) com erro ficaram de fora` : ""}` });
        onGravou();
      }
    } catch (e: any) {
      avisar({ tipo: "erro", titulo: simular ? "Não deu para conferir" : "Não gravou", detalhe: e?.message });
    } finally {
      setOcupado(false);
    }
  };

  const comErro = conferido?.linhas.filter((l) => l.erro) ?? [];
  return (
    <Janela titulo="Importar saldos" onFechar={onFechar} largura={640}>
      <p style={{ margin: "0 0 10px", fontSize: "0.86rem", color: "#334155" }}>
        Cole a lista com <strong>telefone (com DDD)</strong> e <strong>valor</strong> em cada linha — o nome é opcional. Serve planilha copiada, CSV ou texto, como:
      </p>
      <pre style={{ background: "#fff", border: borda, borderRadius: 10, padding: "8px 10px", fontSize: "0.8rem", color: corSuave, margin: "0 0 10px", whiteSpace: "pre-wrap" }}>
{`(22) 99999-1234   R$ 25,50   João da Silva
22988887777;12,00;Maria
5522977776666, 8.90`}
      </pre>
      <textarea
        value={texto}
        onChange={(e) => { setTexto(e.target.value); setConferido(null); }}
        rows={9}
        placeholder="Cole aqui…"
        style={{ ...campo, fontFamily: "ui-monospace, Consolas, monospace", fontSize: "0.82rem", resize: "vertical" }}
      />
      <label style={{ fontSize: "0.78rem", fontWeight: 700, color: corSuave, display: "block", marginTop: 10 }}>Motivo (aparece no extrato de cada cliente)</label>
      <input value={motivo} onChange={(e) => setMotivo(e.target.value)} style={{ ...campo, marginTop: 4 }} maxLength={200} />
      <label style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 10, fontSize: "0.82rem", color: "#334155", cursor: "pointer" }}>
        <input type="checkbox" checked={semVencimento} onChange={(e) => setSemVencimento(e.target.checked)} style={{ marginTop: 3 }} />
        <span>
          Estes saldos não vencem
          <span style={{ display: "block", color: corSuave, fontSize: "0.76rem" }}>
            {regra && regra.validadeDias > 0 ? `Sem marcar, vencem em ${regra.validadeDias} dias a partir de hoje, como o cashback da loja.` : "O cashback da loja já não vence."}
          </span>
        </span>
      </label>

      {!conferido ? (
        <button onClick={() => enviar(true)} disabled={ocupado || !texto.trim()} style={botao("#fff", vermelho, { marginTop: 14, opacity: ocupado || !texto.trim() ? 0.6 : 1 })}>
          {ocupado ? "Conferindo…" : "Conferir a lista"}
        </button>
      ) : (
        <div style={{ marginTop: 14 }}>
          <div style={{ background: "#fff", border: borda, borderRadius: 12, padding: 12 }}>
            <div style={{ fontWeight: 800 }}>
              {conferido.validas} {conferido.validas === 1 ? "cliente" : "clientes"} · {fmt(conferido.total)}
              {comErro.length > 0 && <span style={{ color: "#B91C1C" }}> · {comErro.length} linha(s) com problema</span>}
            </div>
            <div style={{ maxHeight: 260, overflowY: "auto", marginTop: 8, display: "grid", gap: 4 }}>
              {conferido.linhas.map((l) => (
                <div key={l.linha} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: "0.8rem", padding: "4px 6px", borderRadius: 6, background: l.erro ? "#FEF2F2" : "#F8FAFC" }}>
                  <span style={{ color: l.erro ? "#B91C1C" : "#334155", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    <strong>L{l.linha}</strong> {l.erro ? `${l.texto} — ${l.erro}` : `${telefoneBonito(l.telefone || "")}${l.nome ? ` · ${l.nome}` : ""}`}
                  </span>
                  {!l.erro && <strong style={{ whiteSpace: "nowrap" }}>{fmt(l.valor || 0)}</strong>}
                </div>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <button onClick={() => enviar(false)} disabled={ocupado || conferido.validas === 0} style={botao("#fff", "#059669", { opacity: ocupado || conferido.validas === 0 ? 0.6 : 1 })}>
              {ocupado ? "Lançando…" : `Lançar ${conferido.validas} ${conferido.validas === 1 ? "saldo" : "saldos"} (${fmt(conferido.total)})`}
            </button>
            <button onClick={() => setConferido(null)} style={botao(corSuave, "#F1F5F9")}>Corrigir a lista</button>
          </div>
          <div style={{ fontSize: "0.76rem", color: corSuave, marginTop: 8 }}>
            Cada linha vira um crédito. Lançar a mesma lista duas vezes soma o saldo duas vezes — o extrato de cada cliente mostra o que já entrou.
          </div>
        </div>
      )}
    </Janela>
  );
}
