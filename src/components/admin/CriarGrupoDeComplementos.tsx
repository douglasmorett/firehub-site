"use client";

/**
 * "Criar grupo de complementos" — aba Complementos do cardápio, copiando os
 * 3 passos do iFood (Portal do Parceiro, 07/11/2026):
 *   1. Sobre o grupo: nome da pergunta, obrigatória ou opcional, mínimo e máximo.
 *   2. Complementos: as opções (item do cardápio ou um novo, criado ali) e o acréscimo.
 *   3. Disponível em: em quais produtos a pergunta entra.
 * Grava pela rota /api/admin/menu-products/pergunta (uma cópia por produto).
 */
import { useMemo, useState } from "react";
import { Check, Plus, Search, Trash2, X } from "lucide-react";
import EscolhaDePergunta from "./EscolhaDePergunta";

type Opcao = { id: string; nome: string; acrescimo: string };
const PASSOS = ["Sobre o grupo", "Complementos", "Disponível em"];

export default function CriarGrupoDeComplementos({ produtos, catalogo, categorias, onFechar, onFeito, onUsarExistente }: {
  /** Produtos de venda (itens e combos) onde a pergunta pode entrar. */
  produtos: any[];
  /** Cardápio inteiro (com as opções de combo), para escolher os complementos. */
  catalogo: any[];
  categorias: { name: string }[];
  onFechar: () => void;
  onFeito: (texto: string) => void;
  onUsarExistente: () => void;
}) {
  const [criandoDoZero, setCriandoDoZero] = useState(false);
  const [passo, setPasso] = useState(0);
  const [titulo, setTitulo] = useState("");
  const [obrigatoria, setObrigatoria] = useState(false);
  const [minimo, setMinimo] = useState("1");
  const [maximo, setMaximo] = useState("1");
  const [opcoes, setOpcoes] = useState<Opcao[]>([]);
  const [busca, setBusca] = useState("");
  const [novo, setNovo] = useState<{ nome: string; acrescimo: string } | null>(null);
  const [criando, setCriando] = useState(false);
  const [buscaProduto, setBuscaProduto] = useState("");
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const candidatos = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return catalogo
      .filter(p => p?.id && !opcoes.some(o => o.id === p.id))
      .filter(p => !t || String(p.name || "").toLowerCase().includes(t))
      .slice(0, 12);
  }, [catalogo, busca, opcoes]);
  const destinos = useMemo(() => {
    const t = buscaProduto.trim().toLowerCase();
    return produtos.filter(p => !opcoes.some(o => o.id === p.id)).filter(p => !t || String(p.name || "").toLowerCase().includes(t));
  }, [produtos, buscaProduto, opcoes]);

  const problema = (): string | null => {
    if (passo === 0) {
      if (!titulo.trim()) return "Dê um nome à pergunta. Ex.: \"Deseja adicionais?\"";
      const mi = obrigatoria ? Math.max(1, parseInt(minimo) || 1) : 0;
      const ma = parseInt(maximo) || 1;
      if (ma < 1) return "O máximo tem que ser pelo menos 1.";
      if (mi > ma) return "O mínimo não pode passar do máximo.";
    }
    if (passo === 1 && opcoes.length === 0) return "Adicione pelo menos um complemento.";
    if (passo === 2 && marcados.size === 0) return "Marque pelo menos um produto.";
    return null;
  };
  const avancar = () => { const p = problema(); if (p) { setErro(p); return; } setErro(null); setPasso(x => x + 1); };

  const criarNovo = async () => {
    if (!novo) return;
    const nome = novo.nome.trim();
    if (!nome) { setErro("Dê um nome ao complemento."); return; }
    setCriando(true);
    try {
      const categoriaDeOpcoes = categorias.find(c => c.name.trim().toLowerCase() === "adicionais")?.name || "Adicionais";
      const res = await fetch("/api/admin/menu-products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nome, description: nome, price: 0, category: categoriaDeOpcoes, active: true, isCombo: false, isBeverage: false, apenasEmCombo: true }),
      });
      const criado = await res.json().catch(() => null);
      if (!res.ok || !criado?.id) { setErro("Não consegui cadastrar o complemento."); return; }
      setOpcoes(prev => [...prev, { id: criado.id, nome, acrescimo: novo.acrescimo }]);
      setNovo(null); setErro(null);
    } finally { setCriando(false); }
  };

  const salvar = async () => {
    const p = problema(); if (p) { setErro(p); return; }
    setSalvando(true);
    try {
      const res = await fetch("/api/admin/menu-products/pergunta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          produtoIds: [...marcados],
          title: titulo.trim(),
          minQty: obrigatoria ? Math.max(1, parseInt(minimo) || 1) : 0,
          maxQty: parseInt(maximo) || 1,
          items: opcoes.map(o => ({ menuProductId: o.id, additionalPrice: parseFloat(o.acrescimo.replace(",", ".")) || 0 })),
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErro(d?.error || "Não consegui salvar."); return; }
      onFeito(`✅ "${titulo.trim()}" criada em ${d.criados} produto${d.criados === 1 ? "" : "s"}.`);
    } finally { setSalvando(false); }
  };

  const campo: React.CSSProperties = { width: "100%", padding: "10px 12px", borderRadius: 10, border: "1.5px solid #CBD5E1", fontSize: "0.9rem", fontFamily: "inherit", boxSizing: "border-box" };
  const chip = (ativo: boolean): React.CSSProperties => ({ flex: 1, padding: "10px 14px", borderRadius: 10, border: `1.5px solid ${ativo ? "#E8360C" : "#CBD5E1"}`, background: ativo ? "#FFF4EF" : "#FFF", color: ativo ? "#C92E09" : "#64748B", fontWeight: 800, fontSize: "0.85rem", cursor: "pointer", fontFamily: "inherit", textAlign: "left" });

  if (!criandoDoZero) return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100000, background: "rgba(15,23,42,0.75)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div role="dialog" aria-modal="true" aria-label="Adicionar pergunta" style={{ background: "#FFF", borderRadius: 20, width: "100%", maxWidth: 640, maxHeight: "90vh", overflowY: "auto", padding: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: "1.2rem", color: "#0F172A" }}>Perguntas do cardápio</h2>
          <button type="button" onClick={onFechar} aria-label="Fechar" style={{ border: "none", background: "#F1F5F9", borderRadius: "50%", width: 36, height: 36, cursor: "pointer" }}><X size={18} /></button>
        </div>
        <EscolhaDePergunta onUsarExistente={onUsarExistente} onCriarNova={() => setCriandoDoZero(true)} />
      </div>
    </div>
  );

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100000, background: "rgba(15, 23, 42, 0.75)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
      <div style={{ background: "#FFF", borderRadius: 24, width: "100%", maxWidth: 640, maxHeight: "90vh", overflowY: "auto", padding: "1.5rem", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.4)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <div>
            <span style={{ fontSize: "0.72rem", background: "#FAF6F2", color: "#1C1917", fontWeight: 800, padding: "3px 10px", borderRadius: 20, textTransform: "uppercase", letterSpacing: "0.5px" }}>🧩 Grupo de complementos</span>
            <h2 style={{ fontSize: "1.3rem", fontWeight: 800, color: "#0F172A", margin: "6px 0 0" }}>{titulo.trim() || "Novo grupo"}</h2>
          </div>
          <button type="button" onClick={onFechar} style={{ width: 36, height: 36, borderRadius: "50%", background: "#F1F5F9", border: "none", color: "#64748B", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }} title="Fechar"><X size={20} /></button>
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: "1.25rem" }}>
          {PASSOS.map((r, i) => {
            const ativa = passo === i, feita = passo > i;
            return (
              <button key={r} type="button" onClick={() => { if (feita) setPasso(i); }}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 999, border: `1.5px solid ${ativa ? "#E8360C" : feita ? "#0F766E" : "#E2E8F0"}`, background: ativa ? "#FFF4EF" : feita ? "#F0FDFA" : "#FFF", color: ativa ? "#C92E09" : feita ? "#0F766E" : "#64748B", fontWeight: 800, fontSize: "0.8rem", cursor: feita ? "pointer" : "default", fontFamily: "inherit" }}>
                <span style={{ width: 20, height: 20, borderRadius: "50%", background: ativa ? "#E8360C" : feita ? "#0F766E" : "#E2E8F0", color: ativa || feita ? "#FFF" : "#64748B", fontSize: "0.7rem", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{feita ? "✓" : i + 1}</span>
                {r}
              </button>
            );
          })}
        </div>

        {passo === 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <label style={{ fontWeight: 700, fontSize: "0.85rem", color: "#334155" }}>
              Nome da pergunta
              <input style={{ ...campo, marginTop: 6 }} placeholder='Ex: "Deseja adicionais?" ou "Escolha o molho"' value={titulo} onChange={e => setTitulo(e.target.value)} autoFocus />
            </label>
            <div>
              <p style={{ fontWeight: 700, fontSize: "0.85rem", color: "#334155", margin: "0 0 6px" }}>O cliente é obrigado a escolher?</p>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" style={chip(!obrigatoria)} onClick={() => setObrigatoria(false)}>Opcional<span style={{ display: "block", fontSize: "0.72rem", fontWeight: 500, color: "#64748B" }}>Pode pular (adicionais, molhos)</span></button>
                <button type="button" style={chip(obrigatoria)} onClick={() => { setObrigatoria(true); if ((parseInt(minimo) || 0) < 1) setMinimo("1"); }}>Obrigatória<span style={{ display: "block", fontSize: "0.72rem", fontWeight: 500, color: "#64748B" }}>Tem que marcar (tamanho, ponto da carne)</span></button>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <label style={{ fontWeight: 700, fontSize: "0.85rem", color: "#334155" }}>
                Mínimo
                <input style={{ ...campo, marginTop: 6 }} type="number" min={obrigatoria ? 1 : 0} value={obrigatoria ? minimo : "0"} disabled={!obrigatoria} onChange={e => setMinimo(e.target.value)} />
              </label>
              <label style={{ fontWeight: 700, fontSize: "0.85rem", color: "#334155" }}>
                Máximo
                <input style={{ ...campo, marginTop: 6 }} type="number" min={1} value={maximo} onChange={e => setMaximo(e.target.value)} />
              </label>
            </div>
            <p style={{ margin: 0, fontSize: "0.76rem", color: "#64748B" }}>Máximo 1 = o cliente escolhe uma só (tamanho, massa). Máximo 3 = até três (adicionais).</p>
          </div>
        )}

        {passo === 1 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {opcoes.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {opcoes.map(o => (
                  <div key={o.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 10 }}>
                    <span style={{ flex: 1, fontWeight: 700, fontSize: "0.88rem", color: "#0F172A" }}>{o.nome}</span>
                    <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "0.78rem", color: "#475569", fontWeight: 700 }}>
                      + R$
                      <input style={{ ...campo, width: 90, padding: "6px 8px" }} inputMode="decimal" placeholder="0,00" value={o.acrescimo} onChange={e => setOpcoes(prev => prev.map(x => x.id === o.id ? { ...x, acrescimo: e.target.value } : x))} />
                    </label>
                    <button type="button" onClick={() => setOpcoes(prev => prev.filter(x => x.id !== o.id))} style={{ border: "none", background: "#FEF2F2", color: "#C92E09", borderRadius: 8, padding: 6, cursor: "pointer" }} title="Tirar"><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
            )}
            <div style={{ position: "relative" }}>
              <Search size={16} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#94A3B8" }} />
              <input style={{ ...campo, paddingLeft: 32 }} placeholder="Buscar um item do cardápio para usar como complemento…" value={busca} onChange={e => setBusca(e.target.value)} />
            </div>
            {busca.trim() && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 200, overflowY: "auto" }}>
                {candidatos.map(p => (
                  <button key={p.id} type="button" onClick={() => { setOpcoes(prev => [...prev, { id: p.id, nome: p.name, acrescimo: "" }]); setBusca(""); }}
                    style={{ textAlign: "left", padding: "8px 10px", borderRadius: 8, border: "1px solid #E2E8F0", background: "#FFF", cursor: "pointer", fontFamily: "inherit", fontSize: "0.85rem", display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontWeight: 700, color: "#0F172A" }}>{p.name}</span>
                    <span style={{ color: "#94A3B8", fontSize: "0.75rem" }}>{p.category}</span>
                  </button>
                ))}
                {candidatos.length === 0 && <p style={{ margin: 0, fontSize: "0.8rem", color: "#94A3B8" }}>Nada com esse nome. Crie um novo abaixo.</p>}
              </div>
            )}
            {novo ? (
              <div style={{ display: "flex", gap: 8, alignItems: "center", padding: 10, background: "#FFF4EF", border: "1.5px solid #FFD3C2", borderRadius: 10, flexWrap: "wrap" }}>
                <input style={{ ...campo, flex: "1 1 180px" }} placeholder="Nome do complemento (ex.: Bacon)" value={novo.nome} onChange={e => setNovo({ ...novo, nome: e.target.value })} autoFocus />
                <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "0.78rem", color: "#475569", fontWeight: 700 }}>+ R$
                  <input style={{ ...campo, width: 90, padding: "6px 8px" }} inputMode="decimal" placeholder="0,00" value={novo.acrescimo} onChange={e => setNovo({ ...novo, acrescimo: e.target.value })} />
                </label>
                <button type="button" onClick={criarNovo} disabled={criando} style={{ padding: "9px 14px", borderRadius: 10, border: "none", background: "#E8360C", color: "#FFF", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>{criando ? "Criando…" : "Criar"}</button>
                <button type="button" onClick={() => setNovo(null)} style={{ padding: "9px 10px", borderRadius: 10, border: "1px solid #CBD5E1", background: "#FFF", cursor: "pointer", fontFamily: "inherit" }}>Cancelar</button>
              </div>
            ) : (
              <button type="button" onClick={() => setNovo({ nome: busca.trim(), acrescimo: "" })} style={{ padding: "10px", borderRadius: 10, border: "1.5px dashed #CBD5E1", background: "#FFF", color: "#334155", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", display: "inline-flex", alignItems: "center", gap: 6, justifyContent: "center" }}>
                <Plus size={16} /> Criar complemento novo
              </button>
            )}
          </div>
        )}

        {passo === 2 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={{ margin: 0, fontSize: "0.82rem", color: "#475569" }}>Marque os produtos que vão ter a pergunta <strong>{titulo.trim()}</strong>. Ela entra no fim das perguntas de cada um.</p>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <div style={{ position: "relative", flex: 1 }}>
                <Search size={16} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#94A3B8" }} />
                <input style={{ ...campo, paddingLeft: 32 }} placeholder="Buscar produto…" value={buscaProduto} onChange={e => setBuscaProduto(e.target.value)} />
              </div>
              <button type="button" onClick={() => setMarcados(new Set(destinos.map(p => p.id)))} style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #CBD5E1", background: "#FFF", fontSize: "0.78rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>Marcar todos</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 320, overflowY: "auto" }}>
              {destinos.map(p => {
                const on = marcados.has(p.id);
                return (
                  <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8, border: `1px solid ${on ? "#E8360C" : "#E2E8F0"}`, background: on ? "#FFF4EF" : "#FFF", cursor: "pointer" }}>
                    <input type="checkbox" checked={on} onChange={e => setMarcados(prev => { const n = new Set(prev); e.target.checked ? n.add(p.id) : n.delete(p.id); return n; })} style={{ accentColor: "#E8360C" }} />
                    <span style={{ flex: 1, fontWeight: 700, fontSize: "0.85rem", color: "#0F172A" }}>{p.name}</span>
                    <span style={{ color: "#94A3B8", fontSize: "0.74rem" }}>{p.category}</span>
                  </label>
                );
              })}
            </div>
            <p style={{ margin: 0, fontSize: "0.78rem", color: "#64748B" }}>{marcados.size} {marcados.size === 1 ? "produto marcado" : "produtos marcados"}</p>
          </div>
        )}

        {erro && <p style={{ margin: "12px 0 0", fontSize: "0.8rem", color: "#C92E09", fontWeight: 700 }}>⚠️ {erro}</p>}

        <div style={{ display: "flex", gap: 10, marginTop: "1.5rem", borderTop: "1px solid #F1F5F9", paddingTop: "1rem" }}>
          <button type="button" onClick={onFechar} style={{ flex: 1, padding: 12, borderRadius: 12, background: "#F1F5F9", color: "#64748B", border: "none", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Cancelar</button>
          {passo > 0 && <button type="button" onClick={() => { setErro(null); setPasso(p => p - 1); }} style={{ flex: 1, padding: 12, borderRadius: 12, background: "#FFF", color: "#334155", border: "1.5px solid #CBD5E1", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>← Voltar</button>}
          {passo < PASSOS.length - 1 ? (
            <button type="button" onClick={avancar} style={{ flex: 2, padding: 12, borderRadius: 12, background: "linear-gradient(135deg, #E8360C, #C92E09)", color: "#FFF", border: "none", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>Continuar →</button>
          ) : (
            <button type="button" onClick={salvar} disabled={salvando} style={{ flex: 2, padding: 12, borderRadius: 12, background: "linear-gradient(135deg, #E8360C, #C92E09)", color: "#FFF", border: "none", fontWeight: 800, cursor: "pointer", fontFamily: "inherit", opacity: salvando ? 0.7 : 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              <Check size={16} /> {salvando ? "Salvando…" : "Criar grupo"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
