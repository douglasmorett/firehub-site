"use client";

import React, { useState, useEffect, useCallback } from "react";
import { novoIdDaTela } from "@/lib/kds-telas";
import { AvisoNoTopo, type Aviso } from "@/components/mesas/SelecionarItensParaImpressao";

interface KDSScreenConfig {
  id: string;
  name: string;
  stage: "production" | "finishing";
  filter: "all" | "odd" | "even";
  categoryFilter: string[]; // nomes das categorias filtradas (vazio = todas)
}

const STORAGE_KEY = "kds-screens";
const FONT = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`;

// O localStorage aqui é só a cópia deste aparelho (as telas valem do servidor).
// Navegador de TV e janela anônima podem bloquear o armazenamento: aí o
// getItem/setItem LANÇA, e um erro dentro do efeito deixava a lista em branco
// para sempre (o `loaded` nunca virava true). Sem armazenamento, segue sem a cópia.
function lerDoAparelho(chave: string): string | null {
  try { return localStorage.getItem(chave); } catch { return null; }
}
function gravarNoAparelho(chave: string, valor: string) {
  try { localStorage.setItem(chave, valor); } catch {}
}

export default function KDSHubClient() {
  const [screens, setScreens] = useState<KDSScreenConfig[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const fecharAviso = useCallback(() => setAviso(null), []);

  // Categorias disponíveis (carregadas da API)
  const [allCategories, setAllCategories] = useState<{ id: string; name: string; emoji: string; color: string }[]>([]);


  // Itens do iFood/integrações que o KDS não soube em que tela pôr.
  const [semCategoria, setSemCategoria] = useState<{ id: string; nome: string; plataforma: string }[]>([]);
  const [categoriasDaLoja, setCategoriasDaLoja] = useState<string[]>([]);
  const [verSemCategoria, setVerSemCategoria] = useState(false);
  const [salvandoItem, setSalvandoItem] = useState<string | null>(null);

  const carregarSemCategoria = () => {
    fetch("/api/store/kds-sem-categoria")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setSemCategoria(Array.isArray(d.itens) ? d.itens : []);
        setCategoriasDaLoja(Array.isArray(d.categorias) ? d.categorias : []);
      })
      .catch(() => {});
  };

  const escolherCategoria = async (id: string, categoria: string) => {
    setSalvandoItem(id);
    try {
      const r = await fetch("/api/store/kds-sem-categoria", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, categoria }),
      });
      if (r.ok) setSemCategoria((lista) => lista.filter((i) => i.id !== id));
    } finally {
      setSalvandoItem(null);
    }
  };

  // Form state
  const [formName, setFormName] = useState("");
  const [formStage, setFormStage] = useState<"production" | "finishing">("production");
  const [formFilter, setFormFilter] = useState<"all" | "odd" | "even">("all");
  const [formCategories, setFormCategories] = useState<string[]>([]); // categorias selecionadas

  useEffect(() => { carregarSemCategoria(); }, []);

  useEffect(() => {
    let localScreens: KDSScreenConfig[] = [];
    const saved = lerDoAparelho(STORAGE_KEY);
    if (saved) {
      try { localScreens = JSON.parse(saved); } catch {}
    }

    // Carregar telas da API do banco de dados (sincronizado por loja)
    fetch("/api/store/kds-screens")
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((data: KDSScreenConfig[]) => {
        if (Array.isArray(data) && data.length > 0) {
          setScreens(data);
          gravarNoAparelho(STORAGE_KEY, JSON.stringify(data));
        } else if (localScreens.length > 0) {
          // Se o banco estiver vazio mas houver telas salvas localmente neste PC, migra para o banco
          setScreens(localScreens);
          fetch("/api/store/kds-screens", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(localScreens),
          }).catch(() => {});
        } else {
          setScreens([]);
        }
      })
      .catch(() => {
        // Fallback local se estiver offline
        setScreens(localScreens);
      })
      .finally(() => {
        setLoaded(true);
      });

    // Buscar categorias
    fetch("/api/admin/categories")
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setAllCategories(data); })
      .catch(() => {});

  }, []);

  const save = (s: KDSScreenConfig[]) => {
    setScreens(s);
    gravarNoAparelho(STORAGE_KEY, JSON.stringify(s));
    // Falha calada aqui era o pior dos mundos: o painel mostrava o filtro
    // salvo, e as telas da cozinha — que leem do servidor — seguiam sem ele.
    // Aviso no topo, não alert() (regra da casa).
    const avisar = () =>
      setAviso({
        tipo: "erro",
        titulo: "Não consegui salvar as telas do KDS",
        detalhe: "As telas da cozinha continuam com a configuração anterior. Confira a internet e salve de novo.",
      });
    fetch("/api/store/kds-screens", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(s),
    })
      .then((r) => { if (!r.ok) avisar(); })
      .catch(avisar);
  };

  const openForm = (existing?: KDSScreenConfig) => {
    if (existing) {
      setEditId(existing.id);
      setFormName(existing.name);
      setFormStage(existing.stage);
      setFormFilter(existing.filter);
      setFormCategories(existing.categoryFilter || []);
    } else {
      setEditId(null);
      const prodCount = screens.filter(s => s.stage === "production").length;
      const finCount = screens.filter(s => s.stage === "finishing").length;
      setFormName(`Tela ${prodCount + finCount + 1}`);
      setFormStage("production");
      setFormFilter("all");
      setFormCategories([]);
    }
    setShowForm(true);
  };

  const saveForm = () => {
    if (!formName.trim()) return;
    if (editId) {
      save(screens.map(s => s.id === editId ? { ...s, name: formName, stage: formStage, filter: formFilter, categoryFilter: formCategories } : s));
    } else {
      save([...screens, { id: novoIdDaTela(), name: formName, stage: formStage, filter: formFilter, categoryFilter: formCategories }]);
    }
    setShowForm(false);
    setEditId(null);
  };

  const removeScreen = (id: string) => save(screens.filter(s => s.id !== id));

  const filterLabel = (f: string) => f === "odd" ? "Ímpares" : f === "even" ? "Pares" : "Todos";

  if (!loaded) return null;

  return (
    <div style={{ minHeight: "calc(100vh - 80px)", background: "#0f0f0f", padding: "2rem", color: "#e2e8f0", fontFamily: FONT }}>
      <AvisoNoTopo aviso={aviso} onFechar={fecharAviso} />
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.25rem", flexWrap: "wrap", gap: "1rem" }}>
        <div style={{ fontSize: "1.8rem", fontWeight: 800, color: "#fff", display: "flex", alignItems: "center", gap: "0.5rem" }}>
          🖥️ KDS — Kitchen Display System
        </div>
        <button
          onClick={() => openForm()}
          style={{
            padding: "10px 24px", border: "none", borderRadius: "10px", fontWeight: 800,
            fontSize: "0.95rem", cursor: "pointer", fontFamily: "inherit",
            background: "linear-gradient(135deg, #E8590C, #C92E09)", color: "#fff",
            boxShadow: "0 4px 20px rgba(249,115,22,0.3)", transition: "transform 0.15s",
          }}
        >
          + Adicionar Tela
        </button>
      </div>
      <p style={{ fontSize: "0.9rem", color: "#94a3b8", marginBottom: "2rem", maxWidth: "600px" }}>
        Adicione telas e abra cada uma em um monitor ou TV diferente. Dentro da tela, você pode mudar o filtro a qualquer momento.
      </p>

      {/* Empty state */}
      {screens.length === 0 && (
        <div style={{
          background: "#1C1917", borderRadius: "16px", padding: "3rem 2rem",
          border: "1px dashed #44403C", textAlign: "center", maxWidth: "500px",
        }}>
          <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>📺</div>
          <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "#fff", marginBottom: "0.5rem" }}>
            Nenhuma tela configurada
          </div>
          <p style={{ color: "#94a3b8", fontSize: "0.85rem", marginBottom: "1.5rem" }}>
            Clique em &quot;+ Adicionar Tela&quot; para criar sua primeira tela de KDS.
          </p>
          <button
            onClick={() => openForm()}
            style={{
              padding: "10px 28px", border: "none", borderRadius: "10px", fontWeight: 700,
              fontSize: "0.9rem", cursor: "pointer", fontFamily: "inherit",
              background: "linear-gradient(135deg, #E8590C, #C92E09)", color: "#fff",
            }}
          >
            + Adicionar Tela
          </button>
        </div>
      )}

      {/* ── CATEGORIA SEM TELA NÃO APARECE (13/10/2026) ───────────────────────
          Até aqui a categoria que nenhuma tela listava acompanhava o pedido em
          toda tela — e o chopp do salão caía na cozinha (Ragnar). Douglas:
          "categoria sem tela aparece em lugar nenhum". Este aviso diz quais
          categorias ficaram fora de todas as telas, para o lojista decidir. */}
      {(() => {
        const comFiltro = screens.filter((t) => (t.categoryFilter || []).length > 0);
        if (comFiltro.length === 0 || allCategories.length === 0) return null;
        const temTelaSemFiltro = screens.some((t) => (t.categoryFilter || []).length === 0);
        const emAlgumaTela = new Set<string>();
        for (const t of comFiltro) {
          for (const c of t.categoryFilter || []) emAlgumaTela.add(String(c).toLowerCase().trim());
        }
        const fora = allCategories.filter((c) => !emAlgumaTela.has(String(c.name).toLowerCase().trim()));
        if (fora.length === 0) return null;
        const nomes = fora.map((c) => c.name);
        return (
          <div style={{
            background: "#1C1917", border: "1px solid #292524", borderLeft: "4px solid #A8A29E",
            borderRadius: "12px", padding: "1rem 1.25rem", marginBottom: "1rem",
          }}>
            <div style={{ color: "#A8A29E", fontWeight: 800, fontSize: "0.85rem", marginBottom: 6 }}>
              🚫 Categorias fora das telas
            </div>
            <div style={{ color: "#cbd5e1", fontSize: "0.82rem", lineHeight: 1.5 }}>
              <b style={{ color: "#fff" }}>{nomes.join(", ")}</b> não {nomes.length === 1 ? "está" : "estão"} em nenhuma tela com filtro, então
              {" "}<b>não {nomes.length === 1 ? "aparece" : "aparecem"} nessas telas</b>
              {temTelaSemFiltro ? " (só nas telas sem filtro, que mostram tudo)" : ""}.
              {" "}Se alguém prepara {nomes.length === 1 ? "ela" : "elas"}, marque numa tela — por exemplo, Cerveja e Drinks numa tela &quot;Bar&quot;.
            </div>
          </div>
        );
      })()}

      {/* ── ITENS DAS INTEGRAÇÕES SEM CATEGORIA ───────────────────────────────
          O item do iFood/99/Wabiz chega com o nome da plataforma. O sistema acha
          a categoria pelo nome igual ao do cardápio, pelo tamanho da pizza e
          pelas palavras; o que sobrar aparece em TODA tela filtrada (nunca
          some da cozinha) até o lojista escolher a categoria aqui, uma vez. */}
      {semCategoria.length > 0 && (
        <div style={{
          background: "#1C1917", border: "1px solid #7C2D12", borderLeft: "4px solid #F97316",
          borderRadius: "12px", padding: "1rem 1.25rem", marginBottom: "1rem",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div style={{ color: "#FDBA74", fontWeight: 800, fontSize: "0.9rem" }}>
              ⚠️ {semCategoria.length} {semCategoria.length === 1 ? "item" : "itens"} do iFood/integrações sem categoria
            </div>
            <button
              type="button"
              onClick={() => setVerSemCategoria((v) => !v)}
              style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid #F97316", background: "transparent", color: "#FDBA74", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
            >
              {verSemCategoria ? "Fechar" : "Escolher categorias"}
            </button>
          </div>
          <div style={{ color: "#cbd5e1", fontSize: "0.82rem", lineHeight: 1.5, marginTop: 6 }}>
            Esses itens aparecem em <b>todas</b> as telas para não sumirem da cozinha. Escolha a categoria de cada um uma vez e eles passam a ir só para a tela certa.
            <br />
            <span style={{ color: "#94a3b8" }}>
              Dica: o KDS separa sozinho quando o nome no iFood é igual ao do seu cardápio no FireHub. Mantendo os dois cardápios com os mesmos nomes, quase nada cai aqui.
            </span>
          </div>
          {verSemCategoria && (
            <div style={{ marginTop: "0.75rem", display: "grid", gap: 6 }}>
              {semCategoria.map((it) => (
                <div key={it.id} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", background: "#0f0f1a", borderRadius: 8, padding: "8px 10px" }}>
                  <span style={{ flex: "1 1 240px", color: "#fff", fontSize: "0.85rem" }}>
                    {it.nome} <span style={{ color: "#64748b", fontSize: "0.72rem" }}>({it.plataforma})</span>
                  </span>
                  <select
                    defaultValue=""
                    disabled={salvandoItem === it.id}
                    onChange={(e) => e.target.value && escolherCategoria(it.id, e.target.value)}
                    style={{ padding: "6px 8px", borderRadius: 6, background: "#1C1917", color: "#e2e8f0", border: "1px solid #44403C", fontFamily: "inherit" }}
                  >
                    <option value="">Escolher categoria…</option>
                    {categoriasDaLoja.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Screen cards */}
      {screens.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "1rem" }}>
          {screens.map((screen) => {
            const isProd = screen.stage === "production";
            const accent = isProd ? "#E8590C" : "#64748B";
            const cats = screen.categoryFilter || [];
            const catParam = cats.length > 0 ? ("&categories=" + encodeURIComponent(cats.join(","))) : "";
            // `tela` e a identidade da tela na baixa: e ela que permite o
            // pedido sair DESTA tela e continuar nas outras ate a ultima
            // terminar (lib/kds-telas.ts). Link salvo antes disto segue
            // funcionando, com a baixa valendo para o pedido inteiro.
            const telaUrl = "/store/kds/tela?stage=" + screen.stage + "&filter=" + screen.filter + "&name=" + encodeURIComponent(screen.name) + catParam + "&tela=" + encodeURIComponent(screen.id);
            return (
              <div key={screen.id} style={{
                background: "#1C1917", borderRadius: "14px", padding: "1.5rem",
                border: "1px solid #292524", position: "relative",
                borderLeft: `4px solid ${accent}`,
              }}>
                <button
                  onClick={() => removeScreen(screen.id)}
                  title="Remover tela"
                  style={{
                    position: "absolute", top: "12px", right: "12px", background: "none",
                    border: "none", color: "#64748b", cursor: "pointer", fontSize: "1.1rem",
                    padding: "4px", lineHeight: 1,
                  }}
                >✕</button>

                <div style={{ fontSize: "1.15rem", fontWeight: 800, color: "#fff", marginBottom: "0.75rem" }}>
                  {screen.name}
                </div>

                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "0.75rem" }}>
                  <span style={{
                    padding: "3px 10px", borderRadius: "6px", fontSize: "0.75rem", fontWeight: 700,
                    background: `${accent}22`, color: accent,
                  }}>
                    {isProd ? "🔥 Produção" : "📦 Finalização"}
                  </span>
                  <span style={{
                    padding: "3px 10px", borderRadius: "6px", fontSize: "0.75rem", fontWeight: 700,
                    background: "#334155", color: "#CBD5E1",
                  }}>
                    {filterLabel(screen.filter)}
                  </span>
                  {cats.length > 0 && (
                    <span style={{
                      padding: "3px 10px", borderRadius: "6px", fontSize: "0.75rem", fontWeight: 700,
                      background: "#134e4a", color: "#5eead4",
                    }}>
                      🏷️ {cats.join(", ")}
                    </span>
                  )}
                </div>

                <p style={{ fontSize: "0.78rem", color: "#64748b", margin: "0 0 1rem 0" }}>
                  Dentro da tela você pode trocar o filtro a qualquer momento.
                </p>

                <div style={{ display: "flex", gap: "8px" }}>
                  {/* Na mesma aba: navegador de Smart TV ignora nova aba e o
                      botão parecia não clicar (Hakim, 21/10). A tela tem o
                      link de voltar para esta lista. */}
                  <a
                    href={telaUrl}
                    style={{
                      flex: 1, padding: "11px", border: "none", borderRadius: "10px", fontWeight: 800,
                      fontSize: "0.9rem", cursor: "pointer", fontFamily: "inherit", textAlign: "center",
                      background: `linear-gradient(135deg, ${accent}, ${isProd ? "#E8590C" : "#1C1917"})`,
                      color: "#fff", textDecoration: "none",
                    }}
                  >
                    ABRIR TELA
                  </a>
                  <button
                    onClick={() => openForm(screen)}
                    style={{
                      padding: "11px 14px", border: "1px solid #44403C", borderRadius: "10px",
                      background: "#292524", color: "#CBD5E1", fontSize: "0.85rem", fontWeight: 600,
                      cursor: "pointer", fontFamily: "inherit",
                    }}
                  >
                    ✏️
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Tip */}
      <div style={{
        background: "#1C1917", border: "1px solid #292524", borderRadius: "12px",
        padding: "1rem 1.5rem", color: "#94a3b8", fontSize: "0.85rem",
        marginTop: "2rem", display: "flex", alignItems: "center", gap: "0.5rem",
      }}>
        💡 <strong>Dica:</strong>&nbsp;Na tela do KDS, use um teclado numérico USB para dar baixa nos pedidos. Aperte o número do pedido na tela para marcá-lo como pronto.
      </div>

      {/* Form Modal */}
      {showForm && (
        <div
          onClick={() => { setShowForm(false); setEditId(null); }}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
            zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center",
            backdropFilter: "blur(4px)",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#1C1917", borderRadius: "16px", padding: "2rem",
              border: "1px solid #292524", width: "100%", maxWidth: "420px",
              boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
            }}
          >
            <div style={{ fontSize: "1.2rem", fontWeight: 800, color: "#fff", marginBottom: "1.5rem" }}>
              {editId ? "✏️ Editar Tela" : "📺 Nova Tela"}
            </div>

            {/* Name */}
            <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 700, color: "#94a3b8", marginBottom: "6px" }}>
              Nome da tela
            </label>
            <input
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="Ex: Produção 1"
              style={{
                width: "100%", padding: "10px 14px", borderRadius: "8px",
                border: "1px solid #44403C", background: "#0f0f1a", color: "#fff",
                fontSize: "0.95rem", fontFamily: "inherit", marginBottom: "1.25rem",
                outline: "none", boxSizing: "border-box",
              }}
            />

            {/* Stage */}
            <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 700, color: "#94a3b8", marginBottom: "8px" }}>
              Tipo da tela
            </label>
            <div style={{ display: "flex", gap: "8px", marginBottom: "1.25rem" }}>
              {([
                { value: "production" as const, label: "🔥 Produção", desc: "Montar e preparar", color: "#E8590C" },
                { value: "finishing" as const, label: "📦 Finalização", desc: "Embalar e conferir", color: "#64748B" },
              ]).map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setFormStage(opt.value)}
                  style={{
                    flex: 1, padding: "12px", borderRadius: "10px", cursor: "pointer",
                    fontFamily: "inherit", textAlign: "center", transition: "all 0.15s",
                    border: formStage === opt.value ? `2px solid ${opt.color}` : "2px solid #44403C",
                    background: formStage === opt.value ? `${opt.color}15` : "#0f0f1a",
                    color: formStage === opt.value ? opt.color : "#94a3b8",
                  }}
                >
                  <div style={{ fontWeight: 800, fontSize: "0.95rem" }}>{opt.label}</div>
                  <div style={{ fontSize: "0.72rem", marginTop: "4px", opacity: 0.7 }}>{opt.desc}</div>
                </button>
              ))}
            </div>

            {/* Filter */}
            <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 700, color: "#94a3b8", marginBottom: "8px" }}>
              Quais pedidos aparecem?
            </label>
            <div style={{ display: "flex", gap: "8px", marginBottom: "1.5rem" }}>
              {([
                { value: "all" as const, label: "📋 Todos" },
                { value: "odd" as const, label: "🔢 Ímpares" },
                { value: "even" as const, label: "🔢 Pares" },
              ]).map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setFormFilter(opt.value)}
                  style={{
                    flex: 1, padding: "10px", borderRadius: "8px", cursor: "pointer",
                    fontFamily: "inherit", fontWeight: 700, fontSize: "0.85rem",
                    transition: "all 0.15s",
                    border: formFilter === opt.value ? "2px solid #E8590C" : "2px solid #44403C",
                    background: formFilter === opt.value ? "#f9731615" : "#0f0f1a",
                    color: formFilter === opt.value ? "#E8590C" : "#94a3b8",
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Category Filter */}
            {allCategories.length > 0 && (
              <>
                <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 700, color: "#94a3b8", marginBottom: "8px" }}>
                  Filtrar por categoria <span style={{ fontWeight: 400, fontSize: "0.75rem" }}>(vazio = mostrar tudo)</span>
                </label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "1.25rem" }}>
                  {allCategories.map(cat => {
                    const selected = formCategories.includes(cat.name);
                    return (
                      <button
                        key={cat.id}
                        onClick={() => setFormCategories(prev =>
                          selected ? prev.filter(c => c !== cat.name) : [...prev, cat.name]
                        )}
                        style={{
                          padding: "7px 14px", borderRadius: "20px", cursor: "pointer",
                          fontFamily: "inherit", fontWeight: 700, fontSize: "0.8rem",
                          transition: "all 0.15s",
                          border: selected ? `2px solid ${cat.color}` : "2px solid #44403C",
                          background: selected ? `${cat.color}20` : "#0f0f1a",
                          color: selected ? cat.color : "#94a3b8",
                        }}
                      >
                        {cat.emoji} {cat.name}
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            <p style={{ fontSize: "0.75rem", color: "#64748b", marginBottom: "1.5rem" }}>
              Você pode mudar o filtro depois, direto na tela do KDS.
            </p>

            {/* Actions */}
            <div style={{ display: "flex", gap: "10px" }}>
              <button
                onClick={() => { setShowForm(false); setEditId(null); }}
                style={{
                  flex: 1, padding: "12px", borderRadius: "10px", fontWeight: 700,
                  fontSize: "0.9rem", cursor: "pointer", fontFamily: "inherit",
                  border: "1px solid #44403C", background: "#0f0f1a", color: "#94a3b8",
                }}
              >
                Cancelar
              </button>
              <button
                onClick={saveForm}
                style={{
                  flex: 1, padding: "12px", borderRadius: "10px", fontWeight: 800,
                  fontSize: "0.9rem", cursor: "pointer", fontFamily: "inherit",
                  border: "none", background: "linear-gradient(135deg, #E8590C, #C92E09)", color: "#fff",
                }}
              >
                {editId ? "Salvar" : "Criar Tela"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
