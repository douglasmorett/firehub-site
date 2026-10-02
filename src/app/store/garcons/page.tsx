"use client";

import { useEffect, useState, useMemo } from "react";
import { Plus, Edit2, Trash2, Users, DollarSign, Loader2, ArrowLeft, Calendar, FileText, CheckCircle2, XCircle, Link2, Copy, Check, KeyRound, Eye, EyeOff, ExternalLink, Percent } from "lucide-react";
import { useSession } from "next-auth/react";
import RelatorioDeMesas from "./RelatorioDeMesas";

interface Waiter {
  id: string;
  name: string;
  phone: string | null;
  commissionRate: number;
  active: boolean;
  /** Pelo link, pode fechar a conta? Ausente (cadastro antigo) = pode. */
  podeFecharConta?: boolean;
  /** Pelo link, pode dar desconto? Ausente = pode. */
  podeDarDesconto?: boolean;
  /** Pelo link: liberar mesa, tirar a taxa de serviço, remover item lançado. Ausente = pode. */
  podeLiberarMesa?: boolean;
  podeTirarTaxa?: boolean;
  podeRemoverItem?: boolean;
  /** Login pelo link do garçom. Nulo = sem acesso próprio. */
  login: string | null;
  lastLoginAt: string | null;
}

/** O que /api/store/waiters/acesso devolve para montar o link. */
interface AcessoDoGarcom {
  slug: string | null;
  caminho: string | null;
}

const FORM_VAZIO = { name: "", phone: "", commissionRate: 10, active: true, podeFecharConta: true, podeDarDesconto: true, podeLiberarMesa: true, podeTirarTaxa: true, podeRemoverItem: true, login: "", password: "" };

/** As permissões do módulo de mesas pelo link — todas nascem ligadas; o dono desliga. */
const PERMISSOES_DO_LINK: { campo: "podeFecharConta" | "podeDarDesconto" | "podeLiberarMesa" | "podeTirarTaxa" | "podeRemoverItem"; titulo: string; ajuda: string }[] = [
  { campo: "podeFecharConta", titulo: "Pode fechar a conta pelo link do garçom", ajuda: "Desmarcado, o garçom lança pedidos e imprime a conta, mas o botão \"Fechar Conta\" só aparece no painel da loja." },
  { campo: "podeDarDesconto", titulo: "Pode dar desconto pelo link do garçom", ajuda: "Desmarcado, o botão \"Dar desconto\" some para ele; o desconto na conta fica só com o painel da loja." },
  { campo: "podeLiberarMesa", titulo: "Pode liberar mesa pelo link do garçom", ajuda: "Desmarcado, o botão \"Liberar Mesa\" some para ele; quem libera a mesa é o painel da loja." },
  { campo: "podeTirarTaxa", titulo: "Pode tirar a taxa de serviço pelo link do garçom", ajuda: "Desmarcado, a taxa da loja fica travada para ele — não desmarca nem baixa o percentual; só o painel da loja mexe." },
  { campo: "podeRemoverItem", titulo: "Pode remover item já lançado pelo link do garçom", ajuda: "Desmarcado, ele só acrescenta: não remove item, não diminui quantidade nem cancela pedido da mesa. Ajuste é com o caixa." },
];

interface TableSessionData {
  id: string;
  tableNumber: number;
  tableLabel: string | null;
  openedAt: string;
  closedAt: string;
  totalPaid: number;
  serviceFee: number;
  waiterTip: number;
  waiterCommission: number;
}

export default function GarconsPage() {
  const { data: session } = useSession();
  const [waiters, setWaiters] = useState<Waiter[]>([]);
  /** O relatório de mesas da loja (taxa de serviço e vendas por origem). */
  const [verRelatorioDeMesas, setVerRelatorioDeMesas] = useState(false);
  const [loading, setLoading] = useState(true);
  
  // Modal states
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState(FORM_VAZIO);
  const [erroDoForm, setErroDoForm] = useState("");
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [salvando, setSalvando] = useState(false);

  // Taxa de serviço da LOJA: o que o cliente paga na conta da mesa, igual
  // para todo garçom. Mora em User.taxaServicoPadrao (PUT /api/store/tables);
  // a comissão de cada garçom é outra coisa — o quanto a loja repassa a ele.
  const [taxaDaLoja, setTaxaDaLoja] = useState<number | null>(null);
  const [taxaDigitada, setTaxaDigitada] = useState("");
  const [salvandoTaxa, setSalvandoTaxa] = useState(false);
  const [avisoDaTaxa, setAvisoDaTaxa] = useState<{ ok: boolean; texto: string } | null>(null);

  // Link de acesso do garçom
  const [acesso, setAcesso] = useState<AcessoDoGarcom | null>(null);
  /** Qual dos dois links acabou de ser copiado. */
  const [copiado, setCopiado] = useState<string | null>(null);
  // Montado no navegador: é o domínio que o gerente está usando de fato.
  const linkDoGarcom = acesso?.caminho && typeof window !== "undefined"
    ? `${window.location.origin}${acesso.caminho}`
    : "";
  // Mesmo login, outra tela: a de celular (/garcom/<slug>/celular). A completa
  // continua no link de sempre, para quem já mandou ele para a equipe.
  const linksDoGarcom = linkDoGarcom
    ? [
        { id: "link-do-garcom", titulo: "Módulo garçom", detalhe: "Tela completa, para tablet e computador.", url: linkDoGarcom },
        { id: "link-do-garcom-celular", titulo: "Módulo garçom para celular", detalhe: "Uma coisa por tela, botões grandes: mesa, categoria, produto e enviar.", url: `${linkDoGarcom}/celular` },
      ]
    : [];

  const copiarLink = async (id: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Navegador sem clipboard (http, webview antigo): seleciona para o gerente copiar.
      const campo = document.getElementById(id) as HTMLInputElement | null;
      campo?.select();
      try { document.execCommand("copy"); } catch { /* fica selecionado */ }
    }
    setCopiado(id);
    setTimeout(() => setCopiado(null), 2000);
  };

  // Report states
  const [viewingWaiter, setViewingWaiter] = useState<Waiter | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportSessions, setReportSessions] = useState<TableSessionData[]>([]);
  const [dateFilter, setDateFilter] = useState("hoje"); // hoje, ontem, periodo
  const [startDate, setStartDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0]);

  // Load waiters
  useEffect(() => {
    if (!session) return;
    fetchWaiters();
  }, [session]);

  const fetchWaiters = async () => {
    try {
      setLoading(true);
      const [res, resAcesso, resMesas] = await Promise.all([
        fetch("/api/store/waiters"),
        // Se o link falhar, a lista de garçons não pode ficar vazia por causa dele.
        fetch("/api/store/waiters/acesso").catch(() => null),
        fetch("/api/store/tables").catch(() => null),
      ]);
      if (res.ok) {
        setWaiters(await res.json());
      }
      if (resAcesso?.ok) {
        setAcesso(await resAcesso.json());
      }
      if (resMesas?.ok) {
        const dados = await resMesas.json().catch(() => null);
        if (typeof dados?.taxaServicoPadrao === "number") {
          setTaxaDaLoja(dados.taxaServicoPadrao);
          setTaxaDigitada(String(dados.taxaServicoPadrao));
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const fetchReport = async (waiterId: string, filter: string, start: string, end: string) => {
    setReportLoading(true);
    try {
      let queryStart = "";
      let queryEnd = "";

      if (filter === "hoje") {
        const today = new Date();
        today.setHours(0,0,0,0);
        queryStart = today.toISOString();
        const endOfDay = new Date(today);
        endOfDay.setHours(23,59,59,999);
        queryEnd = endOfDay.toISOString();
      } else if (filter === "ontem") {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        yesterday.setHours(0,0,0,0);
        queryStart = yesterday.toISOString();
        const endOfDay = new Date(yesterday);
        endOfDay.setHours(23,59,59,999);
        queryEnd = endOfDay.toISOString();
      } else if (filter === "periodo") {
        const sd = new Date(start);
        sd.setHours(0,0,0,0);
        queryStart = sd.toISOString();
        const ed = new Date(end);
        ed.setHours(23,59,59,999);
        queryEnd = ed.toISOString();
      }

      const res = await fetch(`/api/store/waiters/${waiterId}/report?startDate=${queryStart}&endDate=${queryEnd}`);
      if (res.ok) {
        const data = await res.json();
        setReportSessions(data.sessions || []);
      }
    } catch {
      setReportSessions([]);
    } finally {
      setReportLoading(false);
    }
  };

  const openReport = (w: Waiter) => {
    setViewingWaiter(w);
    setDateFilter("hoje");
    fetchReport(w.id, "hoje", startDate, endDate);
  };

  useEffect(() => {
    if (viewingWaiter) {
      fetchReport(viewingWaiter.id, dateFilter, startDate, endDate);
    }
  }, [dateFilter, startDate, endDate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const method = editingId ? "PUT" : "POST";
    const body = editingId ? { id: editingId, ...formData } : formData;

    setErroDoForm("");
    setSalvando(true);
    try {
      const res = await fetch("/api/store/waiters", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        setShowModal(false);
        fetchWaiters();
      } else {
        const data = await res.json().catch(() => ({}));
        setErroDoForm(data?.error || "Erro ao salvar garçom");
      }
    } catch {
      setErroDoForm("Sem conexão. Tente de novo.");
    } finally {
      setSalvando(false);
    }
  };

  const salvarTaxaDaLoja = async () => {
    const pct = Number(taxaDigitada.replace(",", "."));
    if (taxaDigitada.trim() === "" || !Number.isFinite(pct) || pct < 0 || pct > 100) {
      setAvisoDaTaxa({ ok: false, texto: "Digite um percentual entre 0 e 100." });
      return;
    }
    setSalvandoTaxa(true);
    setAvisoDaTaxa(null);
    try {
      const res = await fetch("/api/store/tables", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taxaServicoPadrao: pct }),
      });
      const dados = await res.json().catch(() => ({}));
      if (res.ok && typeof dados?.taxaServicoPadrao === "number") {
        setTaxaDaLoja(dados.taxaServicoPadrao);
        setTaxaDigitada(String(dados.taxaServicoPadrao));
        setAvisoDaTaxa({ ok: true, texto: `Salvo: as contas das mesas saem com ${dados.taxaServicoPadrao}% de taxa de serviço.` });
      } else {
        setAvisoDaTaxa({ ok: false, texto: dados?.error || "Não deu para salvar a taxa." });
      }
    } catch {
      setAvisoDaTaxa({ ok: false, texto: "Sem conexão. Tente de novo." });
    } finally {
      setSalvandoTaxa(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Tem certeza que deseja remover este garçom?")) return;
    const res = await fetch(`/api/store/waiters?id=${id}`, { method: "DELETE" });
    if (res.ok) fetchWaiters();
  };

  const openNew = () => {
    setEditingId(null);
    // Garçom novo nasce recebendo a taxa inteira; quem repassa menos ajusta.
    setFormData({ ...FORM_VAZIO, commissionRate: taxaDaLoja ?? FORM_VAZIO.commissionRate });
    setErroDoForm("");
    setMostrarSenha(false);
    setShowModal(true);
  };

  const openEdit = (w: Waiter) => {
    setEditingId(w.id);
    setFormData({ name: w.name, phone: w.phone || "", commissionRate: w.commissionRate ?? taxaDaLoja ?? 10, active: w.active, podeFecharConta: w.podeFecharConta !== false, podeDarDesconto: w.podeDarDesconto !== false, podeLiberarMesa: w.podeLiberarMesa !== false, podeTirarTaxa: w.podeTirarTaxa !== false, podeRemoverItem: w.podeRemoverItem !== false, login: w.login || "", password: "" });
    setErroDoForm("");
    setMostrarSenha(false);
    setShowModal(true);
  };

  const fmt = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
  const fmtDate = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

  const reportTotals = useMemo(() => {
    return reportSessions.reduce((acc, curr) => {
      acc.totalTables++;
      acc.totalPaid += curr.totalPaid;
      acc.totalServiceFee += curr.serviceFee;
      acc.totalTip += curr.waiterTip;
      acc.totalCommission += curr.waiterCommission;
      return acc;
    }, { totalTables: 0, totalPaid: 0, totalServiceFee: 0, totalTip: 0, totalCommission: 0 });
  }, [reportSessions]);

  return (
    <div style={{ padding: 20, maxWidth: viewingWaiter || verRelatorioDeMesas ? 1200 : 1000, margin: "0 auto" }}>
      
      {/* ─── RELATÓRIO DE MESAS DA LOJA ─── */}
      {verRelatorioDeMesas ? (
        <RelatorioDeMesas onVoltar={() => setVerRelatorioDeMesas(false)} />
      ) : !viewingWaiter ? (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: "#1E293B", display: "flex", alignItems: "center", gap: 10 }}>
              <Users size={28} color="#475569" /> Gestão de Garçons
            </h1>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {/* O relatório da LOJA (todas as mesas, todos os garçons), pedido
                  pelo dono em 17/09/2026. O botão "Relatório" de cada linha da
                  tabela continua sendo o de UM garçom. */}
              <button onClick={() => setVerRelatorioDeMesas(true)} style={{
                background: "#fff", color: "#334155", border: "1.5px solid #CBD5E1", padding: "10px 16px", borderRadius: 8,
                fontWeight: 700, display: "flex", alignItems: "center", gap: 6, cursor: "pointer"
              }}>
                <FileText size={18} /> Relatório de Mesas
              </button>
              <button onClick={openNew} style={{
                background: "#475569", color: "#fff", border: "none", padding: "10px 16px", borderRadius: 8,
                fontWeight: 700, display: "flex", alignItems: "center", gap: 6, cursor: "pointer"
              }}>
                <Plus size={18} /> Novo Garçom
              </button>
            </div>
          </div>

          {/* ─── TAXA DE SERVIÇO DA LOJA ─── */}
          <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 14, padding: 18, marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <Percent size={18} color="#475569" />
              <strong style={{ color: "#0F172A", fontSize: 15 }}>Taxa de serviço cobrada do cliente</strong>
            </div>
            <p style={{ margin: "0 0 12px", fontSize: 13, color: "#334155", lineHeight: 1.5 }}>
              É o percentual que sai na conta de todas as mesas, seja qual for o garçom. Quanto dela vai para cada
              garçom é a comissão, no cadastro dele.
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <div style={{ position: "relative" }}>
                <input type="number" min="0" max="100" step="0.5" inputMode="decimal" value={taxaDigitada}
                  onChange={e => { setTaxaDigitada(e.target.value); setAvisoDaTaxa(null); }}
                  onKeyDown={e => { if (e.key === "Enter") salvarTaxaDaLoja(); }}
                  disabled={taxaDaLoja === null}
                  aria-label="Taxa de serviço da loja em porcentagem"
                  style={{ width: 110, padding: "10px 30px 10px 12px", borderRadius: 10, border: "1.5px solid #CBD5E1", fontSize: 15, fontWeight: 700, fontFamily: "inherit", color: "#1E293B" }} />
                <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", color: "#64748B", fontWeight: 700 }}>%</span>
              </div>
              <button type="button" onClick={salvarTaxaDaLoja}
                disabled={salvandoTaxa || taxaDaLoja === null || Number(taxaDigitada.replace(",", ".")) === taxaDaLoja}
                style={{
                  background: "#475569", color: "#fff", border: "none", padding: "10px 16px", borderRadius: 10, fontWeight: 700, cursor: "pointer",
                  opacity: salvandoTaxa || taxaDaLoja === null || Number(taxaDigitada.replace(",", ".")) === taxaDaLoja ? 0.5 : 1,
                }}>
                {salvandoTaxa ? "Salvando..." : "Salvar"}
              </button>
              <span style={{ fontSize: 12, color: "#64748B" }}>Use 0 para não cobrar. No fechamento ainda dá para mudar numa conta só.</span>
            </div>
            {avisoDaTaxa && (
              <div role="status" style={{ marginTop: 10, fontSize: 13, fontWeight: 600, color: avisoDaTaxa.ok ? "#0F766E" : "#B71C1C" }}>
                {avisoDaTaxa.texto}
              </div>
            )}
          </div>

          {/* ─── LINK DE ACESSO DO GARÇOM ─── */}
          <div style={{ background: "linear-gradient(135deg, #F8FAFC, #FAF6F2)", border: "1px solid #E2E8F0", borderRadius: 14, padding: 18, marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <Link2 size={18} color="#475569" />
              <strong style={{ color: "#0F172A", fontSize: 15 }}>Link de acesso do garçom</strong>
            </div>
            <p style={{ margin: "0 0 12px", fontSize: 13, color: "#334155", lineHeight: 1.5 }}>
              Mande um destes links para a equipe. O garçom entra com o login e a senha que você define no cadastro dele
              e vê só o módulo de mesas, nada mais do painel. O login é o mesmo nos dois; muda só a tela.
            </p>
            {linkDoGarcom ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {linksDoGarcom.map((l) => (
                  <div key={l.id}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: "#0F172A" }}>{l.titulo}</div>
                    <div style={{ fontSize: 12, color: "#64748B", margin: "2px 0 6px" }}>{l.detalhe}</div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <input id={l.id} readOnly value={l.url} onFocus={e => e.target.select()}
                        style={{ flex: 1, minWidth: 220, padding: "10px 12px", borderRadius: 10, border: "1.5px solid #CBD5E1", background: "#fff", fontSize: 13, fontFamily: "inherit", color: "#1E293B" }} />
                      <button type="button" onClick={() => copiarLink(l.id, l.url)} style={{
                        background: copiado === l.id ? "#0F766E" : "#475569", color: "#fff", border: "none", padding: "10px 14px",
                        borderRadius: 10, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
                      }}>
                        {copiado === l.id ? <Check size={16} /> : <Copy size={16} />} {copiado === l.id ? "Copiado!" : "Copiar link"}
                      </button>
                      <a href={l.url} target="_blank" rel="noreferrer" style={{
                        background: "#fff", color: "#334155", border: "1.5px solid #CBD5E1", padding: "10px 14px",
                        borderRadius: 10, fontWeight: 700, textDecoration: "none", display: "flex", alignItems: "center", gap: 6,
                      }}>
                        <ExternalLink size={16} /> Abrir
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            ) : acesso && !acesso.slug ? (
              <p style={{ margin: 0, fontSize: 13, color: "#B45309", fontWeight: 600 }}>
                Sua loja ainda não tem um endereço próprio (slug). Fale com o suporte do FireHub para definir.
              </p>
            ) : (
              <p style={{ margin: 0, fontSize: 13, color: "#94A3B8" }}>Carregando link...</p>
            )}
          </div>

          {loading ? (
            <div style={{ textAlign: "center", padding: 40, color: "#94A3B8" }}><Loader2 className="animate-spin mx-auto" size={32} /></div>
          ) : (
            <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #E2E8F0", overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#F8FAFC", borderBottom: "2px solid #E2E8F0", textAlign: "left" }}>
                    <th style={{ padding: "14px 16px", color: "#475569", fontWeight: 700, fontSize: 13 }}>Nome</th>
                    <th style={{ padding: "14px 16px", color: "#475569", fontWeight: 700, fontSize: 13 }}>Telefone</th>
                    <th style={{ padding: "14px 16px", color: "#475569", fontWeight: 700, fontSize: 13 }}>Acesso</th>
                    <th style={{ padding: "14px 16px", color: "#475569", fontWeight: 700, fontSize: 13 }}>Status</th>
                    <th style={{ padding: "14px 16px", color: "#475569", fontWeight: 700, fontSize: 13, textAlign: "right" }}>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {waiters.map(w => (
                    <tr key={w.id} style={{ borderBottom: "1px solid #E2E8F0", cursor: "pointer" }} onClick={() => openReport(w)}>
                      <td style={{ padding: "14px 16px", fontWeight: 600, color: "#1E293B" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#FAF6F2", color: "#475569", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800 }}>
                            {w.name.charAt(0).toUpperCase()}
                          </div>
                          {w.name}
                        </div>
                      </td>
                      <td style={{ padding: "14px 16px", color: "#64748B" }}>{w.phone || "-"}</td>
                      <td style={{ padding: "14px 16px" }}>
                        {w.login ? (
                          <span title={w.lastLoginAt ? `Último acesso: ${fmtDate(w.lastLoginAt)}` : "Nunca entrou"} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#F8FAFC", color: "#334155", padding: "4px 10px", borderRadius: 20, fontSize: 12, fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>
                            <KeyRound size={12} /> {w.login}
                          </span>
                        ) : (
                          <span style={{ color: "#94A3B8", fontSize: 12 }}>sem acesso</span>
                        )}
                      </td>
                      <td style={{ padding: "14px 16px" }}>
                        <span style={{
                          background: w.active ? "#F0FDFA" : "#FEE2E2",
                          color: w.active ? "#0F766E" : "#C92E09",
                          padding: "4px 8px", borderRadius: 20, fontSize: 12, fontWeight: 700
                        }}>
                          {w.active ? "Ativo" : "Inativo"}
                        </span>
                      </td>
                      <td style={{ padding: "14px 16px", textAlign: "right" }} onClick={e => e.stopPropagation()}>
                        <button onClick={() => openReport(w)} style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", padding: "6px 12px", borderRadius: 8, color: "#1E293B", fontWeight: 600, cursor: "pointer", marginRight: 8, fontSize: 12 }}>
                          <FileText size={14} style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }} />
                          Relatório
                        </button>
                        <button onClick={() => openEdit(w)} style={{ background: "none", border: "none", color: "#1C1917", cursor: "pointer", marginRight: 8 }}><Edit2 size={18} /></button>
                        <button onClick={() => handleDelete(w.id)} style={{ background: "none", border: "none", color: "#C92E09", cursor: "pointer" }}><Trash2 size={18} /></button>
                      </td>
                    </tr>
                  ))}
                  {waiters.length === 0 && (
                    <tr><td colSpan={5} style={{ padding: 40, textAlign: "center", color: "#94A3B8" }}>Nenhum garçom cadastrado</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        /* ─── REPORT VIEW ─── */
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
            <button onClick={() => setViewingWaiter(null)} style={{ background: "#F1F5F9", border: "none", padding: 10, borderRadius: 8, cursor: "pointer", display: "flex" }}>
              <ArrowLeft size={20} color="#475569" />
            </button>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: "#1E293B", display: "flex", alignItems: "center", gap: 10 }}>
              Desempenho: <span style={{ color: "#475569" }}>{viewingWaiter.name}</span>
            </h1>
          </div>

          <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #E2E8F0", padding: 24, marginBottom: 24 }}>
            <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", marginBottom: 24 }}>
              <div style={{ display: "flex", gap: 8, background: "#F8FAFC", padding: 4, borderRadius: 10, border: "1px solid #E2E8F0" }}>
                <button onClick={() => setDateFilter("hoje")} style={{ padding: "8px 16px", borderRadius: 6, border: "none", background: dateFilter === "hoje" ? "#fff" : "transparent", color: dateFilter === "hoje" ? "#475569" : "#64748B", fontWeight: 700, cursor: "pointer", boxShadow: dateFilter === "hoje" ? "0 2px 4px rgba(0,0,0,0.05)" : "none" }}>Hoje</button>
                <button onClick={() => setDateFilter("ontem")} style={{ padding: "8px 16px", borderRadius: 6, border: "none", background: dateFilter === "ontem" ? "#fff" : "transparent", color: dateFilter === "ontem" ? "#475569" : "#64748B", fontWeight: 700, cursor: "pointer", boxShadow: dateFilter === "ontem" ? "0 2px 4px rgba(0,0,0,0.05)" : "none" }}>Ontem</button>
                <button onClick={() => setDateFilter("periodo")} style={{ padding: "8px 16px", borderRadius: 6, border: "none", background: dateFilter === "periodo" ? "#fff" : "transparent", color: dateFilter === "periodo" ? "#475569" : "#64748B", fontWeight: 700, cursor: "pointer", boxShadow: dateFilter === "periodo" ? "0 2px 4px rgba(0,0,0,0.05)" : "none" }}>Período</button>
              </div>

              {dateFilter === "periodo" && (
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #E2E8F0", fontFamily: "inherit", color: "#1E293B" }} />
                  <span style={{ color: "#94A3B8" }}>até</span>
                  <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #E2E8F0", fontFamily: "inherit", color: "#1E293B" }} />
                </div>
              )}
            </div>

            {/* Metrics */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16 }}>
              <div style={{ background: "#FAF6F2", padding: 20, borderRadius: 12, border: "1px solid #E0D4FF" }}>
                <div style={{ fontSize: 13, color: "#334155", fontWeight: 700, marginBottom: 4 }}>Mesas Atendidas</div>
                <div style={{ fontSize: 28, fontWeight: 900, color: "#0F172A" }}>{reportTotals.totalTables}</div>
              </div>
              <div style={{ background: "#F8FAFC", padding: 20, borderRadius: 12, border: "1px solid #E2E8F0" }}>
                <div style={{ fontSize: 13, color: "#475569", fontWeight: 700, marginBottom: 4 }}>Total Gasto nas Mesas</div>
                <div style={{ fontSize: 24, fontWeight: 900, color: "#1E293B" }}>{fmt(reportTotals.totalPaid)}</div>
              </div>
              <div style={{ background: "#F8FAFC", padding: 20, borderRadius: 12, border: "1px solid #E2E8F0" }}>
                <div style={{ fontSize: 13, color: "#475569", fontWeight: 700, marginBottom: 4 }}>Taxa de Serviço Cobrada</div>
                <div style={{ fontSize: 24, fontWeight: 900, color: "#1E293B" }}>{fmt(reportTotals.totalServiceFee)}</div>
              </div>
              <div style={{ background: "#F8FAFC", padding: 20, borderRadius: 12, border: "1px solid #E2E8F0" }}>
                <div style={{ fontSize: 13, color: "#475569", fontWeight: 700, marginBottom: 4 }}>Gorjetas Extras</div>
                <div style={{ fontSize: 24, fontWeight: 900, color: "#1E293B" }}>{fmt(reportTotals.totalTip)}</div>
              </div>
              <div style={{ background: "#F0FDFA", padding: 20, borderRadius: 12, border: "1px solid #99F6E4" }}>
                <div style={{ fontSize: 13, color: "#0F766E", fontWeight: 900, marginBottom: 4 }}>Comissão Final (A Receber)</div>
                <div style={{ fontSize: 28, fontWeight: 900, color: "#134E4A" }}>{fmt(reportTotals.totalCommission)}</div>
              </div>
            </div>
          </div>

          <h3 style={{ fontSize: 18, fontWeight: 800, color: "#1E293B", marginBottom: 16 }}>Histórico de Mesas Atendidas</h3>
          <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #E2E8F0", overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#F8FAFC", borderBottom: "2px solid #E2E8F0", textAlign: "left" }}>
                  <th style={{ padding: "14px 16px", color: "#475569", fontWeight: 700, fontSize: 13 }}>Mesa</th>
                  <th style={{ padding: "14px 16px", color: "#475569", fontWeight: 700, fontSize: 13 }}>Data / Fechamento</th>
                  <th style={{ padding: "14px 16px", color: "#475569", fontWeight: 700, fontSize: 13 }}>Total da Conta</th>
                  <th style={{ padding: "14px 16px", color: "#475569", fontWeight: 700, fontSize: 13 }}>Taxa de Serviço</th>
                  <th style={{ padding: "14px 16px", color: "#475569", fontWeight: 700, fontSize: 13 }}>Gorjeta Extra</th>
                  <th style={{ padding: "14px 16px", color: "#1E293B", fontWeight: 800, fontSize: 13 }}>Comissão</th>
                </tr>
              </thead>
              <tbody>
                {reportLoading ? (
                  <tr><td colSpan={6} style={{ padding: 40, textAlign: "center" }}><Loader2 className="animate-spin mx-auto text-slate-400" size={32} /></td></tr>
                ) : reportSessions.length === 0 ? (
                  <tr><td colSpan={6} style={{ padding: 40, textAlign: "center", color: "#94A3B8" }}>Nenhuma mesa atendida no período selecionado.</td></tr>
                ) : (
                  reportSessions.map(s => (
                    <tr key={s.id} style={{ borderBottom: "1px solid #E2E8F0" }}>
                      <td style={{ padding: "14px 16px", fontWeight: 800, color: "#1E293B" }}>
                        Mesa {s.tableNumber}
                      </td>
                      <td style={{ padding: "14px 16px", color: "#64748B", fontSize: 14 }}>{fmtDate(s.closedAt)}</td>
                      <td style={{ padding: "14px 16px", fontWeight: 600, color: "#1E293B" }}>{fmt(s.totalPaid)}</td>
                      <td style={{ padding: "14px 16px" }}>
                        {s.serviceFee > 0 ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 4, color: "#0F766E", fontWeight: 700, fontSize: 14 }}>
                            <CheckCircle2 size={16} /> {fmt(s.serviceFee)}
                          </div>
                        ) : (
                          <div style={{ display: "flex", alignItems: "center", gap: 4, color: "#C92E09", fontWeight: 600, fontSize: 14 }}>
                            <XCircle size={16} /> Não pagou
                          </div>
                        )}
                      </td>
                      <td style={{ padding: "14px 16px", color: "#B45309", fontWeight: 700 }}>
                        {s.waiterTip > 0 ? `+ ${fmt(s.waiterTip)}` : "-"}
                      </td>
                      <td style={{ padding: "14px 16px", fontWeight: 800, color: "#0F766E" }}>
                        {fmt(s.waiterCommission)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* MODAL DE CADASTRO/EDIÇÃO */}
      {showModal && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999 }}>
          {/* Altura máxima + rolagem: com as cinco permissões a janela passou de 960 px e, em tela de
              1366×768, Cancelar e Salvar ficavam fora da tela — só dava para salvar apertando Enter. */}
          <div style={{ background: "#fff", padding: 24, borderRadius: 16, width: "90%", maxWidth: 400, maxHeight: "calc(100vh - 32px)", overflowY: "auto", boxShadow: "0 10px 25px rgba(0,0,0,0.2)" }}>
            <h2 style={{ margin: "0 0 20px 0", fontSize: 20 }}>{editingId ? "Editar Garçom" : "Novo Garçom"}</h2>
            
            <form onSubmit={handleSubmit}>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 700, color: "#475569" }}>Nome</label>
                <input required value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })}
                  style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1.5px solid #CBD5E1", fontSize: 14, fontFamily: "inherit" }} />
              </div>
              
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 700, color: "#475569" }}>Telefone</label>
                <input value={formData.phone} onChange={e => setFormData({ ...formData, phone: e.target.value })}
                  style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1.5px solid #CBD5E1", fontSize: 14, fontFamily: "inherit" }} />
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 700, color: "#475569" }}>Comissão do garçom (%)</label>
                <input type="number" min="0" max="100" step="0.5" inputMode="decimal" required
                  value={Number.isFinite(formData.commissionRate) ? formData.commissionRate : ""}
                  onChange={e => setFormData({ ...formData, commissionRate: e.target.value === "" ? NaN : Number(e.target.value) })}
                  style={{ width: 120, padding: "10px 14px", borderRadius: 10, border: "1.5px solid #CBD5E1", fontSize: 14, fontFamily: "inherit" }} />
                <p style={{ margin: "6px 0 0", fontSize: 11, color: "#64748B", lineHeight: 1.4 }}>
                  Quanto ele recebe, em % do consumo das mesas dele. Não muda o que o cliente paga
                  {taxaDaLoja !== null ? ` (a taxa da loja, ${taxaDaLoja}%)` : ""}: igual à taxa, ele recebe a taxa inteira;
                  menor, a diferença fica com a loja. Nunca passa da taxa cobrada na conta. Gorjeta é sempre dele.
                </p>
              </div>

              {/* Acesso pelo link do garçom */}
              <div style={{ marginBottom: 16, padding: 14, background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, fontSize: 13, fontWeight: 800, color: "#0F172A" }}>
                  <KeyRound size={14} /> Acesso pelo link do garçom
                </div>
                <label style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 700, color: "#475569" }}>Login</label>
                <input value={formData.login}
                  onChange={e => setFormData({ ...formData, login: e.target.value.toLowerCase().replace(/\s+/g, "") })}
                  placeholder="ex: joao" autoCapitalize="none" autoCorrect="off" autoComplete="off"
                  style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1.5px solid #CBD5E1", fontSize: 14, fontFamily: "inherit", marginBottom: 10 }} />
                <label style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 700, color: "#475569" }}>
                  {editingId && waiters.find(w => w.id === editingId)?.login ? "Nova senha (em branco = manter a atual)" : "Senha"}
                </label>
                <div style={{ position: "relative" }}>
                  <input type={mostrarSenha ? "text" : "password"} value={formData.password}
                    onChange={e => setFormData({ ...formData, password: e.target.value })}
                    placeholder="mínimo 6 caracteres" autoComplete="new-password"
                    style={{ width: "100%", padding: "10px 40px 10px 14px", borderRadius: 10, border: "1.5px solid #CBD5E1", fontSize: 14, fontFamily: "inherit" }} />
                  <button type="button" onClick={() => setMostrarSenha(v => !v)} aria-label={mostrarSenha ? "Esconder senha" : "Mostrar senha"}
                    style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", padding: 6, cursor: "pointer", color: "#64748B" }}>
                    {mostrarSenha ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <p style={{ margin: "8px 0 0", fontSize: 11, color: "#64748B", lineHeight: 1.4 }}>
                  Sem login o garçom não entra pelo link, mas continua disponível para escolher ao abrir uma mesa.
                  Trocar a senha desconecta o celular dele na hora.
                </p>
              </div>

              {PERMISSOES_DO_LINK.map(p => (
                <div key={p.campo} style={{ marginBottom: 14 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                    <input type="checkbox" checked={formData[p.campo]} onChange={e => setFormData({ ...formData, [p.campo]: e.target.checked })} style={{ width: 18, height: 18, accentColor: "#475569" }} />
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{p.titulo}</span>
                  </label>
                  <p style={{ margin: "6px 0 0 26px", fontSize: 11, color: "#64748B", lineHeight: 1.4 }}>{p.ajuda}</p>
                </div>
              ))}

              <div style={{ marginBottom: 24 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                  <input type="checkbox" checked={formData.active} onChange={e => setFormData({ ...formData, active: e.target.checked })} style={{ width: 18, height: 18, accentColor: "#475569" }} />
                  <span style={{ fontSize: 14, fontWeight: 600 }}>Ativo no sistema</span>
                </label>
              </div>

              {erroDoForm && (
                <div role="alert" style={{ background: "#FEF2F2", color: "#B71C1C", border: "1px solid #FECACA", borderRadius: 10, padding: "10px 12px", fontSize: 13, fontWeight: 600, marginBottom: 14 }}>
                  {erroDoForm}
                </div>
              )}

              <div style={{ display: "flex", gap: 10 }}>
                <button type="button" onClick={() => setShowModal(false)}
                  style={{ flex: 1, padding: "12px 0", borderRadius: 10, border: "1.5px solid #CBD5E1", background: "#F8FAFC", cursor: "pointer", fontWeight: 700, color: "#64748B" }}>
                  Cancelar
                </button>
                <button type="submit" disabled={salvando}
                  style={{ flex: 1, padding: "12px 0", borderRadius: 10, border: "none", background: "#475569", color: "#fff", cursor: "pointer", fontWeight: 800, opacity: salvando ? 0.7 : 1 }}>
                  {salvando ? "Salvando..." : "Salvar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
