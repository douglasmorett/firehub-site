"use client";
import { useState } from "react";
import { ExternalLink, Download, CheckCircle, AlertCircle, Loader, ChevronRight, Package } from "lucide-react";

type Product = {
  name: string;
  description: string;
  price: number;
  category: string;
  imageUrl: string | null;
};

type Preview = {
  merchantId: string;
  count: number;
  categories: string[];
  products: Product[];
};

export default function IfoodImportButton() {
  const [ifoodUrl, setIfoodUrl]     = useState("");
  const [step, setStep]             = useState<"idle" | "preview" | "importing" | "done" | "error">("idle");
  const [preview, setPreview]       = useState<Preview | null>(null);
  const [result, setResult]         = useState<{ imported: number; skipped: number; message: string } | null>(null);
  const [error, setError]           = useState("");
  const [loading, setLoading]       = useState(false);
  const [selectedCats, setSelected] = useState<Set<string>>(new Set());

  async function handlePreview() {
    if (!ifoodUrl.trim()) return;
    setLoading(true); setError("");
    try {
      const r = await fetch("/api/ifood/import-menu", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ifoodUrl, mode: "preview" }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error || "Erro ao buscar cardápio"); setStep("error"); return; }
      setPreview(d);
      setSelected(new Set(d.categories)); // seleciona todas por padrão
      setStep("preview");
    } catch { setError("Erro de conexão. Tente novamente."); setStep("error"); }
    finally { setLoading(false); }
  }

  async function handleImport() {
    if (!preview) return;
    setStep("importing"); setLoading(true);
    try {
      const r = await fetch("/api/ifood/import-menu", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ifoodUrl, mode: "import" }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error || "Erro ao importar"); setStep("error"); return; }
      setResult(d);
      setStep("done");
    } catch { setError("Erro de conexão."); setStep("error"); }
    finally { setLoading(false); }
  }

  function reset() {
    setStep("idle"); setIfoodUrl(""); setPreview(null); setResult(null); setError("");
  }

  const filtered = preview?.products.filter(p => selectedCats.has(p.category)) ?? [];

  return (
    <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #E2E8F0", overflow: "hidden", marginBottom: "1.5rem" }}>
      {/* Header */}
      <div style={{ background: "linear-gradient(135deg, #EA1D2C, #FF4D5A)", padding: "1.25rem 1.5rem", color: "#fff" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 36, height: 36, background: "rgba(255,255,255,0.2)", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Download size={18} />
          </div>
          <div>
            <h3 style={{ margin: 0, fontWeight: 800, fontSize: "1rem" }}>Importar Cardápio do iFood</h3>
            <p style={{ margin: 0, fontSize: "0.75rem", opacity: 0.85 }}>Cole o link do seu restaurante e importe tudo em 1 clique</p>
          </div>
          <span style={{ marginLeft: "auto", background: "rgba(255,255,255,0.2)", padding: "3px 10px", borderRadius: 20, fontSize: "0.68rem", fontWeight: 700 }}>NOVO</span>
        </div>
      </div>

      <div style={{ padding: "1.25rem 1.5rem" }}>
        {/* IDLE */}
        {step === "idle" && (
          <>
            <p style={{ fontSize: "0.82rem", color: "#64748B", margin: "0 0 1rem", lineHeight: 1.6 }}>
              Se a integração iFood já estiver configurada, clique em <strong>Buscar Cardápio</strong> direto.
              Caso contrário, cole o link do seu restaurante no iFood para extrair o merchantId.
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input
                type="url"
                value={ifoodUrl}
                onChange={e => setIfoodUrl(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handlePreview()}
                placeholder="https://www.ifood.com.br/delivery/cidade/restaurante/UUID (opcional)"
                style={{ flex: 1, minWidth: 200, padding: "10px 14px", borderRadius: 10, border: "1.5px solid #E2E8F0", fontSize: "0.875rem", outline: "none" }}
              />
              <button
                onClick={handlePreview}
                disabled={loading}
                style={{ padding: "10px 20px", borderRadius: 10, border: "none", background: loading ? "#94A3B8" : "#EA1D2C", color: "#fff", fontWeight: 700, fontSize: "0.875rem", cursor: loading ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}
              >
                {loading ? <><Loader size={14} style={{ animation: "spin 0.8s linear infinite" }} /> Buscando...</> : <><ExternalLink size={14} /> Buscar Cardápio</>}
              </button>
            </div>
            <p style={{ fontSize: "0.72rem", color: "#94A3B8", margin: "8px 0 0" }}>
              🔗 Usa a API oficial do iFood Developer para importar com precisão.
            </p>
          </>
        )}

        {/* ERROR */}
        {step === "error" && (
          <div style={{ background: "#FEF2F2", borderRadius: 10, padding: "1rem", border: "1px solid #FECACA" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <AlertCircle size={16} color="#EF4444" />
              <span style={{ fontWeight: 700, fontSize: "0.875rem", color: "#B91C1C" }}>Erro ao importar</span>
            </div>
            <p style={{ fontSize: "0.82rem", color: "#7F1D1D", margin: "0 0 0.75rem" }}>{error}</p>
            <button onClick={reset} style={{ padding: "7px 16px", borderRadius: 8, border: "1.5px solid #EF4444", background: "#fff", color: "#EF4444", fontWeight: 600, fontSize: "0.82rem", cursor: "pointer" }}>
              Tentar Novamente
            </button>
          </div>
        )}

        {/* PREVIEW */}
        {step === "preview" && preview && (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "1rem", background: "#F0FDF4", borderRadius: 10, padding: "0.75rem 1rem", border: "1px solid #BBF7D0" }}>
              <CheckCircle size={16} color="#16A34A" />
              <span style={{ fontSize: "0.875rem", fontWeight: 700, color: "#15803D" }}>
                {preview.count} produtos encontrados em {preview.categories.length} categorias
              </span>
            </div>

            {/* Seletor de categorias */}
            <p style={{ fontWeight: 700, fontSize: "0.82rem", margin: "0 0 0.5rem" }}>Selecione as categorias para importar:</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: "1rem" }}>
              {preview.categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setSelected(prev => {
                    const next = new Set(prev);
                    next.has(cat) ? next.delete(cat) : next.add(cat);
                    return next;
                  })}
                  style={{
                    padding: "5px 12px", borderRadius: 20, border: "1.5px solid",
                    borderColor: selectedCats.has(cat) ? "#EA1D2C" : "#E2E8F0",
                    background: selectedCats.has(cat) ? "#FFF1F2" : "#fff",
                    color: selectedCats.has(cat) ? "#EA1D2C" : "#64748B",
                    fontWeight: selectedCats.has(cat) ? 700 : 500,
                    fontSize: "0.78rem", cursor: "pointer",
                  }}
                >
                  {selectedCats.has(cat) ? "✓ " : ""}{cat}
                </button>
              ))}
            </div>

            {/* Preview dos produtos */}
            <div style={{ maxHeight: 220, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6, marginBottom: "1rem" }}>
              {filtered.slice(0, 20).map((p, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: "#F8FAFC", borderRadius: 8, border: "1px solid #E2E8F0" }}>
                  {p.imageUrl
                    ? <img src={p.imageUrl} alt={p.name} style={{ width: 36, height: 36, borderRadius: 6, objectFit: "cover", flexShrink: 0 }} />
                    : <div style={{ width: 36, height: 36, borderRadius: 6, background: "#E2E8F0", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Package size={14} color="#94A3B8" /></div>
                  }
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontWeight: 600, fontSize: "0.82rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</p>
                    <p style={{ margin: 0, fontSize: "0.7rem", color: "#94A3B8" }}>{p.category}</p>
                  </div>
                  <span style={{ fontWeight: 800, fontSize: "0.85rem", color: "#EA1D2C", flexShrink: 0 }}>
                    R$ {p.price.toFixed(2)}
                  </span>
                </div>
              ))}
              {filtered.length > 20 && (
                <p style={{ fontSize: "0.75rem", color: "#94A3B8", textAlign: "center", margin: "4px 0 0" }}>
                  + {filtered.length - 20} produtos...
                </p>
              )}
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={reset} style={{ padding: "10px 16px", borderRadius: 10, border: "1.5px solid #E2E8F0", background: "#fff", color: "#64748B", fontWeight: 600, fontSize: "0.875rem", cursor: "pointer" }}>
                Cancelar
              </button>
              <button
                onClick={handleImport}
                disabled={selectedCats.size === 0}
                style={{ flex: 1, padding: "10px 20px", borderRadius: 10, border: "none", background: selectedCats.size === 0 ? "#94A3B8" : "#EA1D2C", color: "#fff", fontWeight: 700, fontSize: "0.9rem", cursor: selectedCats.size === 0 ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
              >
                <Download size={16} />
                Importar {filtered.length} produtos
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}

        {/* IMPORTING */}
        {step === "importing" && (
          <div style={{ textAlign: "center", padding: "1.5rem 0" }}>
            <div style={{ width: 48, height: 48, border: "4px solid #F1F5F9", borderTopColor: "#EA1D2C", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 12px" }} />
            <p style={{ fontWeight: 700, fontSize: "0.9rem", margin: 0 }}>Importando cardápio...</p>
            <p style={{ fontSize: "0.78rem", color: "#94A3B8", margin: "4px 0 0" }}>Criando produtos, categorias e salvando imagens</p>
          </div>
        )}

        {/* DONE */}
        {step === "done" && result && (
          <div style={{ background: "#F0FDF4", borderRadius: 10, padding: "1.25rem", border: "1px solid #BBF7D0", textAlign: "center" }}>
            <div style={{ fontSize: "2.5rem", marginBottom: 8 }}>🎉</div>
            <p style={{ fontWeight: 800, fontSize: "1rem", margin: "0 0 4px", color: "#15803D" }}>Cardápio importado!</p>
            <p style={{ fontSize: "0.85rem", color: "#166534", margin: "0 0 1rem" }}>{result.message}</p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              <button onClick={reset} style={{ padding: "8px 16px", borderRadius: 8, border: "1.5px solid #16A34A", background: "#fff", color: "#16A34A", fontWeight: 600, fontSize: "0.82rem", cursor: "pointer" }}>
                Importar outro link
              </button>
              <a href="/store/cardapio" style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "#16A34A", color: "#fff", fontWeight: 600, fontSize: "0.82rem", cursor: "pointer", textDecoration: "none" }}>
                Ver Cardápio →
              </a>
            </div>
          </div>
        )}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
