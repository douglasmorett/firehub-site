"use client";

import { useCallback, useEffect, useState } from "react";

type Conta = {
  id: string;
  email: string;
  nomeLoja: string;
  whatsapp: string | null;
  status: string;
  motoboys: number;
  lojasIncluidas: number;
  config: any;
  ultimoEstado: any;
  caktoRef: string | null;
  observacoes: string | null;
  criadoPor: string | null;
  createdAt: string;
  updatedAt: string;
};

const ZIP = "https://firehubfood.com.br/downloads/FireHub-Prazos-Extensao.zip";

const COR_DO_STATUS: Record<string, { bg: string; fg: string }> = {
  PILOTO: { bg: "#EFF6FF", fg: "#1D4ED8" },
  ATIVO: { bg: "#F0FDF4", fg: "#15803D" },
  BLOQUEADO: { bg: "#FEF2F2", fg: "#B91C1C" },
  CANCELADO: { bg: "#F1F5F9", fg: "#475569" },
};

function haQuanto(iso?: string | null): string {
  if (!iso) return "nunca";
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  if (min < 48 * 60) return `há ${Math.round(min / 60)} h`;
  return `há ${Math.round(min / 1440)} d`;
}

export default function PrazosAdminClient() {
  const [contas, setContas] = useState<Conta[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [form, setForm] = useState({ email: "", senha: "", nomeLoja: "", whatsapp: "", status: "PILOTO", motoboys: 2, lojasIncluidas: 1, observacoes: "" });
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/prazos", { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "falha ao listar");
      setContas(d.contas || []);
      setErro("");
    } catch (e: any) {
      setErro(e?.message || "falha ao listar");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    carregar();
    const t = setInterval(carregar, 30_000);
    return () => clearInterval(t);
  }, [carregar]);

  const criar = async () => {
    setSalvando(true);
    setErro("");
    try {
      const r = await fetch("/api/admin/prazos", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "falha ao criar");
      setForm({ email: "", senha: "", nomeLoja: "", whatsapp: "", status: "PILOTO", motoboys: 2, lojasIncluidas: 1, observacoes: "" });
      await carregar();
    } catch (e: any) {
      setErro(e?.message || "falha ao criar");
    } finally {
      setSalvando(false);
    }
  };

  const alterar = async (id: string, dados: Record<string, unknown>) => {
    setErro("");
    try {
      const r = await fetch("/api/admin/prazos", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...dados }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "falha ao alterar");
      await carregar();
    } catch (e: any) {
      setErro(e?.message || "falha ao alterar");
    }
  };

  const novaSenha = (c: Conta) => {
    const s = prompt(`Nova senha para ${c.email} (mínimo 6 caracteres):`);
    if (s && s.length >= 6) alterar(c.id, { senha: s });
  };

  const input: React.CSSProperties = { padding: "8px 10px", border: "1px solid #CBD5E1", borderRadius: 8, fontSize: ".9rem", width: "100%" };
  const botao = (bg: string, fg = "#fff"): React.CSSProperties => ({ background: bg, color: fg, border: "none", borderRadius: 8, padding: "6px 10px", fontWeight: 700, fontSize: ".78rem", cursor: "pointer" });

  return (
    <div style={{ maxWidth: 1240 }}>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 900, margin: "0 0 4px" }}>⏱️ FireHub Prazos — contas da extensão</h1>
      <p style={{ color: "#64748B", margin: "0 0 1.25rem", fontSize: ".9rem" }}>
        Produto vendido fora do FireHub: a extensão ajusta o prazo no Portal do Parceiro (iFood) e o tempo de preparo no
        99Food Admin pela carga do painel que o lojista já usa. Cada conta aqui é um cliente (ou um piloto) — e um lead.
      </p>

      {/* ── Como instalar / o que dizer ao piloto ───────────────────────── */}
      <div style={{ background: "#FFF7ED", border: "1px solid #FED7AA", borderRadius: 12, padding: "1rem 1.25rem", marginBottom: "1.25rem", fontSize: ".85rem", lineHeight: 1.6 }}>
        <div style={{ fontWeight: 800, color: "#9A3412", marginBottom: 4 }}>Como o piloto instala (mandar junto com e-mail e senha)</div>
        <ol style={{ margin: 0, paddingLeft: "1.2rem", color: "#7C2D12" }}>
          <li>Baixar <a href={ZIP} style={{ fontWeight: 800 }}>{ZIP.replace("https://", "")}</a> e descompactar numa pasta.</li>
          <li>No Chrome: <code>chrome://extensions</code> → ligar <b>Modo do desenvolvedor</b> → <b>Carregar sem compactação</b> → escolher a pasta.</li>
          <li>Fixar o ícone 🔥, entrar com e-mail e senha da conta abaixo.</li>
          <li>Abrir o painel de pedidos do sistema dele (Saipos, Cardápio Web…) e clicar <b>Marcar coluna</b> na extensão, em cada coluna que conta pedido na cozinha (ex.: "Em preparo" e "Pronto").</li>
          <li>Deixar abertos e logados o <b>Portal do Parceiro</b> e/ou o <b>99Food Admin</b> na conta das lojas, e marcar na extensão <b>quais lojas</b> mudam de prazo. Todas as lojas têm que estar no mesmo login.</li>
        </ol>
        <div style={{ marginTop: 8, color: "#7C2D12" }}>
          Cakto: webhook em <code>https://firehubfood.com.br/api/prazos/cakto?s=SEGREDO</code>, com o mesmo SEGREDO na env
          <code> CAKTO_WEBHOOK_SECRET</code> do Coolify. Compra aprovada cria a conta e manda a senha por e-mail; sem pagamento vira BLOQUEADO e a extensão para.
          A cota de lojas vem do nome da oferta ("3 lojas") — ou ajuste aqui na coluna <b>Lojas</b>.
        </div>
      </div>

      {/* ── Nova conta ──────────────────────────────────────────────────── */}
      <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 12, padding: "1rem 1.25rem", marginBottom: "1.25rem" }}>
        <div style={{ fontWeight: 800, marginBottom: 10 }}>Nova conta</div>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1.2fr 1.5fr 1.2fr .9fr .6fr .6fr", gap: 8, alignItems: "center" }}>
          <input style={input} placeholder="e-mail" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <input style={input} placeholder="senha (mín. 6)" value={form.senha} onChange={(e) => setForm({ ...form, senha: e.target.value })} />
          <input style={input} placeholder="nome da loja" value={form.nomeLoja} onChange={(e) => setForm({ ...form, nomeLoja: e.target.value })} />
          <input style={input} placeholder="WhatsApp (lead)" value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} />
          <select style={input} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            <option>PILOTO</option><option>ATIVO</option><option>BLOQUEADO</option><option>CANCELADO</option>
          </select>
          <input style={input} type="number" min={1} max={50} title="motoboys" value={form.motoboys} onChange={(e) => setForm({ ...form, motoboys: Number(e.target.value) || 1 })} />
          <input style={input} type="number" min={1} max={50} title="lojas incluídas no plano" value={form.lojasIncluidas} onChange={(e) => setForm({ ...form, lojasIncluidas: Number(e.target.value) || 1 })} />
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
          <input style={{ ...input, flex: 1 }} placeholder="observações (sistema que usa, quem indicou…)" value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} />
          <button onClick={criar} disabled={salvando} style={{ ...botao("#FF5722"), padding: "9px 16px", fontSize: ".85rem" }}>
            {salvando ? "Criando…" : "Criar conta"}
          </button>
        </div>
        <div style={{ color: "#94A3B8", fontSize: ".72rem", marginTop: 4 }}>Colunas numéricas: motoboys · lojas incluídas no plano (por plataforma).</div>
        {erro && <div style={{ color: "#B91C1C", fontWeight: 700, marginTop: 8, fontSize: ".85rem" }}>{erro}</div>}
      </div>

      {/* ── Lista ───────────────────────────────────────────────────────── */}
      <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 12, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".84rem" }}>
          <thead>
            <tr style={{ background: "#F8FAFC", textAlign: "left" }}>
              {["Conta", "Status", "Motoboys", "Lojas", "Último sinal da extensão", "Ações"].map((h) => (
                <th key={h} style={{ padding: "10px 12px", borderBottom: "1px solid #E2E8F0", fontSize: ".72rem", textTransform: "uppercase", color: "#64748B" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {carregando && <tr><td colSpan={6} style={{ padding: 16, color: "#64748B" }}>Carregando…</td></tr>}
            {!carregando && contas.length === 0 && <tr><td colSpan={6} style={{ padding: 16, color: "#64748B" }}>Nenhuma conta ainda.</td></tr>}
            {contas.map((c) => {
              const u = c.ultimoEstado || {};
              const cor = COR_DO_STATUS[c.status] || COR_DO_STATUS.CANCELADO;
              const colunas = Array.isArray(u.colunas) ? u.colunas.map((x: any) => `${x.rotulo} ${x.n}`).join(" · ") : "";
              const receitas = c.config?.receitas ? Object.keys(c.config.receitas) : [];
              const lojasIfood: any[] = (c.config?.lojasIfood || []).filter((l: any) => l.ativa);
              const lojas99: any[] = (c.config?.lojas99 || []).filter((l: any) => l.ativa);
              const relatoIfood: any[] = u.lojas?.ifood || [];
              const relato99: any[] = u.lojas?.n99 || [];
              const cota = c.lojasIncluidas || 1;
              return (
                <tr key={c.id} style={{ borderBottom: "1px solid #F1F5F9", verticalAlign: "top" }}>
                  <td style={{ padding: "10px 12px" }}>
                    <div style={{ fontWeight: 800 }}>{c.nomeLoja}</div>
                    <div style={{ color: "#475569" }}>{c.email}</div>
                    {c.whatsapp && <div style={{ color: "#475569" }}>📱 {c.whatsapp}</div>}
                    <div style={{ color: "#94A3B8", fontSize: ".72rem" }}>
                      criada {haQuanto(c.createdAt)} por {c.criadoPor || "?"}{c.caktoRef ? ` · Cakto ${c.caktoRef.slice(0, 12)}` : ""}
                    </div>
                    {c.observacoes && <div style={{ color: "#64748B", fontSize: ".75rem", marginTop: 2 }}>{c.observacoes}</div>}
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <span style={{ background: cor.bg, color: cor.fg, fontWeight: 800, padding: "3px 8px", borderRadius: 8, fontSize: ".74rem" }}>{c.status}</span>
                    <div style={{ color: c.config?.roboLigado ? "#15803D" : "#B45309", fontSize: ".72rem", marginTop: 4, fontWeight: 700 }}>
                      {c.config?.roboLigado ? "🤖 robô ligado" : "⏸️ robô desligado"}
                    </div>
                    <div style={{ color: "#64748B", fontSize: ".72rem" }}>modo {c.config?.modo || "auto"}{receitas.length ? ` · painel: ${receitas.join(", ")}` : " · nenhuma coluna marcada"}</div>
                    <div style={{ color: "#64748B", fontSize: ".72rem" }}>99: {c.config?.preparo99?.modo === "faixas" ? "faixas próprias" : `iFood − ${c.config?.preparo99?.desconto ?? 15} min`}</div>
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <button style={botao("#E2E8F0", "#0F172A")} onClick={() => alterar(c.id, { motoboys: Math.max(1, c.motoboys - 1) })}>−</button>
                      <b>{c.motoboys}</b>
                      <button style={botao("#E2E8F0", "#0F172A")} onClick={() => alterar(c.id, { motoboys: c.motoboys + 1 })}>+</button>
                    </div>
                  </td>
                  <td style={{ padding: "10px 12px", minWidth: 200 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                      <button style={botao("#E2E8F0", "#0F172A")} title="lojas incluídas no plano" onClick={() => alterar(c.id, { lojasIncluidas: Math.max(1, cota - 1) })}>−</button>
                      <b>{cota}</b> <span style={{ color: "#64748B", fontSize: ".72rem" }}>no plano</span>
                      <button style={botao("#E2E8F0", "#0F172A")} onClick={() => alterar(c.id, { lojasIncluidas: Math.min(50, cota + 1) })}>+</button>
                    </div>
                    <div style={{ fontSize: ".74rem", color: "#475569" }}>
                      🛵 {lojasIfood.length ? lojasIfood.map((l) => {
                        const r = relatoIfood.find((x) => x.id === l.uuid);
                        return <span key={l.uuid} title={r?.erro || ""} style={{ color: r ? (r.ok ? "#15803D" : "#B91C1C") : "#475569" }}>{l.nome}{r ? (r.ok ? ` ✓${r.minutos}` : " ✗") : ""}</span>;
                      }).reduce((acc: any[], el, i) => (i ? [...acc, " · ", el] : [el]), []) : <span style={{ color: "#94A3B8" }}>nenhuma iFood</span>}
                    </div>
                    <div style={{ fontSize: ".74rem", color: "#475569" }}>
                      🟡 {lojas99.length ? lojas99.map((l) => {
                        const r = relato99.find((x) => x.id === l.shopId);
                        return <span key={l.shopId} title={r?.erro || ""} style={{ color: r ? (r.ok ? "#15803D" : "#B91C1C") : "#475569" }}>{l.nome}{r ? (r.ok ? ` ✓${r.minutos}` : " ✗") : ""}</span>;
                      }).reduce((acc: any[], el, i) => (i ? [...acc, " · ", el] : [el]), []) : <span style={{ color: "#94A3B8" }}>nenhuma 99Food</span>}
                    </div>
                  </td>
                  <td style={{ padding: "10px 12px", minWidth: 260 }}>
                    {u.visto ? (
                      <>
                        <div><b>{haQuanto(u.visto)}</b>{u.host ? ` · ${u.host}` : ""}{u.versao ? ` · v${u.versao}` : ""}{u.lendo === false ? " · painel sem leitura" : ""}</div>
                        <div>{typeof u.pedidos === "number" ? `${u.pedidos} pedidos → iFood ${u.minutos} min${u.pausar ? " + PAUSAR" : ""}${typeof u.preparo99 === "number" ? ` · 99 preparo ${u.preparo99} min` : ""}` : "sem leitura"}</div>
                        {colunas && <div style={{ color: "#64748B", fontSize: ".75rem" }}>{colunas}</div>}
                        {u.aplicadoEm && <div style={{ color: u.aplicadoOk === false ? "#B91C1C" : "#15803D", fontSize: ".75rem" }}>aplicado {u.aplicadoOk === false ? "com falha" : "ok"} {haQuanto(u.aplicadoEm)}</div>}
                        {u.erro && <div style={{ color: "#B91C1C", fontSize: ".75rem" }}>⚠️ {u.erro}</div>}
                      </>
                    ) : (
                      <span style={{ color: "#94A3B8" }}>extensão nunca conectou</span>
                    )}
                  </td>
                  <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {c.status !== "ATIVO" && <button style={botao("#16A34A")} onClick={() => alterar(c.id, { status: "ATIVO" })}>Ativar</button>}
                      {c.status !== "PILOTO" && <button style={botao("#2563EB")} onClick={() => alterar(c.id, { status: "PILOTO" })}>Piloto</button>}
                      {c.status !== "BLOQUEADO" && <button style={botao("#DC2626")} onClick={() => alterar(c.id, { status: "BLOQUEADO" })}>Bloquear</button>}
                      <button style={botao("#475569")} onClick={() => novaSenha(c)}>Nova senha</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
