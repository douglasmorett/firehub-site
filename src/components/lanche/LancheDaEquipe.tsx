"use client";
/**
 * A tela do lanche dos motoboys (app/loja/[slug]/equipe; regras em
 * lib/lanche-da-equipe.ts).
 *
 * Login com o telefone e a senha do app do entregador — a mesma sessão da
 * página /loja/<slug>/motoboy (a chave do localStorage é a mesma). Logado, o
 * motoboy vê o cardápio do site (CustomerStorePage no modo "equipe"), o que
 * ainda cabe no lanche de hoje e o "Meus lanches": cada pedido com o dia, a
 * hora, os itens, o que ficou no combinado e o que foi descontado.
 *
 * Com "1 bebida por dia no crédito" ligado, a segunda bebida do dia pede o
 * "Aceito" antes de sair (CustomerStorePage, enviarLancheDaEquipe).
 */
import { useCallback, useEffect, useState } from "react";
import CustomerStorePage, { type EquipeNoCardapio } from "@/components/customer/CustomerStorePage";
import type { BebidasDoCardapio } from "@/lib/lanche-da-equipe-regras";

type Sessao = { motoboyId: string; motoboyName: string; storeId: string; storeName?: string; token?: string };

type Lanche = {
  pedidoId: string; numero: number | null; dia: string; em: string; levar: boolean;
  valor: number; coberto: number; excedente: number; fiado?: number; cancelado: boolean;
  itens: { qtd: number; nome: string; opcoes: string[] }[];
};

type Resumo = {
  motoboy: { nome: string };
  ativo: boolean;
  limite: number;
  umaBebidaPorDia?: boolean;
  fuso: string;
  hoje: { dia: string; usado: number; bebidas?: number; restante: number };
  mes: { lanches: number; descontado: number };
  lanches: Lanche[];
};

const reais = (v: number) => `R$ ${(Number(v) || 0).toFixed(2).replace(".", ",")}`;

export default function LancheDaEquipe({ slug, cardapio, bebidas = null }: { slug: string; cardapio: any; bebidas?: BebidasDoCardapio | null }) {
  const chave = `firehub_motoboy_session_${slug}`;
  const [sessao, setSessao] = useState<Sessao | null>(null);
  const [pronto, setPronto] = useState(false);
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [erro, setErro] = useState("");
  const [verLanches, setVerLanches] = useState(false);

  useEffect(() => {
    try {
      const salvo = JSON.parse(localStorage.getItem(chave) || "null");
      // Sessão antiga, sem o token assinado, não serve: entra de novo.
      if (salvo?.token) setSessao(salvo);
    } catch { /* sem storage */ }
    setPronto(true);
  }, [chave]);

  const sair = useCallback(() => {
    try { localStorage.removeItem(chave); } catch { /* sem storage */ }
    setSessao(null);
    setResumo(null);
  }, [chave]);

  const carregar = useCallback(async () => {
    if (!sessao?.token) return;
    try {
      const r = await fetch("/api/loja/equipe/resumo", { headers: { Authorization: `Bearer ${sessao.token}` }, cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (r.status === 401) { sair(); return; }
      if (!r.ok) throw new Error(j.error || "Não deu para carregar.");
      setResumo(j);
      setErro("");
    } catch (e: any) {
      setErro(e?.message || "Sem conexão.");
    }
  }, [sessao, sair]);
  useEffect(() => { carregar(); }, [carregar]);

  if (!pronto) return null;
  if (!sessao) return <Entrar slug={slug} loja={cardapio?.franchisee?.storeName || ""} onEntrou={(s) => { try { localStorage.setItem(chave, JSON.stringify(s)); } catch { /* */ } setSessao(s); }} />;

  if (!resumo) {
    return (
      <Centro>
        {erro ? <><p style={{ color: "#B91C1C", fontWeight: 700 }}>{erro}</p><button onClick={carregar} style={botao}>Tentar de novo</button></> : <p style={{ color: "#64748B" }}>Carregando…</p>}
      </Centro>
    );
  }
  if (!resumo.ativo) {
    return (
      <Centro>
        <div style={{ fontSize: 40 }}>🍔</div>
        <h1 style={{ fontSize: "1.2rem", margin: "8px 0" }}>O lanche pelo sistema está desligado</h1>
        <p style={{ color: "#475569" }}>Fale com o gerente.</p>
        <button onClick={sair} style={{ ...botao, background: "#F1F5F9", color: "#334155" }}>Sair</button>
      </Centro>
    );
  }

  const equipe: EquipeNoCardapio = {
    nome: resumo.motoboy.nome,
    limite: resumo.limite,
    usadoHoje: resumo.hoje.usado,
    umaBebidaPorDia: resumo.umaBebidaPorDia === true,
    bebidasHoje: Number(resumo.hoje.bebidas) || 0,
    bebidas,
    enviar: async ({ itens, levar, observacao, aceitouBebidaFora }) => {
      try {
        const r = await fetch("/api/loja/equipe/pedido", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessao.token}` },
          body: JSON.stringify({ itens, levar, observacao, aceitouBebidaFora: aceitouBebidaFora === true }),
        });
        const j = await r.json().catch(() => ({}));
        if (r.status === 401) { sair(); return { ok: false, erro: "Sua sessão acabou. Entre de novo." }; }
        if (!r.ok) {
          // A conta mudou entre a tela e o servidor (outro lanche hoje): recarrega e pergunta.
          if (j.codigo) carregar();
          return { ok: false, erro: j.error || "O lanche não foi enviado.", codigo: j.codigo, valorDasBebidasFora: Number(j.valorDasBebidasFora) || 0 };
        }
        carregar();
        return { ok: true, numero: j.numero ?? null, excedente: Number(j.excedente) || 0, fiado: Number(j.fiado) || 0, restante: Number(j.restante) || 0 };
      } catch {
        return { ok: false, erro: "Sem conexão. Confira a internet e tente de novo." };
      }
    },
    topo: (
      <div style={{ background: "linear-gradient(135deg,#7C2D12,#C2410C)", color: "#fff", padding: "0.75rem 1rem" }}>
        <div style={{ maxWidth: 900, margin: "0 auto", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", justifyContent: "space-between" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 900, fontSize: "0.95rem" }}>🍔 Lanche da equipe — {resumo.motoboy.nome}</div>
            <div style={{ fontSize: "0.82rem", opacity: 0.95, marginTop: 2 }}>
              Hoje: {reais(resumo.hoje.usado)} de {reais(resumo.limite)} ·{" "}
              {resumo.hoje.restante > 0 ? <strong>restam {reais(resumo.hoje.restante)}</strong> : <strong>limite do dia usado — o que pedir é descontado no acerto</strong>}
            </div>
            {resumo.umaBebidaPorDia && (
              <div style={{ fontSize: "0.8rem", opacity: 0.95, marginTop: 2 }}>
                🥤 1 bebida por dia no crédito · {(Number(resumo.hoje.bebidas) || 0) > 0 ? <strong>a de hoje já foi — outra vai para o seu fiado</strong> : <strong>a de hoje ainda está livre</strong>}
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => setVerLanches(true)} style={{ ...botaoTopo, background: "#fff", color: "#9A3412" }}>📋 Meus lanches</button>
            <button onClick={sair} style={{ ...botaoTopo, background: "rgba(255,255,255,0.18)", color: "#fff" }}>Sair</button>
          </div>
        </div>
      </div>
    ),
  };

  return (
    <>
      <CustomerStorePage
        {...cardapio}
        mesa={{ codigo: "equipe", mesaId: "equipe", numero: null, rotulo: null, mesas: [], equipe }}
      />
      {verLanches && <MeusLanches resumo={resumo} onFechar={() => setVerLanches(false)} />}
    </>
  );
}

// ── Entrar ───────────────────────────────────────────────────────────────────

function Entrar({ slug, loja, onEntrou }: { slug: string; loja: string; onEntrou: (s: Sessao) => void }) {
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [erro, setErro] = useState("");
  const [entrando, setEntrando] = useState(false);

  const entrar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone.trim() || !password) { setErro("Informe o telefone e a senha."); return; }
    setEntrando(true);
    setErro("");
    try {
      const r = await fetch("/api/motoboys/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeSlug: slug, phone, password }),
      });
      const d = await r.json().catch(() => ({}));
      const motoboyId = d.motoboy?.id || d.motoboyId;
      const storeId = d.store?.id || d.storeId;
      if (!r.ok || !d.success || !motoboyId || !d.token) { setErro(d.error || "Telefone ou senha errados."); return; }
      onEntrou({ motoboyId, motoboyName: d.motoboy?.name || d.motoboyName, storeId, storeName: d.store?.name || d.storeName, token: d.token });
    } catch {
      setErro("Sem conexão. Tente de novo.");
    } finally {
      setEntrando(false);
    }
  };

  return (
    <Centro>
      <div style={{ fontSize: 44 }} aria-hidden>🍔</div>
      <h1 style={{ fontSize: "1.3rem", margin: "6px 0 2px", color: "#0F172A" }}>Lanche da equipe</h1>
      {loja && <p style={{ margin: 0, color: "#64748B", fontWeight: 600 }}>{loja}</p>}
      <p style={{ color: "#475569", fontSize: "0.9rem", lineHeight: 1.45, margin: "10px 0 16px" }}>
        Entre com o <strong>telefone e a senha do app do motoboy</strong>. O lanche vai direto para a cozinha.
      </p>
      <form onSubmit={entrar} style={{ display: "grid", gap: 10, textAlign: "left" }}>
        <label style={rotulo}>Telefone
          <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="username" placeholder="(22) 99999-9999" style={campo} />
        </label>
        <label style={rotulo}>Senha
          <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="current-password" style={campo} />
        </label>
        {erro && <div style={{ color: "#B91C1C", fontWeight: 700, fontSize: "0.85rem" }}>{erro}</div>}
        <button type="submit" disabled={entrando} style={{ ...botao, opacity: entrando ? 0.7 : 1 }}>{entrando ? "Entrando…" : "Entrar"}</button>
      </form>
    </Centro>
  );
}

// ── Meus lanches ─────────────────────────────────────────────────────────────

function MeusLanches({ resumo, onFechar }: { resumo: Resumo; onFechar: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onFechar(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onFechar]);

  const porDia = new Map<string, Lanche[]>();
  for (const l of resumo.lanches) porDia.set(l.dia, [...(porDia.get(l.dia) || []), l]);
  const diaBonito = (d: string) => {
    const [a, m, dd] = d.split("-").map(Number);
    const data = new Date(Date.UTC(a, m - 1, dd, 12));
    return data.toLocaleDateString("pt-BR", { timeZone: "UTC", weekday: "long", day: "2-digit", month: "2-digit" });
  };
  const hora = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { timeZone: resumo.fuso, hour: "2-digit", minute: "2-digit" });

  return (
    <div role="dialog" aria-modal="true" onClick={onFechar} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", zIndex: 2000, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#F8FAFC", width: "min(560px, 100%)", maxHeight: "88vh", overflowY: "auto", borderRadius: "18px 18px 0 0", padding: "16px 16px 24px", fontFamily: "inherit" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <h2 style={{ margin: 0, fontSize: "1.15rem", color: "#0F172A" }}>📋 Meus lanches</h2>
          <button onClick={onFechar} aria-label="Fechar" style={{ border: "none", background: "#E2E8F0", borderRadius: 10, padding: "6px 12px", fontWeight: 800, cursor: "pointer" }}>Fechar</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, margin: "12px 0" }}>
          <Numero titulo="Hoje" valor={`${reais(resumo.hoje.usado)} de ${reais(resumo.limite)}`} />
          <Numero titulo="Descontado no mês" valor={reais(resumo.mes.descontado)} cor={resumo.mes.descontado > 0 ? "#B91C1C" : "#0F172A"} />
        </div>
        {resumo.lanches.length === 0 && <p style={{ color: "#64748B", textAlign: "center", padding: "20px 0" }}>Nenhum lanche nos últimos 31 dias.</p>}
        {[...porDia.entries()].map(([dia, lanches]) => {
          const valendo = lanches.filter((l) => !l.cancelado);
          const total = valendo.reduce((t, l) => t + l.valor, 0);
          const descontado = valendo.reduce((t, l) => t + l.excedente, 0);
          return (
            <section key={dia} style={{ marginTop: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, borderBottom: "1.5px solid #E2E8F0", paddingBottom: 4 }}>
                <strong style={{ textTransform: "capitalize", color: "#0F172A" }}>{diaBonito(dia)}{dia === resumo.hoje.dia ? " (hoje)" : ""}</strong>
                <span style={{ fontSize: "0.8rem", color: descontado > 0 ? "#B91C1C" : "#475569", fontWeight: 700 }}>
                  {reais(total)}{descontado > 0 ? ` · descontado ${reais(descontado)}` : " · no combinado"}
                </span>
              </div>
              {lanches.map((l) => (
                <div key={l.pedidoId} style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 12, padding: "10px 12px", marginTop: 8, opacity: l.cancelado ? 0.55 : 1 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: "0.82rem", color: "#64748B", fontWeight: 700 }}>
                    <span>{hora(l.em)}{l.numero ? ` · pedido #${l.numero}` : ""} · {l.levar ? "🥡 levou" : "🍽️ comeu na loja"}</span>
                    {l.cancelado && <span style={{ color: "#B91C1C" }}>CANCELADO</span>}
                  </div>
                  <ul style={{ margin: "6px 0", paddingLeft: 18, color: "#0F172A", fontSize: "0.9rem" }}>
                    {l.itens.map((i, k) => (
                      <li key={k}>{i.qtd}× {i.nome}{i.opcoes.length ? <span style={{ color: "#64748B" }}> ({i.opcoes.join(", ")})</span> : null}</li>
                    ))}
                  </ul>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: "0.85rem", borderTop: "1px dashed #E2E8F0", paddingTop: 6 }}>
                    <span>Total {reais(l.valor)} · no combinado {reais(l.coberto)}{(l.fiado || 0) > 0 && !l.cancelado ? ` · 🥤 ${reais(l.fiado || 0)} no fiado` : ""}</span>
                    <strong style={{ color: l.excedente > 0 && !l.cancelado ? "#B91C1C" : "#047857" }}>
                      {l.cancelado ? "não conta" : l.excedente > 0 ? `descontado ${reais(l.excedente)}` : "sem desconto"}
                    </strong>
                  </div>
                </div>
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Numero({ titulo, valor, cor = "#0F172A" }: { titulo: string; valor: string; cor?: string }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 12, padding: "10px 12px" }}>
      <div style={{ fontSize: "0.7rem", fontWeight: 800, color: "#64748B", textTransform: "uppercase" }}>{titulo}</div>
      <div style={{ fontWeight: 900, color: cor, marginTop: 2 }}>{valor}</div>
    </div>
  );
}

function Centro({ children }: { children: React.ReactNode }) {
  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, background: "#FFF7ED", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ width: "min(380px, 100%)", textAlign: "center", background: "#fff", borderRadius: 18, padding: "1.6rem 1.25rem", boxShadow: "0 8px 30px rgba(15,23,42,0.08)" }}>
        {children}
      </div>
    </main>
  );
}

const botao: React.CSSProperties = { padding: "12px 16px", borderRadius: 12, border: "none", background: "#C2410C", color: "#fff", fontWeight: 900, fontSize: "1rem", cursor: "pointer", fontFamily: "inherit" };
const botaoTopo: React.CSSProperties = { padding: "8px 12px", borderRadius: 10, border: "none", fontWeight: 800, fontSize: "0.85rem", cursor: "pointer", fontFamily: "inherit" };
const rotulo: React.CSSProperties = { display: "grid", gap: 4, fontSize: "0.8rem", fontWeight: 700, color: "#475569" };
const campo: React.CSSProperties = { padding: "11px 12px", borderRadius: 10, border: "1.5px solid #CBD5E1", fontSize: "1rem", fontFamily: "inherit" };
