"use client";

import { useState, useRef } from "react";
import { createPayable } from "@/app/actions/finance";
import BarcodeScanner from "./BarcodeScanner";
import { Camera, ScanLine, Loader2, FileText, PenLine, ChevronDown, ChevronUp } from "lucide-react";

type InputMode = "manual" | "ai" | null;

export default function FinanceForm({ category = "BUSINESS" }: { category?: string }) {
  const [loading, setLoading] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [inputMode, setInputMode] = useState<InputMode>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    supplierName: "",
    barcode: "",
    receivedDate: "",
    dueDate: "",
    value: ""
  });
  const [aiLoading, setAiLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const clearMessages = () => {
    setErrorMsg(null);
    setSuccessMsg(null);
  };

  const handleAiScan = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setAiLoading(true);
    clearMessages();
    try {
      const uploadData = new FormData();
      uploadData.append("file", file);
      uploadData.append("type", "payable");

      const uploadRes = await fetch("/api/upload", { method: "POST", body: uploadData });
      const { url, error: upError } = await uploadRes.json();
      if (upError) throw new Error(upError);

      const aiRes = await fetch("/api/payables/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl: url })
      });
      const aiResponse = await aiRes.json();
      if (aiResponse.error) throw new Error(aiResponse.error);

      const data = aiResponse.data;
      
      // Verifica se a IA conseguiu extrair dados mínimos
      if (!data || (!data.supplierName && !data.value && !data.dueDate)) {
        setErrorMsg("📸 Tire outra foto, esta foto não estava legível. Tente em um ambiente mais iluminado e com a nota centralizada.");
        return;
      }
      
      setFormData(prev => ({
        ...prev,
        supplierName: data.supplierName || prev.supplierName,
        barcode: data.barcode || prev.barcode,
        dueDate: data.dueDate || prev.dueDate,
        value: data.value ? data.value.toString() : prev.value
      }));
      setSuccessMsg("✅ IA preencheu os dados encontrados! Confira e complete se necessário.");
    } catch (err: any) {
      // Se o erro indica problema na leitura da imagem
      const msg = err.message?.toLowerCase() || "";
      if (msg.includes("image") || msg.includes("photo") || msg.includes("read") || msg.includes("parse") || msg.includes("extract")) {
        setErrorMsg("📸 Tire outra foto, esta foto não estava legível. Tente em um ambiente mais iluminado e com a nota centralizada.");
      } else {
        setErrorMsg("Erro na IA: " + err.message);
      }
    } finally {
      setAiLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    clearMessages();

    // Validação local
    if (!formData.supplierName.trim()) {
      setErrorMsg("Informe o nome do fornecedor.");
      setLoading(false);
      return;
    }

    const numValue = parseFloat(formData.value);
    if (!formData.value || isNaN(numValue) || numValue <= 0) {
      setErrorMsg("Informe um valor válido maior que zero.");
      setLoading(false);
      return;
    }

    if (!formData.dueDate) {
      setErrorMsg("Informe a data de vencimento.");
      setLoading(false);
      return;
    }

    try {
      const result = await createPayable({
        ...formData,
        value: numValue,
        category
      });

      if (result && 'error' in result) {
        setErrorMsg(result.error || "Erro desconhecido ao registrar.");
      } else {
        setFormData({ supplierName: "", barcode: "", receivedDate: "", dueDate: "", value: "" });
        setSuccessMsg("✅ Conta registrada com sucesso!");
        setInputMode(null);
      }
    } catch (err: any) {
      setErrorMsg("Erro de conexão: " + (err?.message || "Tente novamente."));
    } finally {
      setLoading(false);
    }
  };

  const todayStr = new Date().toISOString().split("T")[0];

  return (
    <>
      {showScanner && (
        <BarcodeScanner 
          onClose={() => setShowScanner(false)} 
          onScan={(text) => {
            setFormData({ ...formData, barcode: text });
            setShowScanner(false);
          }} 
        />
      )}

      <div className="card mb-8" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <h2 className="font-bold text-lg">Registrar Nova Conta a Pagar</h2>

        {/* Mensagens de feedback */}
        {errorMsg && (
          <div style={{
            padding: "0.75rem 1rem",
            backgroundColor: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: "0.5rem",
            color: "#dc2626",
            fontSize: "0.9rem",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem"
          }}>
            <span>⚠️</span>
            <span>{errorMsg}</span>
            <button 
              type="button"
              onClick={() => setErrorMsg(null)} 
              style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", fontSize: "1.1rem", color: "#dc2626" }}
            >×</button>
          </div>
        )}
        {successMsg && (
          <div style={{
            padding: "0.75rem 1rem",
            backgroundColor: "#f0fdf4",
            border: "1px solid #bbf7d0",
            borderRadius: "0.5rem",
            color: "#16a34a",
            fontSize: "0.9rem",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem"
          }}>
            <span>{successMsg}</span>
            <button 
              type="button"
              onClick={() => setSuccessMsg(null)} 
              style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", fontSize: "1.1rem", color: "#16a34a" }}
            >×</button>
          </div>
        )}

        {/* Seletor de modo de entrada */}
        {inputMode === null && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <p style={{ fontSize: "0.9rem", color: "var(--text-muted)", margin: 0 }}>
              Escolha como deseja registrar:
            </p>
            <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => {
                  setInputMode("manual");
                  clearMessages();
                }}
                className="btn"
                style={{
                  flex: 1,
                  minWidth: "200px",
                  padding: "1rem",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "0.5rem",
                  backgroundColor: "var(--primary)",
                  color: "white",
                  borderRadius: "0.75rem",
                  border: "none",
                  cursor: "pointer",
                  fontSize: "0.95rem",
                  fontWeight: "bold",
                  transition: "all 0.2s ease"
                }}
              >
                <PenLine size={28} />
                ✍️ Registrar Manualmente
                <span style={{ fontSize: "0.75rem", fontWeight: "normal", opacity: 0.85 }}>
                  Preencha os campos do boleto
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setInputMode("ai");
                  clearMessages();
                  setTimeout(() => fileInputRef.current?.click(), 100);
                }}
                className="btn"
                disabled={aiLoading}
                style={{
                  flex: 1,
                  minWidth: "200px",
                  padding: "1rem",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "0.5rem",
                  backgroundColor: "#f59e0b",
                  color: "white",
                  borderRadius: "0.75rem",
                  border: "none",
                  cursor: "pointer",
                  fontSize: "0.95rem",
                  fontWeight: "bold",
                  transition: "all 0.2s ease"
                }}
              >
                {aiLoading ? <Loader2 size={28} className="animate-spin" /> : <Camera size={28} />}
                📸 Ler com Foto (IA)
                <span style={{ fontSize: "0.75rem", fontWeight: "normal", opacity: 0.85 }}>
                  Tire uma foto do boleto
                </span>
              </button>
            </div>
          </div>
        )}

        {/* Formulário manual ou preenchido pela IA */}
        {inputMode !== null && (
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            {/* Header do modo selecionado */}
            <div style={{ 
              display: "flex", 
              alignItems: "center", 
              justifyContent: "space-between",
              padding: "0.5rem 0.75rem",
              backgroundColor: inputMode === "manual" ? "#eff6ff" : "#fffbeb",
              borderRadius: "0.5rem",
              fontSize: "0.85rem",
              fontWeight: "bold",
              color: inputMode === "manual" ? "#2563eb" : "#d97706"
            }}>
              <span style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                {inputMode === "manual" ? <PenLine size={16} /> : <Camera size={16} />}
                {inputMode === "manual" ? "Modo Manual" : "Preenchido pela IA — Confira os dados"}
              </span>
              <button 
                type="button" 
                onClick={() => { setInputMode(null); clearMessages(); }}
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: "0.85rem", textDecoration: "underline", color: "inherit" }}
              >
                Voltar
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
              <div>
                <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem", fontWeight: "bold" }}>Nome do Fornecedor *</label>
                <input 
                  required 
                  type="text" 
                  className="input" 
                  placeholder="Ex: Gráfica Nova Era"
                  value={formData.supplierName}
                  onChange={e => setFormData({...formData, supplierName: e.target.value})}
                />
              </div>
              <div>
                <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem", fontWeight: "bold" }}>Valor (R$) *</label>
                <input 
                  required 
                  type="number" 
                  step="0.01"
                  className="input" 
                  placeholder="0.00"
                  value={formData.value}
                  onChange={e => setFormData({...formData, value: e.target.value})}
                />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
              <div>
                <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem", fontWeight: "bold" }}>Data de Recebimento</label>
                <input 
                  type="date" 
                  className="input" 
                  value={formData.receivedDate}
                  onChange={e => setFormData({...formData, receivedDate: e.target.value})}
                  placeholder={todayStr}
                />
                <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Se vazio, usa a data de hoje</span>
              </div>
              <div>
                <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem", fontWeight: "bold" }}>Data de Vencimento *</label>
                <input 
                  required 
                  type="date" 
                  className="input" 
                  value={formData.dueDate}
                  onChange={e => setFormData({...formData, dueDate: e.target.value})}
                />
              </div>
            </div>

            <div>
              <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem", fontWeight: "bold" }}>Código de Barras (Opcional)</label>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                <input 
                  type="text" 
                  className="input" 
                  style={{ flex: 1 }}
                  placeholder="Linha digitável do boleto"
                  value={formData.barcode}
                  onChange={e => setFormData({...formData, barcode: e.target.value})}
                />
                <button 
                  type="button" 
                  onClick={() => setShowScanner(true)}
                  className="btn btn-outline" 
                  style={{ display: "flex", alignItems: "center", gap: "0.5rem", whiteSpace: "nowrap", padding: "0.5rem 1rem" }}
                  title="Ler Código de Barras"
                >
                  <ScanLine size={18} /> Escanear
                </button>
              </div>
            </div>

            {/* Botões de ação no modo AI */}
            {inputMode === "ai" && (
              <button 
                type="button" 
                onClick={() => fileInputRef.current?.click()}
                className="btn" 
                disabled={aiLoading}
                style={{ 
                  display: "flex", 
                  alignItems: "center", 
                  justifyContent: "center",
                  gap: "0.5rem", 
                  padding: "0.5rem 1rem",
                  backgroundColor: "#f59e0b",
                  color: "white",
                  border: "none",
                  borderRadius: "0.5rem",
                  cursor: "pointer",
                  alignSelf: "flex-start"
                }}
              >
                {aiLoading ? <Loader2 size={18} className="animate-spin" /> : <Camera size={18} />}
                {aiLoading ? "Processando foto..." : "📸 Tirar outra foto (IA)"}
              </button>
            )}

            <button 
              type="submit" 
              className="btn btn-primary" 
              disabled={loading} 
              style={{ alignSelf: "flex-start", marginTop: "0.5rem", padding: "0.65rem 1.5rem", fontSize: "1rem" }}
            >
              {loading ? "Registrando..." : "✅ Registrar Conta"}
            </button>
          </form>
        )}

        {/* Input oculto para a câmera */}
        <input 
          type="file" 
          accept="image/*" 
          capture="environment" 
          ref={fileInputRef} 
          style={{ display: "none" }} 
          onChange={handleAiScan}
        />
      </div>
    </>
  );
}
