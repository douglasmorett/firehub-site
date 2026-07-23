"use client";

import React, { useState, useEffect } from "react";

interface KDSScreenConfig {
  id: string;
  name: string;
  stage: "production" | "finishing";
  filter: "all" | "odd" | "even";
  categoryFilter: string[]; // nomes das categorias filtradas (vazio = todas)
}

const STORAGE_KEY = "kds-screens";
const FONT = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`;

export default function KDSHubClient() {
  const [screens, setScreens] = useState<KDSScreenConfig[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  // Categorias disponíveis (carregadas da API)
  const [allCategories, setAllCategories] = useState<{ id: string; name: string; emoji: string; color: string }[]>([]);

  // Form state
  const [formName, setFormName] = useState("");
  const [formStage, setFormStage] = useState<"production" | "finishing">("production");
  const [formFilter, setFormFilter] = useState<"all" | "odd" | "even">("all");
  const [formCategories, setFormCategories] = useState<string[]>([]); // categorias selecionadas

  useEffect(() => {
    let localScreens: KDSScreenConfig[] = [];
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try { localScreens = JSON.parse(saved); } catch {}
    }

    // Carregar telas da API do banco de dados (sincronizado por loja)
    fetch("/api/store/kds-screens")
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((data: KDSScreenConfig[]) => {
        if (Array.isArray(data) && data.length > 0) {
          setScreens(data);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    fetch("/api/store/kds-screens", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(s),
    }).catch(() => {});
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
      save([...screens, { id: crypto.randomUUID(), name: formName, stage: formStage, filter: formFilter, categoryFilter: formCategories }]);
    }
    setShowForm(false);
    setEditId(null);
  };

  const removeScreen = (id: string) => save(screens.filter(s => s.id !== id));

  const filterLabel = (f: string) => f === "odd" ? "Ímpares" : f === "even" ? "Pares" : "Todos";

  if (!loaded) return null;

  return (
    <div style={{ minHeight: "calc(100vh - 80px)", background: "#0f0f0f", padding: "2rem", color: "#e2e8f0", fontFamily: FONT }}>
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
            background: "linear-gradient(135deg, #f97316, #ef4444)", color: "#fff",
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
          background: "#1a1a2e", borderRadius: "16px", padding: "3rem 2rem",
          border: "1px dashed #3a3a5a", textAlign: "center", maxWidth: "500px",
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
              background: "linear-gradient(135deg, #f97316, #ef4444)", color: "#fff",
            }}
          >
            + Adicionar Tela
          </button>
        </div>
      )}

      {/* Screen cards */}
      {screens.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "1rem" }}>
          {screens.map((screen) => {
            const isProd = screen.stage === "production";
            const accent = isProd ? "#f97316" : "#8b5cf6";
            const cats = screen.categoryFilter || [];
            const catParam = cats.length > 0 ? ("&categories=" + encodeURIComponent(cats.join(","))) : "";
            const telaUrl = "/store/kds/tela?stage=" + screen.stage + "&filter=" + screen.filter + "&name=" + encodeURIComponent(screen.name) + catParam;
            return (
              <div key={screen.id} style={{
                background: "#1a1a2e", borderRadius: "14px", padding: "1.5rem",
                border: "1px solid #2a2a4a", position: "relative",
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
                    background: "#374151", color: "#d1d5db",
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
                  <a
                    href={telaUrl}
                    target="_blank"
                    rel="noopener"
                    style={{
                      flex: 1, padding: "11px", border: "none", borderRadius: "10px", fontWeight: 800,
                      fontSize: "0.9rem", cursor: "pointer", fontFamily: "inherit", textAlign: "center",
                      background: `linear-gradient(135deg, ${accent}, ${isProd ? "#ea580c" : "#6366f1"})`,
                      color: "#fff", textDecoration: "none",
                    }}
                  >
                    ABRIR TELA
                  </a>
                  <button
                    onClick={() => openForm(screen)}
                    style={{
                      padding: "11px 14px", border: "1px solid #3a3a5a", borderRadius: "10px",
                      background: "#2a2a4a", color: "#d1d5db", fontSize: "0.85rem", fontWeight: 600,
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
        background: "#1a1a2e", border: "1px solid #2a2a4a", borderRadius: "12px",
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
              background: "#1a1a2e", borderRadius: "16px", padding: "2rem",
              border: "1px solid #2a2a4a", width: "100%", maxWidth: "420px",
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
                border: "1px solid #3a3a5a", background: "#0f0f1a", color: "#fff",
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
                { value: "production" as const, label: "🔥 Produção", desc: "Montar e preparar", color: "#f97316" },
                { value: "finishing" as const, label: "📦 Finalização", desc: "Embalar e conferir", color: "#8b5cf6" },
              ]).map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setFormStage(opt.value)}
                  style={{
                    flex: 1, padding: "12px", borderRadius: "10px", cursor: "pointer",
                    fontFamily: "inherit", textAlign: "center", transition: "all 0.15s",
                    border: formStage === opt.value ? `2px solid ${opt.color}` : "2px solid #3a3a5a",
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
                    border: formFilter === opt.value ? "2px solid #f97316" : "2px solid #3a3a5a",
                    background: formFilter === opt.value ? "#f9731615" : "#0f0f1a",
                    color: formFilter === opt.value ? "#f97316" : "#94a3b8",
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
                          border: selected ? `2px solid ${cat.color}` : "2px solid #3a3a5a",
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
                  border: "1px solid #3a3a5a", background: "#0f0f1a", color: "#94a3b8",
                }}
              >
                Cancelar
              </button>
              <button
                onClick={saveForm}
                style={{
                  flex: 1, padding: "12px", borderRadius: "10px", fontWeight: 800,
                  fontSize: "0.9rem", cursor: "pointer", fontFamily: "inherit",
                  border: "none", background: "linear-gradient(135deg, #f97316, #ef4444)", color: "#fff",
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
