"use client";
import SairDaConta from "@/components/SairDaConta";
import React, { useState } from "react";
import { signIn } from "next-auth/react";
import ToggleFranqueadoHakim from "@/components/ToggleFranqueadoHakim";
import AmbassadorsTab from "./AmbassadorsTab";
import InscricoesEmbaixadorTab from "./InscricoesEmbaixadorTab";
import AdminCostsTab from "./AdminCostsTab";
import VendedoresTab from "./VendedoresTab";

const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtDate = (d: string) => new Date(d).toLocaleDateString("pt-BR");

type Atividade = {
  ultimoPedidoEm: string | null;
  diasSemPedido: number | null;
  pedidos7d: number;
  situacao: "ATIVA" | "INATIVA" | "NUNCA_VENDEU";
};

type Lojista = {
  id: string; name: string | null; email: string; slug: string | null;
  storeName: string | null; city: string | null; createdAt: string;
  storeOpen: boolean; isFranqueadoHakim: boolean; storeLogo: string | null;
  storePhone: string | null; cpfCnpj: string | null; repasseConfig: any; onboardingData?: any;
  diasCadastro: number; emTrial: boolean;
  diasRestantesTrial?: number; trialEndsAt?: string | null;
  pendente: number; temMP: boolean; temCelcoin: boolean;
  vendedorId: string | null; vendedorStatus: string | null; vendedorAtribuidoEm: string | null;
  /** Quem INDICOU a loja (comissão de embaixador). Vínculo à parte do vendedor. */
  ambassadorId: string | null;
  atividade: Atividade | null;
};

type Vendedor = { id: string; name: string; active: boolean };
type Embaixador = { id: string; name: string; code: string; active: boolean };

type StatusFilter = "todos" | "trial" | "assinantes" | "pendencia" | "mes" | "inativos" | "nunca";
type Tab = "overview" | "lojistas" | "financeiro" | "vendedores" | "ambassadors" | "inscricoes" | "custos";

type KPIs = {
  totalLojistas: number; emTrial: number; assinantes: number;
  novosMes: number; novosSemana: number;
  mrr: number; totalArrecadado: number; totalPendente: number; comPendencia: number;
};

const TITULOS: Record<Tab, string> = {
  overview: "Visão Geral",
  lojistas: "Lojistas",
  financeiro: "Faturamento",
  vendedores: "Vendedores",
  ambassadors: "Embaixadores",
  inscricoes: "Inscrições para embaixador",
  custos: "Custos & P&L",
};

/** "hoje", "ontem", "há 12 dias", "nunca vendeu". */
function textoDoUltimoPedido(a: Atividade | null): string {
  if (!a || a.diasSemPedido === null) return "nunca vendeu";
  if (a.diasSemPedido === 0) return "hoje";
  if (a.diasSemPedido === 1) return "ontem";
  return `há ${a.diasSemPedido} dias`;
}

export default function AdminDashboardClient({
  adminName, kpis, monthlyGrowth, lojistas: initialLojistas, vendedores, embaixadores,
}: {
  adminName: string;
  kpis: KPIs;
  monthlyGrowth: { label: string; count: number }[];
  lojistas: Lojista[];
  vendedores: Vendedor[];
  embaixadores: Embaixador[];
}) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("todos");
  const [vendedorFilter, setVendedorFilter] = useState<string>("todos");
  const [tab, setTab] = useState<Tab>("overview");
  const [lojistas, setLojistas] = useState<Lojista[]>(initialLojistas);
  const [atribuindo, setAtribuindo] = useState<string | null>(null);

  // Modal de concessão de dias
  const [grantModalUser, setGrantModalUser] = useState<Lojista | null>(null);
  const [customDays, setCustomDays] = useState<string>("15");
  const [granting, setGranting] = useState(false);

  // Modal de redefinir senha (volta para a senha padrão de suporte)
  const [resetModalUser, setResetModalUser] = useState<Lojista | null>(null);
  const [resetPalavra, setResetPalavra] = useState("");
  const [resetting, setResetting] = useState(false);
  const [resetFeito, setResetFeito] = useState<string | null>(null);
  const resetConfirmado = resetPalavra.trim().toLowerCase() === "redefinir";

  // Impersonação
  const [impersonatingId, setImpersonatingId] = useState<string | null>(null);

  // Expandir detalhes do lojista
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const onlyDigits = (v: string) => v.replace(/\D/g, "");
  const startOfMonthTs = (() => {
    const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d.getTime();
  })();

  const term = search.trim().toLowerCase();
  const termDigits = onlyDigits(term);

  const matchesSearch = (l: Lojista) => {
    if (!term) return true;
    if ([l.name, l.storeName, l.email, l.city, l.slug].some(v => v?.toLowerCase().includes(term))) return true;
    if (termDigits.length >= 3 && [l.storePhone, l.cpfCnpj].some(v => v && onlyDigits(v).includes(termDigits))) return true;
    return false;
  };

  const matchesStatus = (l: Lojista) => {
    switch (statusFilter) {
      case "trial": return l.emTrial;
      case "assinantes": return !l.emTrial;
      case "pendencia": return !l.isFranqueadoHakim && l.pendente > 0;
      case "mes": return new Date(l.createdAt).getTime() >= startOfMonthTs;
      case "inativos": return l.atividade?.situacao === "INATIVA";
      case "nunca": return !l.atividade || l.atividade.situacao === "NUNCA_VENDEU";
      default: return true;
    }
  };

  const matchesVendedor = (l: Lojista) =>
    vendedorFilter === "todos" ? true : vendedorFilter === "sem" ? !l.vendedorId : l.vendedorId === vendedorFilter;

  const filtered = lojistas.filter(l => matchesSearch(l) && matchesStatus(l) && matchesVendedor(l));

  const usando = lojistas.filter(l => l.atividade?.situacao === "ATIVA").length;
  const inativas = lojistas.filter(l => l.atividade?.situacao === "INATIVA").length;
  const nuncaVenderam = lojistas.filter(l => !l.atividade || l.atividade.situacao === "NUNCA_VENDEU").length;
  const semVendedor = lojistas.filter(l => !l.vendedorId).length;

  const maxGrowth = Math.max(...monthlyGrowth.map(m => m.count), 1);

  const irParaLojistas = (filtro: StatusFilter = "todos", vendedor = "todos") => {
    setSearch(""); setStatusFilter(filtro); setVendedorFilter(vendedor); setTab("lojistas");
  };

  const handleImpersonate = async (l: Lojista) => {
    const storeLabel = l.storeName || l.name || l.email;
    if (!confirm(`Deseja acessar o sistema como "${storeLabel}" para prestar suporte?`)) return;
    setImpersonatingId(l.id);
    try {
      await signIn("credentials", {
        impersonateId: l.id,
        callbackUrl: "/store",
      });
    } catch (e) {
      alert("Erro ao impersonar conta. Tente novamente.");
      setImpersonatingId(null);
    }
  };

  /**
   * Põe a loja na carteira de um vendedor (ou tira). Atribuição nova nasce
   * "Aguardando contato" — é o que a faz aparecer no topo do painel dele.
   */
  const atribuirVendedor = async (l: Lojista, vendedorId: string) => {
    const novo = vendedorId || null;
    if (novo === l.vendedorId) return;
    setAtribuindo(l.id);
    try {
      const res = await fetch(`/api/admin/lojistas/${l.id}/vendedor`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendedorId: novo }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { alert(data.error || "Não foi possível atribuir o vendedor."); return; }
      setLojistas(prev => prev.map(x => x.id === l.id
        ? { ...x, vendedorId: novo, vendedorStatus: novo ? "AGUARDANDO" : null, vendedorAtribuidoEm: novo ? new Date().toISOString() : null }
        : x));
    } catch {
      alert("Erro de conexão ao atribuir o vendedor.");
    } finally {
      setAtribuindo(null);
    }
  };

  /** Define quem INDICOU a loja (comissão de embaixador), ou tira. */
  const atribuirEmbaixador = async (l: Lojista, ambassadorId: string) => {
    const novo = ambassadorId || null;
    if (novo === l.ambassadorId) return;
    setAtribuindo(l.id);
    try {
      const res = await fetch(`/api/admin/lojistas/${l.id}/embaixador`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ambassadorId: novo }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { alert(data.error || "Não foi possível atribuir o embaixador."); return; }
      setLojistas(prev => prev.map(x => x.id === l.id ? { ...x, ambassadorId: novo } : x));
    } catch {
      alert("Erro de conexão ao atribuir o embaixador.");
    } finally {
      setAtribuindo(null);
    }
  };

  const abrirReset = (l: Lojista) => {
    setResetPalavra("");
    setResetFeito(null);
    setResetModalUser(l);
  };

  const fecharReset = () => {
    if (resetting) return;
    setResetModalUser(null);
    setResetPalavra("");
    setResetFeito(null);
  };

  const handleResetPassword = async () => {
    if (!resetModalUser || !resetConfirmado) return;
    setResetting(true);
    try {
      const res = await fetch("/api/admin/users/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: resetModalUser.id, confirmacao: resetPalavra }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) setResetFeito(data.senha || "123456");
      else alert(data.error || "Não foi possível redefinir a senha.");
    } catch {
      alert("Erro de conexão ao redefinir a senha.");
    } finally {
      setResetting(false);
    }
  };

  const handleGrantDays = async (daysToGrant: number) => {
    if (!grantModalUser) return;
    setGranting(true);
    try {
      const res = await fetch("/api/admin/grant-days", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: grantModalUser.id, days: daysToGrant }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        alert(data.message);
        // Atualiza estado local do lojista
        setLojistas(prev => prev.map(item => {
          if (item.id === grantModalUser.id) {
            const currentRestantes = item.diasRestantesTrial || 0;
            return {
              ...item,
              emTrial: true,
              diasRestantesTrial: currentRestantes + daysToGrant,
              trialEndsAt: data.trialEndsAt,
            };
          }
          return item;
        }));
        setGrantModalUser(null);
      } else {
        alert(data.error || "Erro ao conceder dias.");
      }
    } catch (err) {
      alert("Erro de conexão ao salvar dias.");
    } finally {
      setGranting(false);
    }
  };

  // ── Peças da linha do lojista (as duas tabelas usam as mesmas) ──────────

  const Situacao = ({ l }: { l: Lojista }) =>
    l.isFranqueadoHakim ? <span className="fha-badge fha-badge-exempt">Isento (Hakim)</span>
      : l.pendente > 0 ? <span className="fha-badge fha-badge-pending">Débito {fmt(l.pendente)}</span>
        : l.emTrial ? <span className="fha-badge fha-badge-trial">Teste · {l.diasRestantesTrial ?? 0}d</span>
          : <span className="fha-badge fha-badge-active">Assinante</span>;

  const Uso = ({ l }: { l: Lojista }) => {
    const a = l.atividade;
    const cls = !a || a.situacao === "NUNCA_VENDEU" ? "fha-uso-nunca" : a.situacao === "INATIVA" ? "fha-uso-parada" : "fha-uso-ativa";
    return (
      <div title={a?.ultimoPedidoEm ? `Último pedido em ${new Date(a.ultimoPedidoEm).toLocaleString("pt-BR")}` : "Nenhum pedido registrado"}>
        <span className={`fha-uso ${cls}`}>
          <i />{!a || a.situacao === "NUNCA_VENDEU" ? "Nunca vendeu" : a.situacao === "INATIVA" ? "Parada" : "Usando"}
        </span>
        <div className="fha-sub" style={{ whiteSpace: "nowrap" }}>
          {a && a.situacao !== "NUNCA_VENDEU" ? `Último: ${textoDoUltimoPedido(a)} · ${a.pedidos7d} em 7d` : "sem pedidos"}
        </div>
      </div>
    );
  };

  const SeletorDeVendedor = ({ l }: { l: Lojista }) => {
    const atual = vendedores.find(v => v.id === l.vendedorId);
    return (
      <div>
        <select
          className={`fha-select${l.vendedorId ? "" : " vazio"}`}
          value={l.vendedorId || ""}
          disabled={atribuindo === l.id}
          onChange={e => atribuirVendedor(l, e.target.value)}
        >
          <option value="">+ Atribuir vendedor</option>
          {vendedores.filter(v => v.active || v.id === l.vendedorId).map(v => (
            <option key={v.id} value={v.id}>{v.name}{v.active ? "" : " (pausado)"}</option>
          ))}
        </select>
        {atual && (
          <div className="fha-sub" style={{ color: l.vendedorStatus === "ATENDIDO" ? "#15803D" : "#B45309", fontWeight: 700 }}>
            {atribuindo === l.id ? "Salvando..." : l.vendedorStatus === "ATENDIDO" ? "✓ Atendido" : "● Aguardando contato"}
          </div>
        )}
      </div>
    );
  };

  const SeletorDeEmbaixador = ({ l }: { l: Lojista }) => {
    const atual = embaixadores.find(e => e.id === l.ambassadorId);
    return (
      <div style={{ marginTop: 4 }}>
        <select
          className={`fha-select${l.ambassadorId ? "" : " vazio"}`}
          value={l.ambassadorId || ""}
          disabled={atribuindo === l.id}
          onChange={e => atribuirEmbaixador(l, e.target.value)}
          title="Quem indicou a loja: leva a comissão de embaixador"
        >
          <option value="">+ Atribuir embaixador</option>
          {embaixadores.filter(e => e.active || e.id === l.ambassadorId).map(e => (
            <option key={e.id} value={e.id}>🤝 {e.name}{e.active ? "" : " (pausado)"}</option>
          ))}
        </select>
        {atual && <div className="fha-sub" style={{ color: "#64748B" }}>indicou · {atual.code}</div>}
      </div>
    );
  };

  const Telefone = ({ l }: { l: Lojista }) => l.storePhone
    ? <a href={`https://wa.me/${l.storePhone.replace(/\D/g, "")}`} target="_blank" className="fha-link">{l.storePhone}</a>
    : <span className="fha-muted">—</span>;

  const Dados = ({ l, colSpan }: { l: Lojista; colSpan: number }) => (
    <tr>
      <td colSpan={colSpan} style={{ padding: 0 }}>
        <div className="fha-dados">
          {([
            ["Nome completo", l.name || "—"],
            ["E-mail", l.email],
            ["WhatsApp", l.storePhone || "Não informado"],
            ["CPF/CNPJ", l.cpfCnpj || "Não informado"],
            ["Cidade", l.city || "—"],
            ["Slug (cardápio)", l.slug ? <a href={`/loja/${l.slug}`} target="_blank" className="fha-link">{l.slug}</a> : "—"],
            ["Teste encerra", l.trialEndsAt ? fmtDate(l.trialEndsAt) : "—"],
            ["Último pedido", l.atividade?.ultimoPedidoEm ? new Date(l.atividade.ultimoPedidoEm).toLocaleString("pt-BR") : "Nunca"],
            ["Repasse Pix", l.repasseConfig ? (typeof l.repasseConfig === "object" ? `${(l.repasseConfig as any).tipoChave || "—"}: ${(l.repasseConfig as any).chavePix || "—"}` : "Configurado") : "Não configurado"],
            ["Pagamento online", `Mercado Pago ${l.temMP ? "✓" : "✗"} · Pix ${l.temCelcoin ? "✓" : "✗"}`],
            ["Como conheceu", l.onboardingData?.comoConheceu || "—"],
            ["Faturamento declarado", l.onboardingData?.faturamento || "—"],
            ["Franqueado Hakim (isento)", <ToggleFranqueadoHakim key="hakim" userId={l.id} initialValue={l.isFranqueadoHakim} />],
          ] as [string, React.ReactNode][]).map(([rotulo, valor]) => (
            <div key={rotulo}>
              <div className="fha-dados-lbl">{rotulo}</div>
              <div className="fha-dados-val">{valor}</div>
            </div>
          ))}
        </div>
      </td>
    </tr>
  );

  const Acoes = ({ l }: { l: Lojista; curto?: boolean }) => (
    <div style={{ display: "grid", gridTemplateColumns: "auto auto", gap: 6, justifyContent: "start" }}>
      <button onClick={() => handleImpersonate(l)} disabled={impersonatingId === l.id} className="fha-btn" style={{ color: "#0F172A", fontWeight: 800 }} title="Acessar conta para dar suporte">
        {impersonatingId === l.id ? "Entrando..." : "Acessar"}
      </button>
      <button onClick={() => setGrantModalUser(l)} className="fha-btn" title="Liberar dias de benefício">+Dias</button>
      <button onClick={() => abrirReset(l)} className="fha-btn" title="Voltar a senha da conta para 123456">Senha</button>
      <button onClick={() => setExpandedId(expandedId === l.id ? null : l.id)} className={`fha-btn${expandedId === l.id ? " on" : ""}`} title="Ver dados completos do cadastro">
        Dados
      </button>
    </div>
  );

  const NomeDaLoja = ({ l, comLogo }: { l: Lojista; comLogo?: boolean }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      {comLogo && (l.storeLogo
        ? <img src={l.storeLogo} alt="" style={{ width: 32, height: 32, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />
        : <div style={{ width: 32, height: 32, borderRadius: 8, background: "#F1F5F9", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.85rem", flexShrink: 0 }}>🏪</div>)}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 700, color: "#0F172A" }}>{l.storeName || l.name}</div>
        <div className="fha-sub">{l.email}</div>
      </div>
    </div>
  );

  const navItens: { key: Tab; icone: string; rotulo: string }[] = [
    { key: "overview", icone: "📊", rotulo: "Visão Geral" },
    { key: "lojistas", icone: "🏪", rotulo: "Lojistas" },
    { key: "financeiro", icone: "💵", rotulo: "Faturamento" },
    { key: "vendedores", icone: "💼", rotulo: "Vendedores" },
    { key: "ambassadors", icone: "🤝", rotulo: "Embaixadores" },
    { key: "inscricoes", icone: "⭐", rotulo: "Inscrições" },
    { key: "custos", icone: "💰", rotulo: "Custos & P&L" },
  ];

  return (
    <div className="fha">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
        .fha { min-height: 100vh; display: flex; font-family: 'Inter', sans-serif; background: #F6F7F9; color: #0F172A; }
        .fha * { box-sizing: border-box; }
        .fha-sidebar { width: 236px; background: #0B0B0C; display: flex; flex-direction: column; position: fixed; top: 0; left: 0; height: 100vh; z-index: 100; }
        .fha-main { margin-left: 236px; flex: 1; min-width: 0; min-height: 100vh; }
        .fha-topbar { background: #FFFFFF; border-bottom: 1px solid #E5E7EB; padding: 16px 28px; display: flex; align-items: center; justify-content: space-between; position: sticky; top: 0; z-index: 50; }
        .fha-nav-grupo { font-size: 0.62rem; color: #52525B; text-transform: uppercase; letter-spacing: 1px; padding: 14px 12px 6px; font-weight: 800; }
        .fha-nav-item { display: flex; align-items: center; gap: 10px; width: 100%; padding: 9px 12px; border-radius: 8px; cursor: pointer; font-size: 0.86rem; font-weight: 600; color: #A1A1AA; text-decoration: none; margin: 1px 0; border: none; background: none; font-family: inherit; text-align: left; position: relative; }
        .fha-nav-item:hover { background: #18181B; color: #FFFFFF; }
        .fha-nav-item.active { background: #1C1C1F; color: #FFFFFF; }
        .fha-nav-item.active::before { content: ""; position: absolute; left: -10px; top: 8px; bottom: 8px; width: 3px; border-radius: 3px; background: #E8360C; }
        .fha-kpi { background: #FFFFFF; border: 1px solid #E5E7EB; border-radius: 14px; padding: 18px 20px; }
        .fha-kpi.clicavel { cursor: pointer; transition: border-color .15s, box-shadow .15s; }
        .fha-kpi.clicavel:hover { border-color: #CBD5E1; box-shadow: 0 2px 10px rgba(15,23,42,.06); }
        .fha-kpi-val { font-size: 1.75rem; font-weight: 900; color: #0F172A; margin: 2px 0; letter-spacing: -0.5px; }
        .fha-kpi-lbl { font-size: 0.72rem; color: #64748B; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700; }
        .fha-kpi-sub { font-size: 0.78rem; color: #64748B; margin-top: 2px; }
        .fha-section { background: #FFFFFF; border: 1px solid #E5E7EB; border-radius: 14px; overflow: hidden; }
        .fha-section-head { padding: 14px 18px; border-bottom: 1px solid #EEF0F3; display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
        .fha-section-head h3 { color: #0F172A; font-weight: 800; margin: 0; font-size: 0.95rem; }
        .fha-table { width: 100%; border-collapse: collapse; font-size: 0.83rem; }
        .fha-table th { padding: 10px 11px; text-align: left; color: #64748B; font-weight: 700; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #EEF0F3; background: #F8FAFC; white-space: nowrap; }
        .fha-table td { padding: 11px 11px; border-bottom: 1px solid #F1F3F5; color: #334155; vertical-align: middle; }
        .fha-table tr:hover td { background: #FAFBFC; }
        .fha-sub { color: #94A3B8; font-size: 0.72rem; margin-top: 2px; }
        .fha-muted { color: #94A3B8; }
        .fha-link { color: #0F766E; text-decoration: none; font-weight: 600; white-space: nowrap; }
        .fha-link:hover { text-decoration: underline; }
        .fha-badge { display: inline-flex; align-items: center; gap: 4px; padding: 3px 9px; border-radius: 999px; font-size: 0.7rem; font-weight: 800; white-space: nowrap; }
        .fha-badge-trial { background: #FEF3C7; color: #92400E; }
        .fha-badge-active { background: #DCFCE7; color: #166534; }
        .fha-badge-pending { background: #FEE2E2; color: #B91C1C; }
        .fha-badge-exempt { background: #F1F5F9; color: #475569; }
        .fha-uso { display: inline-flex; align-items: center; gap: 6px; font-weight: 800; font-size: 0.78rem; white-space: nowrap; }
        .fha-uso i { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
        .fha-uso-ativa { color: #15803D; } .fha-uso-ativa i { background: #22C55E; }
        .fha-uso-parada { color: #B91C1C; } .fha-uso-parada i { background: #EF4444; }
        .fha-uso-nunca { color: #64748B; } .fha-uso-nunca i { background: #CBD5E1; }
        .fha-input { background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 10px; padding: 10px 14px; color: #0F172A; font-size: 0.875rem; font-family: inherit; outline: none; }
        .fha-input:focus { border-color: #E8360C; box-shadow: 0 0 0 3px rgba(232,54,12,.12); }
        .fha-input::placeholder { color: #94A3B8; }
        .fha-select { background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 8px; padding: 6px 8px; color: #0F172A; font-size: 0.78rem; font-weight: 600; font-family: inherit; max-width: 165px; cursor: pointer; }
        .fha-select.vazio { color: #94A3B8; border-style: dashed; }
        .fha-chip { padding: 6px 12px; border-radius: 999px; font-size: 0.74rem; font-weight: 700; cursor: pointer; font-family: inherit; background: #FFFFFF; color: #475569; border: 1px solid #E2E8F0; }
        .fha-chip.on { background: #0B0B0C; color: #FFFFFF; border-color: #0B0B0C; }
        .fha-chip.alerta.on { background: #B91C1C; border-color: #B91C1C; }
        .fha-btn { background: #FFFFFF; color: #334155; border: 1px solid #E2E8F0; padding: 5px 10px; border-radius: 7px; font-size: 0.74rem; font-weight: 700; cursor: pointer; text-decoration: none; font-family: inherit; white-space: nowrap; display: inline-flex; align-items: center; }
        .fha-btn:hover { background: #F8FAFC; border-color: #CBD5E1; }
        .fha-btn.on { background: #F1F5F9; border-color: #94A3B8; }
        .fha-btn-dark { background: #0B0B0C; color: #FFFFFF; border-color: #0B0B0C; }
        .fha-btn-dark:hover { background: #27272A; border-color: #27272A; }
        .fha-btn-primary { background: #E8360C; color: #FFFFFF; border-color: #E8360C; }
        .fha-btn-primary:hover { background: #C92E09; border-color: #C92E09; }
        .fha-bar { background: #E8360C; border-radius: 4px 4px 0 0; transition: height 0.5s ease; min-height: 3px; }
        .fha-dados { background: #F8FAFC; padding: 16px 20px; border-bottom: 1px solid #E5E7EB; display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 12px; }
        .fha-dados-lbl { color: #64748B; font-size: 0.68rem; font-weight: 700; text-transform: uppercase; margin-bottom: 2px; }
        .fha-dados-val { color: #0F172A; font-size: 0.83rem; font-weight: 600; word-break: break-word; }
        .fha-modal-fundo { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.45); backdrop-filter: blur(3px); display: flex; align-items: center; justify-content: center; z-index: 999; padding: 16px; }
        .fha-modal { background: #FFFFFF; border: 1px solid #E5E7EB; border-radius: 16px; width: 100%; max-width: 440px; padding: 24px; box-shadow: 0 20px 40px rgba(15, 23, 42, 0.18); }
        .fha-modal h3 { color: #0F172A; margin: 0; font-size: 1.08rem; font-weight: 800; }
        @media (max-width: 860px) {
          .fha-sidebar { position: static; width: 100%; height: auto; }
          .fha { flex-direction: column; }
          .fha-main { margin-left: 0; }
          .fha-sidebar nav { display: flex; flex-wrap: wrap; gap: 4px; }
          .fha-sidebar nav .fha-nav-item { width: auto; }
          .fha-nav-grupo, .fha-sidebar-rodape { display: none; }
        }
      `}</style>

      {/* ── SIDEBAR ── */}
      <aside className="fha-sidebar">
        <div style={{ padding: "20px 18px 14px", display: "flex", alignItems: "center", gap: 10 }}>
          <img src="/firehub-flame.png" alt="" style={{ width: 32, height: 32, borderRadius: 8 }} />
          <div>
            <div style={{ color: "#FFFFFF", fontWeight: 900, fontSize: "1rem", letterSpacing: "-0.3px" }}>FireHub</div>
            <div style={{ color: "#71717A", fontSize: "0.64rem", textTransform: "uppercase", letterSpacing: "0.8px", fontWeight: 700 }}>Admin</div>
          </div>
        </div>

        <nav style={{ padding: "0 10px", flex: 1 }}>
          <p className="fha-nav-grupo">Gestão</p>
          {navItens.map(n => (
            <button key={n.key} onClick={() => setTab(n.key)} className={`fha-nav-item${tab === n.key ? " active" : ""}`}>
              <span style={{ width: 18, textAlign: "center" }}>{n.icone}</span> {n.rotulo}
            </button>
          ))}

          <p className="fha-nav-grupo">Atalhos</p>
          <a href="/store/admin/lojistas" className="fha-nav-item"><span style={{ width: 18, textAlign: "center" }}>🔧</span> Painel completo</a>
          <a href="/store" className="fha-nav-item"><span style={{ width: 18, textAlign: "center" }}>🔗</span> Ver app (loja)</a>
        </nav>

        <div className="fha-sidebar-rodape" style={{ padding: "12px 10px", borderTop: "1px solid #1F1F22" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px" }}>
            <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#27272A", color: "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.78rem", fontWeight: 800 }}>
              {(adminName || "A").trim().charAt(0).toUpperCase()}
            </div>
            <div>
              <div style={{ color: "#FFFFFF", fontSize: "0.8rem", fontWeight: 700 }}>{adminName}</div>
              <div style={{ color: "#71717A", fontSize: "0.66rem" }}>Administrador</div>
            </div>
          </div>
          <SairDaConta style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", marginTop: 2, borderRadius: 8, color: "#A1A1AA", fontSize: "0.8rem", background: "none", border: "none", width: "100%", cursor: "pointer" }}>
            Sair
          </SairDaConta>
        </div>
      </aside>

      {/* ── MAIN ── */}
      <main className="fha-main">
        <div className="fha-topbar">
          <div>
            <h1 style={{ color: "#0F172A", fontWeight: 900, fontSize: "1.2rem", margin: 0, letterSpacing: "-0.3px" }}>{TITULOS[tab]}</h1>
            <p style={{ color: "#64748B", fontSize: "0.78rem", margin: "2px 0 0" }}>
              {new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}
            </p>
          </div>
          {tab !== "lojistas" && (
            <button className="fha-btn" style={{ padding: "8px 14px" }} onClick={() => irParaLojistas()}>
              🔍 Buscar lojista
            </button>
          )}
        </div>

        <div style={{ padding: "24px 28px" }}>

          {/* ══════════════════════ OVERVIEW ══════════════════════ */}
          {tab === "overview" && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14, marginBottom: 14 }}>
                {[
                  { label: "Lojistas", val: kpis.totalLojistas, sub: `${kpis.emTrial} em teste · ${kpis.assinantes} assinantes`, color: "#0F172A" },
                  { label: "Novos este mês", val: kpis.novosMes, sub: `${kpis.novosSemana} nesta semana`, color: "#0F172A", ir: () => irParaLojistas("mes") },
                  { label: "MRR estimado", val: fmt(kpis.mrr), sub: "Receita recorrente mensal", color: "#0F172A" },
                  { label: "Total arrecadado", val: fmt(kpis.totalArrecadado), sub: "Histórico de pagamentos", color: "#15803D" },
                  { label: "Pendências", val: fmt(kpis.totalPendente), sub: `${kpis.comPendencia} lojistas com débito`, color: "#B91C1C", ir: () => irParaLojistas("pendencia") },
                ].map(k => (
                  <div key={k.label} className={`fha-kpi${k.ir ? " clicavel" : ""}`} onClick={k.ir}>
                    <div className="fha-kpi-lbl">{k.label}</div>
                    <div className="fha-kpi-val" style={{ color: k.color }}>{k.val}</div>
                    <div className="fha-kpi-sub">{k.sub}</div>
                  </div>
                ))}
              </div>

              {/* Uso: quem está vendendo, quem parou, quem nunca começou */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14, marginBottom: 24 }}>
                {[
                  { label: "Usando", val: usando, sub: "Pedido nos últimos 7 dias", color: "#15803D", ir: () => irParaLojistas() },
                  { label: "Paradas", val: inativas, sub: "Sem pedido há 7+ dias", color: "#B91C1C", ir: () => irParaLojistas("inativos") },
                  { label: "Nunca venderam", val: nuncaVenderam, sub: "Nenhum pedido até hoje", color: "#64748B", ir: () => irParaLojistas("nunca") },
                  { label: "Sem vendedor", val: semVendedor, sub: "Ninguém acompanhando", color: "#B45309", ir: () => irParaLojistas("todos", "sem") },
                ].map(k => (
                  <div key={k.label} className="fha-kpi clicavel" onClick={k.ir}>
                    <div className="fha-kpi-lbl">{k.label}</div>
                    <div className="fha-kpi-val" style={{ color: k.color }}>{k.val}</div>
                    <div className="fha-kpi-sub">{k.sub} →</div>
                  </div>
                ))}
              </div>

              <div className="fha-section" style={{ padding: "20px 24px", marginBottom: 24 }}>
                <h3 style={{ color: "#0F172A", fontWeight: 800, margin: "0 0 20px", fontSize: "0.95rem" }}>Cadastros por mês (últimos 6 meses)</h3>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 12, height: 120 }}>
                  {monthlyGrowth.map(m => (
                    <div key={m.label} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                      <span style={{ color: "#334155", fontSize: "0.75rem", fontWeight: 800 }}>{m.count}</span>
                      <div style={{ width: "100%", height: Math.max((m.count / maxGrowth) * 90, 4) }} className="fha-bar" />
                      <span style={{ color: "#94A3B8", fontSize: "0.66rem", textTransform: "uppercase", fontWeight: 700 }}>{m.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="fha-section">
                <div className="fha-section-head">
                  <h3>
                    Últimos cadastros{" "}
                    <span style={{ color: "#94A3B8", fontWeight: 500, fontSize: "0.78rem" }}>(10 mais recentes de {lojistas.length})</span>
                  </h3>
                  <button className="fha-btn" onClick={() => irParaLojistas()}>Ver todos os {lojistas.length} lojistas →</button>
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table className="fha-table">
                    <thead>
                      <tr><th>Lojista</th><th>Cidade</th><th>Telefone</th><th>Cadastro</th><th>Status</th><th>Uso</th><th>Vendedor / Embaixador</th><th>Ação</th></tr>
                    </thead>
                    <tbody>
                      {lojistas.slice(0, 10).map(l => (
                        <React.Fragment key={l.id}>
                          <tr>
                            <td>{NomeDaLoja({ l })}</td>
                            <td>{l.city || <span className="fha-muted">—</span>}</td>
                            <td>{Telefone({ l })}</td>
                            <td style={{ whiteSpace: "nowrap" }}>{fmtDate(l.createdAt)}</td>
                            <td>{Situacao({ l })}</td>
                            <td>{Uso({ l })}</td>
                            <td>{SeletorDeVendedor({ l })}{SeletorDeEmbaixador({ l })}</td>
                            <td>{Acoes({ l, curto: true })}</td>
                          </tr>
                          {expandedId === l.id && Dados({ l, colSpan: 8 })}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {/* ══════════════════════ LOJISTAS ══════════════════════ */}
          {tab === "lojistas" && (
            <div className="fha-section">
              <div className="fha-section-head">
                <h3>
                  Todos os lojistas <span style={{ color: "#94A3B8", fontWeight: 500 }}>({filtered.length} de {lojistas.length})</span>
                </h3>
                <a href="/store/admin/lojistas" className="fha-btn fha-btn-primary" style={{ padding: "7px 14px" }}>+ Novo lojista</a>
              </div>

              <div style={{ padding: "14px 18px", borderBottom: "1px solid #EEF0F3", display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
                  <div style={{ position: "relative", flex: "1 1 300px", minWidth: 220 }}>
                    <input
                      className="fha-input"
                      placeholder="Buscar por nome, loja, e-mail, cidade, telefone ou CPF/CNPJ..."
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      style={{ width: "100%", paddingRight: search ? 34 : 14 }}
                    />
                    {search && (
                      <button
                        onClick={() => setSearch("")}
                        title="Limpar busca"
                        style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#94A3B8", cursor: "pointer", fontSize: "1.1rem", lineHeight: 1 }}
                      >×</button>
                    )}
                  </div>
                  <select className="fha-input" style={{ padding: "9px 12px" }} value={vendedorFilter} onChange={e => setVendedorFilter(e.target.value)}>
                    <option value="todos">Todos os vendedores</option>
                    <option value="sem">Sem vendedor ({semVendedor})</option>
                    {vendedores.map(v => (
                      <option key={v.id} value={v.id}>{v.name} ({lojistas.filter(l => l.vendedorId === v.id).length})</option>
                    ))}
                  </select>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {([
                    { key: "todos", label: `Todos (${lojistas.length})` },
                    { key: "mes", label: `Novos este mês (${kpis.novosMes})` },
                    { key: "trial", label: `Em teste (${kpis.emTrial})` },
                    { key: "assinantes", label: `Assinantes (${kpis.assinantes})` },
                    { key: "pendencia", label: `Com pendência (${kpis.comPendencia})`, alerta: true },
                    { key: "inativos", label: `Paradas · 7+ dias sem pedido (${inativas})`, alerta: true },
                    { key: "nunca", label: `Nunca venderam (${nuncaVenderam})`, alerta: true },
                  ] as { key: StatusFilter; label: string; alerta?: boolean }[]).map(opt => (
                    <button
                      key={opt.key}
                      onClick={() => setStatusFilter(opt.key)}
                      className={`fha-chip${opt.alerta ? " alerta" : ""}${statusFilter === opt.key ? " on" : ""}`}
                    >{opt.label}</button>
                  ))}
                </div>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table className="fha-table">
                  <thead>
                    <tr>
                      <th>Lojista</th><th>Cidade</th><th>Telefone</th><th>Cadastro</th><th>Status</th><th>Uso</th><th>Vendedor / Embaixador</th><th>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(l => (
                      <React.Fragment key={l.id}>
                        <tr>
                          <td>{NomeDaLoja({ l, comLogo: true })}</td>
                          <td>{l.city || <span className="fha-muted">—</span>}</td>
                          <td>{Telefone({ l })}</td>
                          <td style={{ whiteSpace: "nowrap" }}>{fmtDate(l.createdAt)}</td>
                          <td>{Situacao({ l })}</td>
                          <td>{Uso({ l })}</td>
                          <td>{SeletorDeVendedor({ l })}{SeletorDeEmbaixador({ l })}</td>
                          <td>{Acoes({ l })}</td>
                        </tr>
                        {expandedId === l.id && Dados({ l, colSpan: 8 })}
                      </React.Fragment>
                    ))}
                    {filtered.length === 0 && (
                      <tr><td colSpan={8} style={{ textAlign: "center", padding: 28, color: "#64748B" }}>
                        Nenhum lojista encontrado{search ? ` para "${search}"` : ""}.
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ══════════════════════ FINANCEIRO ══════════════════════ */}
          {tab === "financeiro" && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14, marginBottom: 24 }}>
                {[
                  { label: "MRR estimado", val: fmt(kpis.mrr), color: "#0F172A" },
                  { label: "Total arrecadado", val: fmt(kpis.totalArrecadado), color: "#15803D" },
                  { label: "Total pendente", val: fmt(kpis.totalPendente), color: "#B91C1C" },
                  { label: "Com pendência", val: `${kpis.comPendencia} lojistas`, color: "#B45309" },
                ].map(k => (
                  <div key={k.label} className="fha-kpi">
                    <div className="fha-kpi-lbl">{k.label}</div>
                    <div className="fha-kpi-val" style={{ color: k.color }}>{k.val}</div>
                  </div>
                ))}
              </div>
              <div className="fha-section">
                <div className="fha-section-head"><h3>Lojistas com pendências</h3></div>
                <table className="fha-table">
                  <thead>
                    <tr><th>Lojista</th><th>Valor pendente</th><th>Status</th><th>Ação</th></tr>
                  </thead>
                  <tbody>
                    {lojistas.filter(l => !l.isFranqueadoHakim && l.pendente > 0).map(l => (
                      <tr key={l.id}>
                        <td>{NomeDaLoja({ l })}</td>
                        <td style={{ color: "#B91C1C", fontWeight: 800 }}>{fmt(l.pendente)}</td>
                        <td><span className="fha-badge fha-badge-pending">Em aberto</span></td>
                        <td>
                          <button onClick={() => handleImpersonate(l)} className="fha-btn fha-btn-dark">Acessar conta</button>
                        </td>
                      </tr>
                    ))}
                    {lojistas.filter(l => !l.isFranqueadoHakim && l.pendente > 0).length === 0 && (
                      <tr><td colSpan={4} style={{ textAlign: "center", padding: 32, color: "#64748B" }}>Nenhuma pendência no momento</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {tab === "vendedores" && (
            <VendedoresTab onVerCarteira={(id) => irParaLojistas("todos", id)} />
          )}
          {tab === "ambassadors" && <AmbassadorsTab />}
          {tab === "inscricoes" && <InscricoesEmbaixadorTab />}
          {tab === "custos" && <AdminCostsTab />}

        </div>
      </main>

      {/* ── MODAL LIBERAR DIAS DE BENEFÍCIO ── */}
      {grantModalUser && (
        <div className="fha-modal-fundo">
          <div className="fha-modal">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3>Liberar dias de benefício</h3>
              <button onClick={() => setGrantModalUser(null)} style={{ background: "none", border: "none", color: "#94A3B8", fontSize: "1.2rem", cursor: "pointer" }}>✕</button>
            </div>

            <p style={{ color: "#475569", fontSize: "0.86rem", margin: "0 0 16px" }}>
              Conceder dias adicionais de teste/acesso sem cobrança para <strong style={{ color: "#0F172A" }}>{grantModalUser.storeName || grantModalUser.name}</strong> ({grantModalUser.email}).
            </p>

            <div style={{ background: "#F8FAFC", padding: "12px 14px", borderRadius: 10, border: "1px solid #E5E7EB", marginBottom: 20 }}>
              <div style={{ fontSize: "0.75rem", color: "#64748B" }}>Status atual do teste:</div>
              <div style={{ color: grantModalUser.emTrial ? "#15803D" : "#B91C1C", fontWeight: 800, fontSize: "0.9rem", marginTop: 2 }}>
                {grantModalUser.emTrial
                  ? `Ativo — ${grantModalUser.diasRestantesTrial ?? 0} dias restantes`
                  : "Encerrado"}
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, color: "#334155", marginBottom: 8 }}>
                Escolha a quantidade de dias para liberar:
              </label>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
                <button type="button" onClick={() => handleGrantDays(15)} disabled={granting}
                  style={{ background: "#0B0B0C", color: "#fff", border: "none", padding: "12px", borderRadius: 10, fontWeight: 800, cursor: "pointer", fontSize: "0.9rem" }}>
                  +15 dias
                </button>
                <button type="button" onClick={() => handleGrantDays(30)} disabled={granting}
                  style={{ background: "#E8360C", color: "#fff", border: "none", padding: "12px", borderRadius: 10, fontWeight: 800, cursor: "pointer", fontSize: "0.9rem" }}>
                  +30 dias
                </button>
              </div>

              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="number"
                  min="1"
                  className="fha-input"
                  placeholder="Ou digite o nº de dias (ex: 45)"
                  value={customDays}
                  onChange={e => setCustomDays(e.target.value)}
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  onClick={() => {
                    const num = parseInt(customDays, 10);
                    if (num > 0) handleGrantDays(num);
                    else alert("Digite um número válido de dias.");
                  }}
                  disabled={granting || !customDays}
                  className="fha-btn"
                  style={{ padding: "10px 16px", fontSize: "0.85rem" }}
                >
                  {granting ? "Salvando..." : "Confirmar"}
                </button>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setGrantModalUser(null)} style={{ background: "none", border: "none", color: "#64748B", fontWeight: 700, fontSize: "0.85rem", cursor: "pointer" }}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL REDEFINIR SENHA ── */}
      {resetModalUser && (
        <div onClick={fecharReset} className="fha-modal-fundo">
          <div onClick={e => e.stopPropagation()} className="fha-modal">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3>Redefinir senha</h3>
              <button onClick={fecharReset} style={{ background: "none", border: "none", color: "#94A3B8", fontSize: "1.2rem", cursor: "pointer" }}>✕</button>
            </div>

            {resetFeito ? (
              <>
                <div style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 10, padding: "14px 16px", marginBottom: 20 }}>
                  <div style={{ color: "#166534", fontWeight: 800, fontSize: "0.95rem" }}>Senha redefinida</div>
                  <div style={{ color: "#334155", fontSize: "0.85rem", marginTop: 6 }}>
                    <strong>{resetModalUser.storeName || resetModalUser.name}</strong> entra com<br />
                    login <strong>{resetModalUser.email}</strong> e senha <strong style={{ color: "#B45309" }}>{resetFeito}</strong>.
                  </div>
                  <div style={{ color: "#64748B", fontSize: "0.78rem", marginTop: 8 }}>Peça para o lojista trocar a senha assim que entrar.</div>
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button type="button" onClick={fecharReset} className="fha-btn" style={{ padding: "8px 16px", fontSize: "0.85rem" }}>Fechar</button>
                </div>
              </>
            ) : (
              <>
                <p style={{ color: "#475569", fontSize: "0.86rem", margin: "0 0 16px" }}>
                  A senha de <strong style={{ color: "#0F172A" }}>{resetModalUser.storeName || resetModalUser.name}</strong> ({resetModalUser.email}) vai
                  voltar para <strong style={{ color: "#B45309" }}>123456</strong>. A senha atual deixa de funcionar na hora.
                </p>

                <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, color: "#334155", marginBottom: 8 }}>
                  Para confirmar, digite <span style={{ color: "#B45309" }}>redefinir</span>:
                </label>
                <input
                  autoFocus
                  className="fha-input"
                  placeholder="redefinir"
                  value={resetPalavra}
                  onChange={e => setResetPalavra(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") handleResetPassword(); }}
                  style={{ width: "100%", marginBottom: 20 }}
                />

                <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                  <button type="button" onClick={fecharReset} disabled={resetting} style={{ background: "none", border: "none", color: "#64748B", fontWeight: 700, fontSize: "0.85rem", cursor: "pointer" }}>
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleResetPassword}
                    disabled={!resetConfirmado || resetting}
                    style={{
                      background: resetConfirmado ? "#B45309" : "#E2E8F0",
                      color: resetConfirmado ? "#fff" : "#94A3B8",
                      border: "none", padding: "10px 18px", borderRadius: 10, fontWeight: 800,
                      cursor: resetConfirmado && !resetting ? "pointer" : "not-allowed", fontSize: "0.85rem",
                    }}
                  >
                    {resetting ? "Redefinindo..." : "Confirmar"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
