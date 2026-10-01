"use client";
import { useEffect, useState } from "react";

/**
 * A EQUIPE DE VENDAS (lib/vendedores.ts): quem acompanha as lojas que chegam
 * por tráfego pago ou orgânico, com o placar de cada um — quantas atendeu,
 * quantas esperam contato, quantas pararam de vender — e a comissão prevista.
 *
 * As lojas são atribuídas na aba Lojistas (coluna Vendedor). Aqui se cadastra,
 * edita, pausa e tira gente da equipe.
 */

type Membro = {
  id: string; name: string; email: string; phone: string | null; code: string;
  active: boolean; asaasWalletId: string | null; sellerPercent: number; tambemEmbaixador: boolean;
  clientes: number; atendidos: number; aguardando: number; inativos: number;
  /** Os % de vendedor do mês até agora (lib/parceiro/relatorio.ts). */
  comissaoMes: number;
  /** Tudo que ele recebe no mês: indicação + rede + carteira. */
  comissaoTotal: number;
};
type Embaixador = { id: string; name: string; email: string; asaasWalletId: string | null };

type Form = { name: string; email: string; phone: string; asaasWalletId: string; sellerPercent: string };
const FORM_VAZIO: Form = { name: "", email: "", phone: "", asaasWalletId: "", sellerPercent: "3" };

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const PORTAL = "https://firehubfood.com.br/vendedor";

export default function VendedoresTab({ onVerCarteira }: { onVerCarteira: (vendedorId: string) => void }) {
  const [equipe, setEquipe] = useState<Membro[]>([]);
  const [embaixadores, setEmbaixadores] = useState<Embaixador[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [modal, setModal] = useState<null | "novo" | "embaixador" | { editar: Membro }>(null);
  const [form, setForm] = useState<Form>(FORM_VAZIO);
  const [embaixadorId, setEmbaixadorId] = useState("");
  const [salvando, setSalvando] = useState(false);
  /** Acesso para repassar ao vendedor, mostrado uma vez depois de criar ou trocar a senha. */
  const [acesso, setAcesso] = useState<{ nome: string; email: string; senha: string | null } | null>(null);

  const carregar = async () => {
    setCarregando(true);
    try {
      const r = await fetch("/api/admin/vendedores");
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Erro ao carregar");
      setEquipe(d.equipe || []);
      setEmbaixadores(d.embaixadores || []);
      setErro(null);
    } catch (e: any) {
      setErro(e?.message || "Erro ao carregar a equipe.");
    } finally {
      setCarregando(false);
    }
  };
  useEffect(() => { carregar(); }, []);

  const fechar = () => { if (!salvando) { setModal(null); setForm(FORM_VAZIO); setEmbaixadorId(""); } };

  const enviar = async (url: string, method: string, body: any) => {
    setSalvando(true);
    try {
      const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { alert(d.error || "Não foi possível salvar."); return null; }
      return d;
    } catch {
      alert("Erro de conexão.");
      return null;
    } finally {
      setSalvando(false);
    }
  };

  const salvarNovo = async () => {
    const d = await enviar("/api/admin/vendedores", "POST", form);
    if (!d) return;
    setAcesso({ nome: d.vendedor.name, email: d.vendedor.email, senha: d.senhaTemporaria });
    setModal(null); setForm(FORM_VAZIO); carregar();
  };

  const salvarEmbaixador = async () => {
    if (!embaixadorId) return;
    const d = await enviar("/api/admin/vendedores", "POST", { ambassadorId: embaixadorId, sellerPercent: form.sellerPercent });
    if (!d) return;
    setAcesso({ nome: d.vendedor.name, email: d.vendedor.email, senha: d.senhaTemporaria });
    setModal(null); setEmbaixadorId(""); setForm(FORM_VAZIO); carregar();
  };

  const salvarEdicao = async (m: Membro) => {
    const d = await enviar(`/api/admin/vendedores/${m.id}`, "PATCH", form);
    if (!d) return;
    setModal(null); setForm(FORM_VAZIO); carregar();
  };

  const alternarAtivo = async (m: Membro) => {
    if (m.active && !confirm(`Pausar ${m.name}? Ele não recebe novas lojas e a comissão dele sai do split enquanto estiver pausado.`)) return;
    if (await enviar(`/api/admin/vendedores/${m.id}`, "PATCH", { active: !m.active })) carregar();
  };

  const novaSenha = async (m: Membro) => {
    if (!confirm(`Gerar uma senha nova para ${m.name}? A atual deixa de funcionar.`)) return;
    const d = await enviar(`/api/admin/vendedores/${m.id}`, "PATCH", { novaSenha: true });
    if (d) setAcesso({ nome: m.name, email: m.email, senha: d.senhaTemporaria });
  };

  const tirarDaEquipe = async (m: Membro) => {
    const aviso = m.clientes > 0 ? ` As ${m.clientes} lojas da carteira dele ficam sem vendedor.` : "";
    if (!confirm(`Tirar ${m.name} da equipe de vendas?${aviso}`)) return;
    if (await enviar(`/api/admin/vendedores/${m.id}`, "PATCH", { sairDaEquipe: true })) carregar();
  };

  const abrirEdicao = (m: Membro) => {
    setForm({ name: m.name, email: m.email, phone: m.phone || "", asaasWalletId: m.asaasWalletId || "", sellerPercent: String(m.sellerPercent) });
    setModal({ editar: m });
  };

  const totais = equipe.reduce(
    (t, m) => ({ clientes: t.clientes + m.clientes, atendidos: t.atendidos + m.atendidos, aguardando: t.aguardando + m.aguardando, comissao: t.comissao + m.comissaoMes }),
    { clientes: 0, atendidos: 0, aguardando: 0, comissao: 0 }
  );

  const mensagemDeAcesso = acesso
    ? `Olá, ${acesso.nome.split(" ")[0]}! Seu acesso ao painel de vendedor da FireHub:\n${PORTAL}\nE-mail: ${acesso.email}` +
      (acesso.senha ? `\nSenha: ${acesso.senha}` : "\nSenha: a mesma do portal do embaixador")
    : "";

  const campo = (rotulo: string, chave: keyof Form, extra?: { placeholder?: string; type?: string; dica?: string }) => (
    <label style={{ display: "block", marginBottom: 12 }}>
      <span style={{ display: "block", fontSize: "0.76rem", fontWeight: 700, color: "#334155", marginBottom: 5 }}>{rotulo}</span>
      <input
        className="fha-input"
        style={{ width: "100%" }}
        type={extra?.type || "text"}
        placeholder={extra?.placeholder}
        value={form[chave]}
        onChange={e => setForm(f => ({ ...f, [chave]: e.target.value }))}
      />
      {extra?.dica && <span style={{ display: "block", fontSize: "0.72rem", color: "#94A3B8", marginTop: 4 }}>{extra.dica}</span>}
    </label>
  );

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, marginBottom: 20 }}>
        {[
          { label: "Vendedores", val: equipe.filter(m => m.active).length, sub: `${equipe.length} na equipe`, color: "#0F172A" },
          { label: "Clientes atribuídos", val: totais.clientes, sub: "somando todas as carteiras", color: "#0F172A" },
          { label: "Já atendidos", val: totais.atendidos, sub: "contato feito", color: "#15803D" },
          { label: "Sem atendimento", val: totais.aguardando, sub: "aguardando o vendedor", color: totais.aguardando ? "#B45309" : "#0F172A" },
          { label: "Comissões do mês", val: brl(totais.comissao), sub: "previsão pelo split", color: "#0F172A" },
        ].map(k => (
          <div key={k.label} className="fha-kpi">
            <div className="fha-kpi-lbl">{k.label}</div>
            <div className="fha-kpi-val" style={{ color: k.color }}>{k.val}</div>
            <div className="fha-kpi-sub">{k.sub}</div>
          </div>
        ))}
      </div>

      <div className="fha-section">
        <div className="fha-section-head">
          <h3>Equipe de vendas</h3>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <a href={PORTAL} target="_blank" className="fha-btn" style={{ padding: "7px 12px" }}>Abrir portal do vendedor ↗</a>
            <button className="fha-btn" style={{ padding: "7px 12px" }} onClick={() => { setForm(FORM_VAZIO); setModal("embaixador"); }} disabled={embaixadores.length === 0}>
              Pôr embaixador na equipe
            </button>
            <button className="fha-btn fha-btn-primary" style={{ padding: "7px 14px" }} onClick={() => { setForm(FORM_VAZIO); setModal("novo"); }}>
              + Cadastrar vendedor
            </button>
          </div>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table className="fha-table">
            <thead>
              <tr>
                <th>Vendedor</th><th>Clientes</th><th>Atendidos</th><th>Sem atendimento</th><th>Parados</th><th>Comissão do mês</th><th>Asaas</th><th>Situação</th><th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {carregando && (
                <tr><td colSpan={9} style={{ textAlign: "center", padding: 28, color: "#64748B" }}>Carregando a equipe...</td></tr>
              )}
              {!carregando && erro && (
                <tr><td colSpan={9} style={{ textAlign: "center", padding: 28, color: "#B91C1C" }}>{erro}</td></tr>
              )}
              {!carregando && !erro && equipe.length === 0 && (
                <tr><td colSpan={9} style={{ textAlign: "center", padding: 32, color: "#64748B" }}>
                  Nenhum vendedor ainda. Cadastre o primeiro em <strong>+ Cadastrar vendedor</strong>.
                </td></tr>
              )}
              {!carregando && equipe.map(m => {
                const pct = m.clientes ? Math.round((m.atendidos / m.clientes) * 100) : 0;
                return (
                  <tr key={m.id} style={{ opacity: m.active ? 1 : 0.6 }}>
                    <td>
                      <div style={{ fontWeight: 700, color: "#0F172A" }}>
                        {m.name}{" "}
                        {m.tambemEmbaixador && <span className="fha-badge fha-badge-exempt" style={{ marginLeft: 4 }}>embaixador</span>}
                      </div>
                      <div className="fha-sub">{m.email}</div>
                      <div className="fha-sub">
                        {m.phone ? <a className="fha-link" href={`https://wa.me/${m.phone.length <= 11 ? "55" : ""}${m.phone}`} target="_blank">{m.phone}</a> : "sem telefone"}
                      </div>
                    </td>
                    <td>
                      <button className="fha-btn" onClick={() => onVerCarteira(m.id)} title="Ver as lojas dele na aba Lojistas">{m.clientes} lojas →</button>
                    </td>
                    <td>
                      <div style={{ fontWeight: 800, color: "#15803D" }}>{m.atendidos}</div>
                      {m.clientes > 0 && (
                        <div style={{ width: 80, height: 5, borderRadius: 3, background: "#F1F5F9", marginTop: 4, overflow: "hidden" }}>
                          <div style={{ width: `${pct}%`, height: "100%", background: "#22C55E" }} />
                        </div>
                      )}
                    </td>
                    <td style={{ fontWeight: 800, color: m.aguardando ? "#B45309" : "#94A3B8" }}>{m.aguardando}</td>
                    <td style={{ fontWeight: 700, color: m.inativos ? "#B91C1C" : "#94A3B8" }}>{m.inativos}</td>
                    <td>
                      <div style={{ fontWeight: 800, color: "#0F172A" }}>{brl(m.comissaoMes)}</div>
                      <div className="fha-sub">{m.sellerPercent}% da carteira</div>
                      {m.comissaoTotal > m.comissaoMes && (
                        <div className="fha-sub" title="Somando a indicação e a rede dele">{brl(m.comissaoTotal)} no total</div>
                      )}
                    </td>
                    <td>
                      {m.asaasWalletId
                        ? <span className="fha-badge fha-badge-active">Carteira ok</span>
                        : <span className="fha-badge fha-badge-pending" title="Sem carteira o split não sai para ele">Sem carteira</span>}
                    </td>
                    <td>{m.active ? <span className="fha-badge fha-badge-active">Ativo</span> : <span className="fha-badge fha-badge-exempt">Pausado</span>}</td>
                    <td>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <a className="fha-btn fha-btn-dark" href={`/admin/parceiros/${m.id}?de=vendedores`} title="O mesmo relatório que ele vê no portal">Relatório</a>
                        <button className="fha-btn" onClick={() => abrirEdicao(m)}>Editar</button>
                        <button className="fha-btn" onClick={() => novaSenha(m)}>Nova senha</button>
                        <button className="fha-btn" onClick={() => alternarAtivo(m)}>{m.active ? "Pausar" : "Reativar"}</button>
                        <button className="fha-btn" style={{ color: "#B91C1C" }} onClick={() => tirarDaEquipe(m)}>Tirar da equipe</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p style={{ color: "#64748B", fontSize: "0.8rem", marginTop: 12, lineHeight: 1.5 }}>
        Para direcionar um cliente, escolha o vendedor na coluna <strong>Vendedor</strong> da aba Lojistas. A loja entra na carteira dele como
        <strong> aguardando contato</strong> até ele marcar que atendeu. A comissão sai pelo split do Asaas no fechamento do mês — e só em loja que não é indicação dele: onde ele já ganha como embaixador, só acompanha.
      </p>

      {/* ── MODAIS ── */}
      {modal && (
        <div className="fha-modal-fundo" onClick={fechar}>
          <div className="fha-modal" onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3>{modal === "novo" ? "Cadastrar vendedor" : modal === "embaixador" ? "Pôr embaixador na equipe" : "Editar vendedor"}</h3>
              <button onClick={fechar} style={{ background: "none", border: "none", color: "#94A3B8", fontSize: "1.2rem", cursor: "pointer" }}>✕</button>
            </div>

            {modal === "embaixador" ? (
              <>
                <label style={{ display: "block", marginBottom: 12 }}>
                  <span style={{ display: "block", fontSize: "0.76rem", fontWeight: 700, color: "#334155", marginBottom: 5 }}>Embaixador</span>
                  <select className="fha-input" style={{ width: "100%" }} value={embaixadorId} onChange={e => setEmbaixadorId(e.target.value)}>
                    <option value="">Escolha...</option>
                    {embaixadores.map(e => <option key={e.id} value={e.id}>{e.name} — {e.email}{e.asaasWalletId ? "" : " (sem carteira Asaas)"}</option>)}
                  </select>
                </label>
                {campo("Comissão como vendedor (%)", "sellerPercent", { type: "number", dica: "Vale só nas lojas que você passar para ele e que não são indicação dele — nas indicações ele já ganha como embaixador. Padrão: 3%." })}
                <p style={{ fontSize: "0.78rem", color: "#64748B", margin: "0 0 16px" }}>Ele entra com o mesmo e-mail e senha do portal do embaixador.</p>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                  <button className="fha-btn" onClick={fechar}>Cancelar</button>
                  <button className="fha-btn fha-btn-primary" disabled={!embaixadorId || salvando} onClick={salvarEmbaixador}>{salvando ? "Salvando..." : "Pôr na equipe"}</button>
                </div>
              </>
            ) : (
              <>
                {campo("Nome completo", "name", { placeholder: "Vitor Almeida" })}
                {campo("E-mail (é o login dele)", "email", { placeholder: "vitor@email.com", type: "email" })}
                {campo("Telefone completo com DDD", "phone", { placeholder: "(11) 98765-4321" })}
                {campo("ID da carteira no Asaas", "asaasWalletId", { placeholder: "opcional agora — sem ela o split não sai", dica: "O walletId da conta Asaas do vendedor, para o split da comissão." })}
                {campo("Comissão (%)", "sellerPercent", { type: "number", dica: "Percentual da mensalidade de cada loja da carteira. Padrão: 3%." })}
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 6 }}>
                  <button className="fha-btn" onClick={fechar}>Cancelar</button>
                  <button
                    className="fha-btn fha-btn-primary"
                    disabled={salvando}
                    onClick={() => (modal === "novo" ? salvarNovo() : salvarEdicao((modal as { editar: Membro }).editar))}
                  >
                    {salvando ? "Salvando..." : modal === "novo" ? "Cadastrar" : "Salvar"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {acesso && (
        <div className="fha-modal-fundo" onClick={() => setAcesso(null)}>
          <div className="fha-modal" onClick={e => e.stopPropagation()}>
            <h3 style={{ marginBottom: 12 }}>Acesso de {acesso.nome}</h3>
            <p style={{ color: "#475569", fontSize: "0.85rem", margin: "0 0 12px" }}>
              {acesso.senha
                ? "Guarde agora: a senha não aparece de novo. Mande para o vendedor pelo WhatsApp."
                : "Ele entra com a mesma senha do portal do embaixador."}
            </p>
            <pre style={{ background: "#F8FAFC", border: "1px solid #E5E7EB", borderRadius: 10, padding: 12, fontSize: "0.82rem", whiteSpace: "pre-wrap", color: "#0F172A", margin: "0 0 16px", fontFamily: "inherit" }}>
              {mensagemDeAcesso}
            </pre>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button className="fha-btn" onClick={() => { navigator.clipboard?.writeText(mensagemDeAcesso); }}>Copiar mensagem</button>
              <button className="fha-btn fha-btn-dark" onClick={() => setAcesso(null)}>Fechar</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
