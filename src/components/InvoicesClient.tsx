"use client";

import { useState, useRef, useEffect } from "react";
import { Camera, Upload, Receipt, CheckCircle, AlertCircle, Loader2, Trash2, Calendar, PenLine, Zap } from "lucide-react";

type InvoiceMode = "ai" | "manual";

export default function InvoicesClient({ role, canSeePersonal = false }: { role: string; canSeePersonal?: boolean }) {
  const [invoices, setInvoices]     = useState<any[]>([]);
  const [loading, setLoading]       = useState(true);
  const [uploading, setUploading]   = useState(false);
  const [error, setError]           = useState("");
  const [success, setSuccess]       = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory]     = useState<"BUSINESS" | "PERSONAL">("BUSINESS");
  const [mode, setMode]             = useState<InvoiceMode>("ai");
  const fileInputRef                = useRef<HTMLInputElement>(null);

  // Campos do formulário manual
  const [manualDesc, setManualDesc]       = useState("");
  const [manualValue, setManualValue]     = useState("");
  const [manualDate, setManualDate]       = useState(new Date().toISOString().slice(0, 10));
  const [manualCategory, setManualCategory] = useState("Outros");
  const [manualSupplier, setManualSupplier] = useState("");
  const [savingManual, setSavingManual]   = useState(false);

  const EXPENSE_CATS = [
    "Matéria-prima / Ingredientes", "Embalagens", "Gás / Combustível",
    "Manutenção / Equipamentos", "Limpeza / Higiene", "Marketing / Publicidade",
    "Aluguel / Condomínio", "Água / Energia / Internet", "Frete / Logística",
    "Material de Escritório", "Salários / Freelancers", "Impostos / Taxas",
    "Uniformes / EPI", "Outros",
  ];

  const fetchInvoices = async () => {
    try {
      const res = await fetch(`/api/invoices?category=${category}`);
      if (res.ok) setInvoices(await res.json());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { setLoading(true); fetchInvoices(); }, [category]);

  // ── MODO IA: upload + Gemini ─────────────────────────────────────────────
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!description.trim()) { setError("Por favor, digite a descrição ANTES de tirar a foto."); e.target.value = ""; return; }
    setError(""); setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("type", "invoice");
      const uploadRes = await fetch("/api/upload", { method: "POST", body: formData });
      const uploadData = await uploadRes.json();
      if (!uploadRes.ok) throw new Error(uploadData.error || "Erro ao enviar imagem");
      const imageUrl = uploadData.url;

      const aiRes = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl, description, category }),
      });
      const aiData = await aiRes.json();
      if (!aiRes.ok) throw new Error(aiData.error || "A IA rejeitou a nota fiscal.");

      setSuccess(`✅ Nota salva! Valor lido: R$ ${aiData.invoice?.aiValue?.toFixed(2) ?? "–"}`);
      setDescription("");
      fetchInvoices();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // ── MODO MANUAL: salva direto sem IA ────────────────────────────────────
  const handleManualSave = async () => {
    if (!manualDesc.trim()) { setError("Informe a descrição da nota."); return; }
    const valor = parseFloat(manualValue.replace(",", "."));
    if (!manualValue || isNaN(valor) || valor <= 0) { setError("Informe um valor válido (ex: 125,50)."); return; }
    setError(""); setSavingManual(true);
    try {
      const res = await fetch("/api/invoices/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: manualDesc,
          supplier: manualSupplier,
          value: valor,
          date: manualDate,
          category,
          expenseCategory: manualCategory,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao salvar.");
      setSuccess("✅ Nota inserida manualmente com sucesso!");
      setManualDesc(""); setManualValue(""); setManualSupplier(""); setManualCategory("Outros");
      setManualDate(new Date().toISOString().slice(0, 10));
      fetchInvoices();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSavingManual(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Excluir esta nota fiscal?")) return;
    try {
      const res = await fetch("/api/invoices", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      if (res.ok) { fetchInvoices(); } else alert("Erro ao excluir.");
    } catch { alert("Erro de conexão."); }
  };

  const totalGasto = invoices.reduce((acc, inv) => acc + (inv.aiValue || 0), 0);

  return (
    <div>
      {/* Cabeçalho */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem", flexWrap: "wrap", gap: "1rem" }}>
        <h1 className="font-bold" style={{ fontSize: "1.75rem" }}>Notas de Compras</h1>
        {canSeePersonal && (
          <div style={{ display: "flex", background: "var(--card-bg, #f1f5f9)", borderRadius: "10px", padding: "4px", border: "1px solid var(--border-color, #e2e8f0)" }}>
            {(["BUSINESS", "PERSONAL"] as const).map(cat => (
              <button key={cat} onClick={() => setCategory(cat)} style={{ padding: "8px 18px", borderRadius: "8px", border: "none", cursor: "pointer", fontWeight: 600, fontSize: "0.85rem", transition: "all 0.2s", background: category === cat ? (cat === "BUSINESS" ? "#DC2626" : "#7C3AED") : "transparent", color: category === cat ? "#fff" : "var(--text-muted, #64748b)", fontFamily: "inherit" }}>
                {cat === "BUSINESS" ? "🏢 Empresarial" : "👤 Pessoal"}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Feedback */}
      {error && (
        <div style={{ background: "#fee2e2", color: "#b91c1c", padding: "0.85rem 1rem", borderRadius: "10px", marginBottom: "1rem", display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <AlertCircle size={18} /><span>{error}</span>
          <button onClick={() => setError("")} style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "#b91c1c", fontSize: "1.1rem" }}>✕</button>
        </div>
      )}
      {success && (
        <div style={{ background: "#f0fdf4", color: "#15803d", padding: "0.85rem 1rem", borderRadius: "10px", marginBottom: "1rem", display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <CheckCircle size={18} /><span>{success}</span>
          <button onClick={() => setSuccess("")} style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "#15803d", fontSize: "1.1rem" }}>✕</button>
        </div>
      )}

      {/* Card de nova nota */}
      <div className="card" style={{ marginBottom: "2rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <h2 style={{ fontSize: "1.1rem", fontWeight: "bold", margin: 0 }}>Nova Nota Fiscal</h2>
          {/* Toggle AI / Manual */}
          <div style={{ display: "flex", background: "#f1f5f9", borderRadius: "10px", padding: "3px", gap: "2px" }}>
            <button onClick={() => { setMode("ai"); setError(""); setSuccess(""); }}
              style={{ padding: "6px 14px", borderRadius: "8px", border: "none", cursor: "pointer", fontWeight: 600, fontSize: "0.8rem", display: "flex", alignItems: "center", gap: 5, background: mode === "ai" ? "#DC2626" : "transparent", color: mode === "ai" ? "#fff" : "#64748b", fontFamily: "inherit" }}>
              <Zap size={13} /> IA (Foto)
            </button>
            <button onClick={() => { setMode("manual"); setError(""); setSuccess(""); }}
              style={{ padding: "6px 14px", borderRadius: "8px", border: "none", cursor: "pointer", fontWeight: 600, fontSize: "0.8rem", display: "flex", alignItems: "center", gap: 5, background: mode === "manual" ? "#2563EB" : "transparent", color: mode === "manual" ? "#fff" : "#64748b", fontFamily: "inherit" }}>
              <PenLine size={13} /> Manual
            </button>
          </div>
        </div>

        {/* ── MODO IA ── */}
        {mode === "ai" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <p style={{ fontSize: "0.82rem", color: "#64748b", margin: 0 }}>
              📸 Tire uma foto da nota e a IA extrai o valor automaticamente.
            </p>
            <div>
              <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: "bold" }}>📝 O que você comprou?</label>
              <textarea className="input" placeholder="Ex: Abastecimento do carro, Papelão, Manutenção..." value={description}
                onChange={e => setDescription(e.target.value)} disabled={uploading} rows={2}
                style={{ width: "100%", padding: "0.85rem", fontSize: "1rem", resize: "none", borderRadius: "10px", border: "2px solid var(--border-color)", boxSizing: "border-box" }} />
            </div>
            <button className="btn btn-primary" style={{ width: "100%", padding: "0.9rem", fontSize: "1rem" }} disabled={uploading}
              onClick={() => { if (!description.trim()) { setError("Digite a descrição primeiro!"); return; } fileInputRef.current?.click(); }}>
              {uploading ? <Loader2 className="animate-spin" size={20} /> : <Camera size={20} style={{ marginRight: "0.5rem" }} />}
              {uploading ? "A IA está lendo a nota..." : "Tirar Foto da Nota"}
            </button>
            <input type="file" accept="image/*" capture="environment" ref={fileInputRef} style={{ display: "none" }} onChange={handleFileChange} />
          </div>
        )}

        {/* ── MODO MANUAL ── */}
        {mode === "manual" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
            <p style={{ fontSize: "0.82rem", color: "#2563EB", margin: 0, background: "#EFF6FF", padding: "8px 12px", borderRadius: 8 }}>
              ✏️ Preencha os dados manualmente — sem precisar de foto.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
              <div style={{ gridColumn: "span 2" }}>
                <label style={{ fontWeight: 600, fontSize: "0.85rem", display: "block", marginBottom: 4 }}>Descrição *</label>
                <input className="input-field" placeholder="Ex: Compra de embalagens na papelaria" value={manualDesc}
                  onChange={e => setManualDesc(e.target.value)}
                  style={{ width: "100%", padding: "0.7rem", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: "0.9rem" }} />
              </div>
              <div>
                <label style={{ fontWeight: 600, fontSize: "0.85rem", display: "block", marginBottom: 4 }}>Valor (R$) *</label>
                <input className="input-field" placeholder="Ex: 125,90" value={manualValue}
                  onChange={e => setManualValue(e.target.value)} inputMode="decimal"
                  style={{ width: "100%", padding: "0.7rem", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: "0.9rem" }} />
              </div>
              <div>
                <label style={{ fontWeight: 600, fontSize: "0.85rem", display: "block", marginBottom: 4 }}>Data da Nota *</label>
                <input type="date" className="input-field" value={manualDate}
                  onChange={e => setManualDate(e.target.value)}
                  style={{ width: "100%", padding: "0.7rem", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: "0.9rem" }} />
              </div>
              <div>
                <label style={{ fontWeight: 600, fontSize: "0.85rem", display: "block", marginBottom: 4 }}>Fornecedor</label>
                <input className="input-field" placeholder="Ex: Distribuidora ABC" value={manualSupplier}
                  onChange={e => setManualSupplier(e.target.value)}
                  style={{ width: "100%", padding: "0.7rem", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: "0.9rem" }} />
              </div>
              <div>
                <label style={{ fontWeight: 600, fontSize: "0.85rem", display: "block", marginBottom: 4 }}>Categoria da Despesa</label>
                <select value={manualCategory} onChange={e => setManualCategory(e.target.value)}
                  style={{ width: "100%", padding: "0.7rem", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: "0.9rem", background: "#fff" }}>
                  {EXPENSE_CATS.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <button onClick={handleManualSave} disabled={savingManual}
              style={{ width: "100%", padding: "0.9rem", borderRadius: 10, border: "none", background: savingManual ? "#94a3b8" : "#2563EB", color: "#fff", fontWeight: 700, fontSize: "1rem", cursor: savingManual ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              <Receipt size={18} />
              {savingManual ? "Salvando..." : "Salvar Nota Manual"}
            </button>
          </div>
        )}
      </div>

      {/* Tabela de notas */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem", marginBottom: "1rem" }}>
        <h2 style={{ fontSize: "1.2rem", fontWeight: "bold" }}>Relatório de Gastos</h2>
        <div style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444", padding: "0.5rem 1rem", borderRadius: "20px", fontWeight: "bold" }}>
          Total: R$ {totalGasto.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
        </div>
      </div>

      <div className="card">
        {loading ? (
          <div style={{ textAlign: "center", padding: "2rem", color: "#94a3b8" }}><Loader2 className="animate-spin" size={24} style={{ margin: "0 auto 8px" }} /><p>Carregando notas...</p></div>
        ) : invoices.length === 0 ? (
          <p style={{ textAlign: "center", color: "#94a3b8", padding: "2rem" }}>Nenhuma nota registrada ainda.</p>
        ) : (
          <div style={{ overflowX: "auto", width: "100%" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border-color)", textAlign: "left" }}>
                  <th style={{ padding: "0.5rem" }}>Postagem</th>
                  <th style={{ padding: "0.5rem" }}>Data NF</th>
                  <th style={{ padding: "0.5rem" }}>Descrição</th>
                  <th style={{ padding: "0.5rem" }}>Categoria</th>
                  <th style={{ padding: "0.5rem" }}>Valor</th>
                  <th style={{ padding: "0.5rem", textAlign: "right" }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map(inv => (
                  <tr key={inv.id} style={{ borderBottom: "1px solid var(--border-color)" }}>
                    <td style={{ padding: "0.5rem", fontSize: "0.82rem", color: "var(--text-muted)" }}>
                      <div>{new Date(inv.createdAt).toLocaleDateString("pt-BR")}</div>
                      <div style={{ fontSize: "0.72rem", opacity: 0.7 }}>{inv.uploadedBy}</div>
                      {inv.source === "manual" && <span style={{ fontSize: "0.68rem", background: "#EFF6FF", color: "#2563EB", padding: "1px 5px", borderRadius: 4, fontWeight: 700 }}>MANUAL</span>}
                    </td>
                    <td style={{ padding: "0.5rem", fontWeight: 600 }}>
                      {inv.invoiceDate ? (
                        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <Calendar size={13} />{new Date(inv.invoiceDate).toLocaleDateString("pt-BR")}
                        </span>
                      ) : <span style={{ color: "#94a3b8", fontSize: "0.82rem" }}>–</span>}
                    </td>
                    <td style={{ padding: "0.5rem", fontWeight: 600, maxWidth: 200 }}>
                      <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{inv.description}</div>
                      {inv.aiCategory && <div style={{ fontSize: "0.72rem", color: "#94a3b8" }}>{inv.aiCategory}</div>}
                    </td>
                    <td style={{ padding: "0.5rem", color: "var(--text-muted)", fontSize: "0.82rem" }}>
                      {inv.category}
                    </td>
                    <td style={{ padding: "0.5rem", fontWeight: 700, color: "#ef4444" }}>
                      R$ {inv.aiValue?.toFixed(2) ?? "–"}
                    </td>
                    <td style={{ padding: "0.5rem", textAlign: "right" }}>
                      <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.4rem", alignItems: "center" }}>
                        {inv.imageUrl && (
                          <a href={inv.imageUrl} target="_blank" rel="noopener noreferrer"
                            style={{ padding: "4px 10px", borderRadius: 7, border: "1px solid #e2e8f0", background: "#fff", fontSize: "0.78rem", color: "#475569", textDecoration: "none", fontWeight: 600 }}>
                            Ver Foto
                          </a>
                        )}
                        <button onClick={() => handleDelete(inv.id)}
                          style={{ padding: "4px 8px", color: "#ef4444", background: "rgba(239,68,68,0.1)", border: "none", borderRadius: 7, cursor: "pointer" }}
                          title="Excluir">
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
