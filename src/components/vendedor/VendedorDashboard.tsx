"use client";
import { useMemo, useState } from "react";
import SairDaConta from "@/components/SairDaConta";
import type { AtividadeDaLoja } from "@/lib/atividade-da-loja";

export type ClienteDaCarteira = {
  id: string;
  storeName: string;
  name: string;
  email: string;
  storePhone: string | null;
  city: string | null;
  slug: string | null;
  createdAt: string;
  trialDaysRemaining: number;
  status: "TRIAL" | "ACTIVE" | "INACTIVE";
  monthSales: number;
  monthOrdersCount: number;
  platformFee: number;
  /** A comissão deste vendedor na loja neste mês (sellerPercent × mensalidade). */
  ambassadorProfit: number;
  atendimento: "AGUARDANDO" | "ATENDIDO";
  atribuidoEm: string | null;
  atendidoEm: string | null;
  atividade: AtividadeDaLoja | null;
  /** Loja que ele mesmo indicou: já ganha como embaixador, só acompanha — sem os 3%. */
  suaIndicacao: boolean;
};

type Filtro = "aguardando" | "atendidos" | "inativos" | "todos";

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const data = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—");

/** Link do WhatsApp: número brasileiro sem o 55 ganha o 55. */
function linkDoWhatsApp(telefone: string | null): string | null {
  const d = String(telefone || "").replace(/\D/g, "");
  if (d.length < 10) return null;
  return `https://wa.me/${d.length <= 11 ? `55${d}` : d}`;
}

function textoDoUltimoPedido(a: AtividadeDaLoja | null): string {
  if (!a || a.diasSemPedido === null) return "nunca vendeu";
  if (a.diasSemPedido === 0) return "hoje";
  if (a.diasSemPedido === 1) return "ontem";
  return `há ${a.diasSemPedido} dias`;
}

export default function VendedorDashboard({
  vendedor,
  clientes: iniciais,
}: {
  vendedor: { name: string; email: string; sellerPercent: number; ativo: boolean; temCarteiraAsaas: boolean };
  clientes: ClienteDaCarteira[];
}) {
  const [clientes, setClientes] = useState(iniciais);
  const [salvando, setSalvando] = useState<string | null>(null);
  const aguardando = clientes.filter((c) => c.atendimento === "AGUARDANDO");
  const [filtro, setFiltro] = useState<Filtro>(aguardando.length > 0 ? "aguardando" : "todos");

  const inativos = clientes.filter((c) => c.atividade?.situacao !== "ATIVA");
  const comissaoMes = clientes.reduce((s, c) => s + c.ambassadorProfit, 0);

  const visiveis = useMemo(() => {
    const lista = clientes.filter((c) =>
      filtro === "aguardando" ? c.atendimento === "AGUARDANDO"
        : filtro === "atendidos" ? c.atendimento === "ATENDIDO"
          : filtro === "inativos" ? c.atividade?.situacao !== "ATIVA"
            : true
    );
    // Quem espera contato primeiro, o mais recente no topo.
    return [...lista].sort((a, b) => {
      if (a.atendimento !== b.atendimento) return a.atendimento === "AGUARDANDO" ? -1 : 1;
      return String(b.atribuidoEm || "").localeCompare(String(a.atribuidoEm || ""));
    });
  }, [clientes, filtro]);

  const marcar = async (c: ClienteDaCarteira, status: "ATENDIDO" | "AGUARDANDO") => {
    setSalvando(c.id);
    try {
      const r = await fetch(`/api/vendedor/clientes/${c.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        alert(d.error || "Não foi possível salvar.");
        return;
      }
      setClientes((prev) =>
        prev.map((x) => (x.id === c.id ? { ...x, atendimento: status, atendidoEm: status === "ATENDIDO" ? new Date().toISOString() : null } : x))
      );
    } catch {
      alert("Sem conexão. Tente de novo.");
    } finally {
      setSalvando(null);
    }
  };

  const mes = new Date().toLocaleDateString("pt-BR", { month: "long", timeZone: "America/Sao_Paulo" });

  return (
    <div className="vd">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
        .vd { min-height: 100vh; background: #F6F7F9; font-family: 'Inter', sans-serif; color: #0F172A; }
        .vd * { box-sizing: border-box; }
        .vd-top { background: #0B0B0C; color: #fff; padding: 14px 20px; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
        .vd-wrap { max-width: 1040px; margin: 0 auto; padding: 22px 16px 60px; }
        .vd-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin-bottom: 20px; }
        .vd-kpi { background: #fff; border: 1px solid #E5E7EB; border-radius: 14px; padding: 16px 18px; }
        .vd-kpi b { display: block; font-size: 1.6rem; font-weight: 900; margin: 4px 0 2px; }
        .vd-kpi span { font-size: 0.72rem; color: #64748B; text-transform: uppercase; letter-spacing: .4px; font-weight: 700; }
        .vd-filtros { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
        .vd-filtro { border: 1px solid #E5E7EB; background: #fff; color: #334155; padding: 8px 14px; border-radius: 999px; font-weight: 700; font-size: 0.8rem; cursor: pointer; font-family: inherit; }
        .vd-filtro.on { background: #0B0B0C; color: #fff; border-color: #0B0B0C; }
        .vd-card { background: #fff; border: 1px solid #E5E7EB; border-radius: 14px; padding: 16px 18px; margin-bottom: 10px; display: grid; grid-template-columns: 1fr auto; gap: 14px; align-items: center; }
        .vd-card.novo { border-left: 4px solid #D97706; }
        .vd-pill { display: inline-flex; align-items: center; gap: 4px; padding: 3px 9px; border-radius: 999px; font-size: 0.7rem; font-weight: 800; }
        .vd-info { display: flex; flex-wrap: wrap; gap: 6px 16px; margin-top: 8px; font-size: 0.8rem; color: #475569; }
        .vd-info strong { color: #0F172A; }
        .vd-acoes { display: flex; flex-direction: column; gap: 8px; align-items: stretch; min-width: 170px; }
        .vd-btn { border: none; border-radius: 10px; padding: 10px 14px; font-weight: 800; font-size: 0.82rem; cursor: pointer; font-family: inherit; text-align: center; text-decoration: none; }
        @media (max-width: 640px) { .vd-card { grid-template-columns: 1fr; } .vd-acoes { flex-direction: row; min-width: 0; } .vd-acoes > * { flex: 1; } }
      `}</style>

      <header className="vd-top">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <img src="/firehub-flame.png" alt="" style={{ width: 30, height: 30, borderRadius: 7 }} />
          <div>
            <div style={{ fontWeight: 900 }}>Minha Carteira</div>
            <div style={{ fontSize: "0.72rem", color: "#A1A1AA" }}>{vendedor.name} · {vendedor.email}</div>
          </div>
        </div>
        <SairDaConta callbackUrl="/vendedor" style={{ background: "#27272A", color: "#fff", border: "none", borderRadius: 8, padding: "8px 12px", fontWeight: 700, fontSize: "0.8rem", cursor: "pointer" }}>
          Sair
        </SairDaConta>
      </header>

      <main className="vd-wrap">
        {!vendedor.ativo && (
          <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", color: "#991B1B", borderRadius: 12, padding: "12px 14px", marginBottom: 14, fontSize: "0.85rem", fontWeight: 600 }}>
            Sua conta de vendedor está pausada. Fale com o administrador.
          </div>
        )}
        {vendedor.ativo && !vendedor.temCarteiraAsaas && (
          <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", color: "#92400E", borderRadius: 12, padding: "12px 14px", marginBottom: 14, fontSize: "0.85rem", fontWeight: 600 }}>
            Sua carteira do Asaas ainda não está cadastrada — sem ela a comissão não cai na sua conta. Envie o ID da carteira ao administrador.
          </div>
        )}

        <div className="vd-kpis">
          <div className="vd-kpi" style={{ borderColor: "#FCA5A5" }}>
            <span>Comissão prevista · {mes}</span>
            <b style={{ color: "#C92E09" }}>{brl(comissaoMes)}</b>
            <div style={{ fontSize: "0.75rem", color: "#64748B" }}>
              {vendedor.sellerPercent}% da mensalidade dos clientes que a FireHub passou para você
            </div>
          </div>
          <div className="vd-kpi">
            <span>Aguardando contato</span>
            <b style={{ color: aguardando.length ? "#D97706" : "#0F172A" }}>{aguardando.length}</b>
          </div>
          <div className="vd-kpi">
            <span>Já atendidos</span>
            <b style={{ color: "#15803D" }}>{clientes.length - aguardando.length}</b>
          </div>
          <div className="vd-kpi">
            <span>Sem pedido há 7+ dias</span>
            <b>{inativos.length}</b>
          </div>
          <div className="vd-kpi">
            <span>Clientes na carteira</span>
            <b>{clientes.length}</b>
          </div>
        </div>

        <div className="vd-filtros">
          {([
            ["aguardando", `Aguardando contato (${aguardando.length})`],
            ["atendidos", `Atendidos (${clientes.length - aguardando.length})`],
            ["inativos", `Sem usar (${inativos.length})`],
            ["todos", `Todos (${clientes.length})`],
          ] as [Filtro, string][]).map(([k, rotulo]) => (
            <button key={k} className={`vd-filtro${filtro === k ? " on" : ""}`} onClick={() => setFiltro(k)}>{rotulo}</button>
          ))}
        </div>

        {visiveis.length === 0 && (
          <div style={{ background: "#fff", border: "1px dashed #CBD5E1", borderRadius: 14, padding: 32, textAlign: "center", color: "#64748B" }}>
            {clientes.length === 0
              ? "Nenhum cliente na sua carteira ainda. Quando o administrador direcionar uma loja para você, ela aparece aqui."
              : filtro === "aguardando" ? "Todo mundo já foi atendido. 👏" : "Nenhum cliente neste filtro."}
          </div>
        )}

        {visiveis.map((c) => {
          const whats = linkDoWhatsApp(c.storePhone);
          const situacao = c.atividade?.situacao;
          return (
            <div key={c.id} className={`vd-card${c.atendimento === "AGUARDANDO" ? " novo" : ""}`}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                  <strong style={{ fontSize: "1rem" }}>{c.storeName}</strong>
                  {c.atendimento === "AGUARDANDO" ? (
                    <span className="vd-pill" style={{ background: "#FEF3C7", color: "#92400E" }}>● Aguardando contato</span>
                  ) : (
                    <span className="vd-pill" style={{ background: "#DCFCE7", color: "#166534" }}>✓ Atendido {c.atendidoEm ? `em ${data(c.atendidoEm)}` : ""}</span>
                  )}
                  {c.status === "TRIAL" && <span className="vd-pill" style={{ background: "#EFF6FF", color: "#1D4ED8" }}>Teste · {c.trialDaysRemaining}d</span>}
                  {situacao === "ATIVA" && <span className="vd-pill" style={{ background: "#F0FDF4", color: "#15803D" }}>Usando</span>}
                  {situacao === "INATIVA" && <span className="vd-pill" style={{ background: "#FEF2F2", color: "#B91C1C" }}>Parou de vender</span>}
                  {situacao === "NUNCA_VENDEU" && <span className="vd-pill" style={{ background: "#F1F5F9", color: "#475569" }}>Ainda não vendeu</span>}
                  {c.suaIndicacao && <span className="vd-pill" style={{ background: "#F5F3FF", color: "#6D28D9" }}>Sua indicação</span>}
                </div>
                <div className="vd-info">
                  <span>{c.name || "—"}{c.city ? ` · ${c.city}` : ""}</span>
                  <span>📞 <strong>{c.storePhone || "sem telefone"}</strong></span>
                  <span>Na carteira desde <strong>{data(c.atribuidoEm)}</strong></span>
                  <span>Último pedido: <strong>{textoDoUltimoPedido(c.atividade)}</strong>{c.atividade ? ` · ${c.atividade.pedidos7d} em 7 dias` : ""}</span>
                  <span>Vendas no mês: <strong>{brl(c.monthSales)}</strong></span>
                  {c.suaIndicacao ? (
                    <span>Sua comissão: <strong>já recebe como embaixador</strong></span>
                  ) : (
                    <span>Sua comissão: <strong style={{ color: "#C92E09" }}>{brl(c.ambassadorProfit)}</strong></span>
                  )}
                </div>
              </div>
              <div className="vd-acoes">
                {whats ? (
                  <a className="vd-btn" href={whats} target="_blank" rel="noreferrer" style={{ background: "#16A34A", color: "#fff" }}>WhatsApp</a>
                ) : (
                  <a className="vd-btn" href={`mailto:${c.email}`} style={{ background: "#F1F5F9", color: "#0F172A" }}>E-mail</a>
                )}
                {c.atendimento === "AGUARDANDO" ? (
                  <button className="vd-btn" disabled={salvando === c.id} onClick={() => marcar(c, "ATENDIDO")} style={{ background: "#0B0B0C", color: "#fff" }}>
                    {salvando === c.id ? "Salvando..." : "✓ Já atendi"}
                  </button>
                ) : (
                  <button className="vd-btn" disabled={salvando === c.id} onClick={() => marcar(c, "AGUARDANDO")} style={{ background: "#fff", color: "#475569", border: "1px solid #E5E7EB" }}>
                    {salvando === c.id ? "Salvando..." : "Voltar para aguardando"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </main>
    </div>
  );
}
