"use client";
import { useState } from "react";
import {
  ExternalLink, Download, CheckCircle, AlertCircle, Loader,
  ChevronRight, Package, FileSpreadsheet, Info, MessageSquare, Zap
} from "lucide-react";

type Product = {
  name: string; description: string;
  price: number; category: string; imageUrl: string | null;
};
type Preview = {
  count: number; categories: string[]; products: Product[];
};

// ─── Tab 1: Sincronizar via API Oficial iFood ────────────────────────────────
function IfoodApiTab() {
  const [step, setStep] = useState<"idle" | "preview" | "importing" | "done" | "error" | "not_ready" | "not_connected">("idle");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<{ imported: number; skipped: number; message: string } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedCats, setSelected] = useState<Set<string>>(new Set());

  async function handlePreview() {
    setLoading(true); setError("");
    try {
      const r = await fetch("/api/ifood/import-menu", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "preview" }),
      });
      const d = await r.json();
      if (d.notConnected || d.error === "not_connected") { setStep("not_connected"); return; }
      if (r.status === 503 && d.apiNotReady) { setStep("not_ready"); return; }
      if (!r.ok) { setError(d.error || "Erro ao buscar cardápio"); setStep("error"); return; }
      setPreview(d);
      setSelected(new Set(d.categories));
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
        body: JSON.stringify({ mode: "import", categories: Array.from(selectedCats) }),
      });

      const d = await r.json();
      if (d.notConnected || d.error === "not_connected") { setStep("not_connected"); return; }
      if (!r.ok) { setError(d.error || "Erro ao importar"); setStep("error"); return; }
      setResult(d); setStep("done");
    } catch { setError("Erro de conexão."); setStep("error"); }
    finally { setLoading(false); }
  }

  function reset() {
    setStep("idle"); setPreview(null); setResult(null); setError("");
  }

  const filtered = preview?.products.filter(p => selectedCats.has(p.category)) ?? [];

  if (step === "not_connected") {
    return (
      <div style={{ background: "#FEF2F2", border: "1.5px solid #FECACA", borderRadius: 14, padding: "1.25rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <AlertCircle size={20} color="#EA1D2C" />
          <span style={{ fontWeight: 800, fontSize: "0.95rem", color: "#991B1B" }}>Integração iFood Não Conectada</span>
        </div>
        <p style={{ fontSize: "0.85rem", color: "#7F1D1D", margin: "0 0 14px", lineHeight: 1.6 }}>
          Para importar seu cardápio do iFood automaticamente via API oficial, você precisa primeiro conectar sua loja iFood no FireHub.
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button onClick={reset} style={{ padding: "8px 16px", borderRadius: 8, border: "1.5px solid #CBD5E1", background: "#fff", color: "#475569", fontWeight: 600, fontSize: "0.82rem", cursor: "pointer" }}>
            ← Voltar
          </button>
          <a href="/store/integracoes" style={{ padding: "8px 18px", borderRadius: 8, border: "none", background: "#EA1D2C", color: "#fff", fontWeight: 700, fontSize: "0.85rem", cursor: "pointer", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}>
            🔗 Conectar Minha Loja iFood Agora
          </a>
        </div>
      </div>
    );
  }

  if (step === "not_ready") {
    return (
      <div style={{ background: "#FFFBEB", border: "1.5px solid #FDE68A", borderRadius: 14, padding: "1.25rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <Info size={20} color="#D97706" />
          <span style={{ fontWeight: 800, fontSize: "0.95rem", color: "#92400E" }}>Sincronização Direta do iFood</span>
        </div>
        <p style={{ fontSize: "0.84rem", color: "#78350F", margin: "0 0 14px", lineHeight: 1.6 }}>
          Conecte sua conta do iFood em <strong>Integrações</strong> para sincronizar seu cardápio via API.
          Você também pode enviar uma foto ou PDF do cardápio diretamente para o nosso suporte no WhatsApp abaixo!
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button onClick={reset} style={{ padding: "8px 18px", borderRadius: 8, border: "1.5px solid #D97706", background: "#fff", color: "#D97706", fontWeight: 700, fontSize: "0.82rem", cursor: "pointer" }}>
            ← Voltar
          </button>
          <a href="/store/integracoes" style={{ padding: "8px 18px", borderRadius: 8, border: "none", background: "#EA1D2C", color: "#fff", fontWeight: 700, fontSize: "0.85rem", cursor: "pointer", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}>
            🔗 Conectar Integração iFood
          </a>
        </div>
      </div>
    );
  }

  if (step === "error") {
    return (
      <div style={{ background: "#FEF2F2", borderRadius: 12, padding: "1.25rem", border: "1px solid #FECACA" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <AlertCircle size={18} color="#EF4444" />
          <span style={{ fontWeight: 800, fontSize: "0.9rem", color: "#B91C1C" }}>Erro ao buscar cardápio</span>
        </div>
        <p style={{ fontSize: "0.83rem", color: "#7F1D1D", margin: "0 0 1rem" }}>{error}</p>
        <button onClick={reset} style={{ padding: "8px 16px", borderRadius: 8, border: "1.5px solid #EF4444", background: "#fff", color: "#EF4444", fontWeight: 700, fontSize: "0.82rem", cursor: "pointer" }}>
          Tentar Novamente
        </button>
      </div>
    );
  }

  if (step === "preview" && preview) {
    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "1rem", background: "#F0FDF4", borderRadius: 10, padding: "0.75rem 1rem", border: "1px solid #BBF7D0" }}>
          <CheckCircle size={18} color="#16A34A" />
          <span style={{ fontSize: "0.88rem", fontWeight: 800, color: "#15803D" }}>
            {preview.count} produtos encontrados em {preview.categories.length} categorias do iFood!
          </span>
        </div>
        <p style={{ fontWeight: 700, fontSize: "0.84rem", margin: "0 0 0.5rem", color: "#334155" }}>Selecione as categorias para importar:</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: "1rem" }}>
          {preview.categories.map(cat => (
            <button key={cat}
              onClick={() => setSelected(prev => { const next = new Set(prev); next.has(cat) ? next.delete(cat) : next.add(cat); return next; })}
              style={{ padding: "6px 14px", borderRadius: 20, border: "1.5px solid", borderColor: selectedCats.has(cat) ? "#EA1D2C" : "#CBD5E1", background: selectedCats.has(cat) ? "#FFF1F2" : "#fff", color: selectedCats.has(cat) ? "#EA1D2C" : "#475569", fontWeight: selectedCats.has(cat) ? 800 : 600, fontSize: "0.8rem", cursor: "pointer" }}>
              {selectedCats.has(cat) ? "✓ " : ""}{cat}
            </button>
          ))}
        </div>
        <div style={{ maxHeight: 220, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6, marginBottom: "1rem" }}>
          {filtered.slice(0, 20).map((p, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "#F8FAFC", borderRadius: 8, border: "1px solid #E2E8F0" }}>
              {p.imageUrl
                ? <img src={p.imageUrl} alt={p.name} style={{ width: 36, height: 36, borderRadius: 6, objectFit: "cover", flexShrink: 0 }} />
                : <div style={{ width: 36, height: 36, borderRadius: 6, background: "#E2E8F0", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Package size={14} color="#94A3B8" /></div>}
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontWeight: 700, fontSize: "0.83rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</p>
                <p style={{ margin: 0, fontSize: "0.72rem", color: "#64748B" }}>{p.category}</p>
              </div>
              <span style={{ fontWeight: 800, fontSize: "0.85rem", color: "#EA1D2C", flexShrink: 0 }}>R$ {p.price.toFixed(2)}</span>
            </div>
          ))}
          {filtered.length > 20 && <p style={{ fontSize: "0.75rem", color: "#94A3B8", textAlign: "center", margin: "4px 0 0" }}>+ {filtered.length - 20} produtos...</p>}
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={reset} style={{ padding: "10px 16px", borderRadius: 10, border: "1.5px solid #E2E8F0", background: "#fff", color: "#64748B", fontWeight: 600, fontSize: "0.875rem", cursor: "pointer" }}>Cancelar</button>
          <button onClick={handleImport} disabled={selectedCats.size === 0}
            style={{ flex: 1, padding: "10px 20px", borderRadius: 10, border: "none", background: selectedCats.size === 0 ? "#94A3B8" : "#EA1D2C", color: "#fff", fontWeight: 800, fontSize: "0.9rem", cursor: selectedCats.size === 0 ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <Download size={16} />Importar {filtered.length} produtos<ChevronRight size={16} />
          </button>
        </div>
      </div>
    );
  }

  if (step === "importing") {
    return (
      <div style={{ textAlign: "center", padding: "1.75rem 0" }}>
        <div style={{ width: 44, height: 44, border: "4px solid #F1F5F9", borderTopColor: "#EA1D2C", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 12px" }} />
        <p style={{ fontWeight: 800, fontSize: "0.92rem", color: "#0F172A", margin: 0 }}>Sincronizando cardápio com iFood...</p>
      </div>
    );
  }

  if (step === "done" && result) {
    return (
      <div style={{ background: "#F0FDF4", borderRadius: 12, padding: "1.25rem", border: "1px solid #BBF7D0", textAlign: "center" }}>
        <div style={{ fontSize: "2.5rem", marginBottom: 8 }}>🎉</div>
        <p style={{ fontWeight: 800, fontSize: "1.05rem", margin: "0 0 4px", color: "#15803D" }}>Cardápio importado com sucesso!</p>
        <p style={{ fontSize: "0.85rem", color: "#166534", margin: "0 0 1rem" }}>{result.message}</p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
          <button onClick={reset} style={{ padding: "8px 16px", borderRadius: 8, border: "1.5px solid #16A34A", background: "#fff", color: "#16A34A", fontWeight: 700, fontSize: "0.82rem", cursor: "pointer" }}>Importar novamente</button>
          <a href="/store/cardapio" style={{ padding: "8px 18px", borderRadius: 8, border: "none", background: "#16A34A", color: "#fff", fontWeight: 800, fontSize: "0.82rem", cursor: "pointer", textDecoration: "none" }}>Ver Meus Produtos →</a>
        </div>
      </div>
    );
  }

  // IDLE
  return (
    <div style={{ background: "#F8FAFC", border: "1.5px solid #E2E8F0", borderRadius: 14, padding: "1.25rem" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: "1rem" }}>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: "#EA1D2C15", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Zap size={20} color="#EA1D2C" />
        </div>
        <div>
          <h4 style={{ margin: "0 0 4px", fontWeight: 800, fontSize: "0.95rem", color: "#0F172A" }}>
            Sincronização Direta da Sua Loja iFood
          </h4>
          <p style={{ margin: 0, fontSize: "0.83rem", color: "#64748B", lineHeight: 1.5 }}>
            Puxe todas as suas categorias, produtos, fotos e preços diretamente da sua conta iFood cadastrada no FireHub com apenas 1 clique.
          </p>
        </div>
      </div>

      <button onClick={handlePreview} disabled={loading}
        style={{
          width: "100%", padding: "12px 20px", borderRadius: 10, border: "none",
          background: loading ? "#94A3B8" : "linear-gradient(135deg, #EA1D2C, #C81E2B)",
          color: "#fff", fontWeight: 800, fontSize: "0.9rem", cursor: loading ? "not-allowed" : "pointer",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8, boxShadow: "0 4px 12px rgba(234, 29, 44, 0.25)"
        }}>
        {loading ? <><Loader size={16} style={{ animation: "spin 0.8s linear infinite" }} />Buscando no iFood...</> : <><Download size={18} />Buscar Cardápio do iFood Conectado</>}
      </button>
    </div>
  );
}

// ─── Tab 2: Importar Planilha (Excel/CSV do Portal) ─────────────────────────
function CsvImportTab() {
  const [csvText, setCsvText] = useState("");
  const [step, setStep] = useState<"idle" | "preview" | "importing" | "done" | "error">("idle");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<{ imported: number; skipped: number; message: string } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedCats, setSelected] = useState<Set<string>>(new Set());

  async function handlePreview() {
    if (!csvText.trim()) return;
    setLoading(true); setError("");
    try {
      const r = await fetch("/api/admin/import-csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csvText, mode: "preview" }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error || "Erro ao processar planilha"); setStep("error"); return; }
      setPreview(d);
      setSelected(new Set(d.categories));
      setStep("preview");
    } catch { setError("Erro de conexão."); setStep("error"); }
    finally { setLoading(false); }
  }

  async function handleImport() {
    setStep("importing"); setLoading(true);
    try {
      const r = await fetch("/api/admin/import-csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csvText, mode: "import", categories: Array.from(selectedCats) }),
      });

      const d = await r.json();
      if (!r.ok) { setError(d.error || "Erro ao importar"); setStep("error"); return; }
      setResult(d); setStep("done");
    } catch { setError("Erro de conexão."); setStep("error"); }
    finally { setLoading(false); }
  }

  function reset() {
    setStep("idle"); setCsvText(""); setPreview(null); setResult(null); setError("");
  }

  const filtered = preview?.products.filter(p => selectedCats.has(p.category)) ?? [];

  if (step === "error") {
    return (
      <div style={{ background: "#FEF2F2", borderRadius: 10, padding: "1rem", border: "1px solid #FECACA" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <AlertCircle size={16} color="#EF4444" />
          <span style={{ fontWeight: 700, fontSize: "0.875rem", color: "#B91C1C" }}>Erro ao processar</span>
        </div>
        <p style={{ fontSize: "0.82rem", color: "#7F1D1D", margin: "0 0 0.75rem" }}>{error}</p>
        <button onClick={reset} style={{ padding: "7px 16px", borderRadius: 8, border: "1.5px solid #EF4444", background: "#fff", color: "#EF4444", fontWeight: 600, fontSize: "0.82rem", cursor: "pointer" }}>Tentar Novamente</button>
      </div>
    );
  }

  if (step === "preview" && preview) {
    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "1rem", background: "#F0FDF4", borderRadius: 10, padding: "0.75rem 1rem", border: "1px solid #BBF7D0" }}>
          <CheckCircle size={16} color="#16A34A" />
          <span style={{ fontSize: "0.875rem", fontWeight: 700, color: "#15803D" }}>
            {preview.count} produtos encontrados em {preview.categories.length} categorias
          </span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: "1rem" }}>
          {preview.categories.map(cat => (
            <button key={cat}
              onClick={() => setSelected(prev => { const next = new Set(prev); next.has(cat) ? next.delete(cat) : next.add(cat); return next; })}
              style={{ padding: "5px 12px", borderRadius: 20, border: "1.5px solid", borderColor: selectedCats.has(cat) ? "#EA1D2C" : "#E2E8F0", background: selectedCats.has(cat) ? "#FFF1F2" : "#fff", color: selectedCats.has(cat) ? "#EA1D2C" : "#64748B", fontWeight: selectedCats.has(cat) ? 700 : 500, fontSize: "0.78rem", cursor: "pointer" }}>
              {selectedCats.has(cat) ? "✓ " : ""}{cat}
            </button>
          ))}
        </div>
        <div style={{ maxHeight: 200, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6, marginBottom: "1rem" }}>
          {filtered.slice(0, 20).map((p, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: "#F8FAFC", borderRadius: 8, border: "1px solid #E2E8F0" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontWeight: 600, fontSize: "0.82rem" }}>{p.name}</p>
                <p style={{ margin: 0, fontSize: "0.7rem", color: "#94A3B8" }}>{p.category} · R$ {p.price.toFixed(2)}</p>
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={reset} style={{ padding: "10px 16px", borderRadius: 10, border: "1.5px solid #E2E8F0", background: "#fff", color: "#64748B", fontWeight: 600, fontSize: "0.875rem", cursor: "pointer" }}>Cancelar</button>
          <button onClick={handleImport} disabled={selectedCats.size === 0}
            style={{ flex: 1, padding: "10px 20px", borderRadius: 10, border: "none", background: "#EA1D2C", color: "#fff", fontWeight: 700, fontSize: "0.9rem", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <Download size={16} />Importar {filtered.length} produtos
          </button>
        </div>
      </div>
    );
  }

  if (step === "importing") {
    return (
      <div style={{ textAlign: "center", padding: "1.5rem 0" }}>
        <div style={{ width: 40, height: 40, border: "4px solid #F1F5F9", borderTopColor: "#EA1D2C", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 12px" }} />
        <p style={{ fontWeight: 700, margin: 0 }}>Importando planilha...</p>
      </div>
    );
  }

  if (step === "done" && result) {
    return (
      <div style={{ background: "#F0FDF4", borderRadius: 10, padding: "1.25rem", border: "1px solid #BBF7D0", textAlign: "center" }}>
        <div style={{ fontSize: "2.5rem", marginBottom: 8 }}>🎉</div>
        <p style={{ fontWeight: 800, fontSize: "1rem", margin: "0 0 4px", color: "#15803D" }}>Importação concluída!</p>
        <p style={{ fontSize: "0.85rem", color: "#166534", margin: "0 0 1rem" }}>{result.message}</p>
        <a href="/store/cardapio" style={{ padding: "10px 24px", borderRadius: 8, border: "none", background: "#16A34A", color: "#fff", fontWeight: 700, fontSize: "0.88rem", cursor: "pointer", textDecoration: "none", display: "inline-block" }}>Ver Cardápio →</a>
      </div>
    );
  }

  // IDLE
  return (
    <>
      <div style={{ background: "#F8FAFC", border: "1.5px solid #E2E8F0", borderRadius: 12, padding: "1rem", marginBottom: "1rem" }}>
        <p style={{ fontWeight: 800, fontSize: "0.84rem", margin: "0 0 8px", color: "#0F172A" }}>📋 Como exportar a planilha do iFood Portal:</p>
        <ol style={{ margin: 0, paddingLeft: "1.25rem", fontSize: "0.8rem", color: "#475569", lineHeight: 1.8 }}>
          <li>Acesse <a href="https://portal.ifood.com.br" target="_blank" rel="noopener noreferrer" style={{ color: "#EA1D2C", fontWeight: 700 }}>portal.ifood.com.br</a></li>
          <li>Vá em <strong>Cardápio → Gerenciar Cardápio</strong></li>
          <li>Clique no botão <strong>Exportar</strong> e baixe a planilha</li>
          <li>Abra o arquivo, selecione todo o texto (<kbd>Ctrl+A</kbd>) e cole no campo abaixo:</li>
        </ol>
      </div>

      <textarea
        value={csvText}
        onChange={e => setCsvText(e.target.value)}
        placeholder={"Cole aqui as colunas copias da planilha (ex: Nome, Categoria, Preço, Descrição)..."}
        rows={5}
        style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1.5px solid #E2E8F0", fontSize: "0.82rem", fontFamily: "monospace", resize: "vertical", outline: "none", boxSizing: "border-box", marginBottom: 12 }}
      />

      <button onClick={handlePreview} disabled={loading || !csvText.trim()}
        style={{ width: "100%", padding: "11px", borderRadius: 10, border: "none", background: loading || !csvText.trim() ? "#94A3B8" : "#EA1D2C", color: "#fff", fontWeight: 800, fontSize: "0.9rem", cursor: loading || !csvText.trim() ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
        {loading ? <><Loader size={16} style={{ animation: "spin 0.8s linear infinite" }} />Processando...</> : <><FileSpreadsheet size={18} />Processar Planilha</>}
      </button>
    </>
  );
}

// ─── Componente Principal ─────────────────────────────────────────────────────
export default function IfoodImportButton() {
  const [activeTab, setActiveTab] = useState<"ifood" | "csv">("ifood");

  const tabStyle = (active: boolean) => ({
    flex: 1, padding: "10px 14px", border: "none", cursor: "pointer",
    fontWeight: 800, fontSize: "0.85rem", transition: "all 0.15s",
    background: active ? "#fff" : "transparent",
    color: active ? "#EA1D2C" : "#64748B",
    borderBottom: active ? "3px solid #EA1D2C" : "3px solid transparent",
  });

  return (
    <div style={{ marginBottom: "1.5rem" }}>
      {/* CARD PRINCIPAL DE IMPORTAÇÃO */}
      <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #E2E8F0", overflow: "hidden", boxShadow: "0 2px 10px rgba(0,0,0,0.03)" }}>
        {/* Header */}
        <div style={{ background: "linear-gradient(135deg, #EA1D2C, #C81E2B)", padding: "1.25rem 1.5rem", color: "#fff" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 40, height: 40, background: "rgba(255,255,255,0.2)", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Download size={20} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontWeight: 800, fontSize: "1.05rem" }}>Importar Cardápio do iFood</h3>
              <p style={{ margin: 0, fontSize: "0.78rem", opacity: 0.9 }}>Sincronização via API oficial ou planilha exportada do Portal</p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid #F1F5F9", background: "#FAFAFA" }}>
          <button style={tabStyle(activeTab === "ifood")} onClick={() => setActiveTab("ifood")}>
            ⚡ Sincronizar via iFood (API Oficial)
          </button>
          <button style={tabStyle(activeTab === "csv")} onClick={() => setActiveTab("csv")}>
            📊 Importar Planilha do iFood
          </button>
        </div>

        <div style={{ padding: "1.25rem 1.5rem" }}>
          {activeTab === "ifood" ? <IfoodApiTab /> : <CsvImportTab />}
        </div>
      </div>

      {/* BANNER SUPORTE WHATSAPP (SOLICITADO PELO LOJISTA) */}
      <div style={{
        background: "linear-gradient(135deg, #059669 0%, #10B981 100%)",
        borderRadius: 16,
        padding: "1.25rem 1.5rem",
        color: "#FFFFFF",
        boxShadow: "0 4px 20px rgba(16, 185, 129, 0.2)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: "1rem",
        marginTop: "1rem"
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "14px", flex: 1, minWidth: 260 }}>
          <div style={{
            width: 48, height: 48, borderRadius: "14px",
            background: "rgba(255,255,255,0.2)", display: "flex",
            alignItems: "center", justifyContent: "center", fontSize: "1.6rem", flexShrink: 0
          }}>
            💬
          </div>
          <div>
            <h4 style={{ margin: "0 0 4px", fontSize: "1.02rem", fontWeight: 900 }}>
              Está com dificuldade de lançar o seu cardápio?
            </h4>
            <p style={{ margin: 0, fontSize: "0.83rem", opacity: 0.95, lineHeight: 1.45 }}>
              Fale com nossa equipe no WhatsApp que nós cadastramos e organizamos tudo para você gratuitamente!
            </p>
          </div>
        </div>

        <a
          href="https://wa.me/5522981118514?text=Ol%C3%A1!%20Estou%20com%20dificuldade%20para%20cadastrar%20meu%20card%C3%A1pio%20no%20FireHub.%20Podem%20me%20ajudar?"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            background: "#FFFFFF",
            color: "#047857",
            padding: "11px 22px",
            borderRadius: "12px",
            fontWeight: 900,
            fontSize: "0.88rem",
            textDecoration: "none",
            whiteSpace: "nowrap",
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            boxShadow: "0 4px 14px rgba(0,0,0,0.12)",
            transition: "transform 0.2s"
          }}
        >
          <MessageSquare size={18} color="#047857" />
          <span>Falar com equipe no WhatsApp</span>
        </a>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
