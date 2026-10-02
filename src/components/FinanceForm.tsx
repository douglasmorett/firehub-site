"use client";

import { useState, useRef } from "react";
import { createPayable } from "@/app/actions/finance";
import BarcodeScanner from "./BarcodeScanner";
import { Camera, ScanLine, Loader2, FileText, PenLine, ChevronDown, ChevronUp } from "lucide-react";

type InputMode = "manual" | "ai" | null;

/**
 * O valor em reais do jeito que o lojista escreve: "1.200,00", "1200,50",
 * "R$ 850", "1.200". O campo era type="number", e o Chrome em português
 * descarta a vírgula de "1.200,00" sem avisar: o acordo de R$ 1.200 ia gravar
 * R$ 1,20. Ponto seguido de exatamente 3 dígitos é milhar; vírgula é decimal.
 */
function lerReais(texto: string): number | null {
  let t = texto.replace(/r\$/gi, "").replace(/\s+/g, "");
  if (!t) return null;
  if (t.includes(",")) {
    t = t.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(t)) {
    t = t.replace(/\./g, "");
  }
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Number(t);
}

const emReais = (n: number) => n.toFixed(2).replace(".", ",");

/**
 * `onSaved` avisa a tela que uma conta entrou. Sem ele o formulário gravava, dizia
 * "registrada com sucesso" e a lista continuava a mesma até um F5 — que era
 * exatamente a impressão de que o lançamento não tinha funcionado.
 */
export default function FinanceForm({ category = "BUSINESS", categorias, onSaved }: {
  category?: string;
  /** Sugestões do campo Categoria; sem elas o campo não aparece. */
  categorias?: string[];
  onSaved?: () => void;
}) {
  const [categoria, setCategoria] = useState("");
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
        value: typeof data.value === "number" && data.value > 0 ? emReais(data.value) : data.value ? String(data.value) : prev.value
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

    const numValue = lerReais(formData.value);
    if (numValue === null || numValue <= 0) {
      setErrorMsg("Informe o valor em reais, por exemplo 1.200,00.");
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
        category: categoria.trim() || category
      });

      if (result && 'error' in result) {
        setErrorMsg(result.error || "Erro desconhecido ao registrar.");
      } else {
        setFormData({ supplierName: "", barcode: "", receivedDate: "", dueDate: "", value: "" });
        setCategoria("");
        setSuccessMsg("✅ Conta registrada! Ela já aparece na lista abaixo.");
        setInputMode(null);
        onSaved?.();
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
            color: "#C92E09",
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
              style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", fontSize: "1.1rem", color: "#C92E09" }}
            >×</button>
          </div>
        )}
        {successMsg && (
          <div style={{
            padding: "0.75rem 1rem",
            backgroundColor: "#F0FDFA",
            border: "1px solid #99F6E4",
            borderRadius: "0.5rem",
            color: "#0F766E",
            fontSize: "0.9rem",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem"
          }}>
            <span>{successMsg}</span>
            <button 
              type="button"
              onClick={() => setSuccessMsg(null)} 
              style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", fontSize: "1.1rem", color: "#0F766E" }}
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
                  backgroundColor: "#B45309",
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

        {/* Formulário manual ou preenchido pela IA.
            noValidate: o balão do navegador ("Preencha este campo") some em um
            segundo e o lojista lia "não salvou". A validação do handleSubmit
            cobre os mesmos campos e fala na caixa vermelha, que fica. */}
        {inputMode !== null && (
          <form noValidate onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            {/* Header do modo selecionado */}
            <div style={{ 
              display: "flex", 
              alignItems: "center", 
              justifyContent: "space-between",
              padding: "0.5rem 0.75rem",
              backgroundColor: inputMode === "manual" ? "#FAF6F2" : "#FFF7E6",
              borderRadius: "0.5rem",
              fontSize: "0.85rem",
              fontWeight: "bold",
              color: inputMode === "manual" ? "#1C1917" : "#B45309"
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
                  type="text"
                  inputMode="decimal"
                  className="input"
                  placeholder="1.200,00"
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

            {categorias && (
              <div>
                <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem", fontWeight: "bold" }}>Categoria (Opcional)</label>
                <input
                  type="text"
                  className="input"
                  list="categorias-da-conta"
                  maxLength={60}
                  placeholder="Ex: Funcionários e acordos"
                  value={categoria}
                  onChange={e => setCategoria(e.target.value)}
                />
                <datalist id="categorias-da-conta">
                  {categorias.map(c => <option key={c} value={c} />)}
                </datalist>
                <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Escolha da lista ou escreva uma nova</span>
              </div>
            )}

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
                  backgroundColor: "#B45309",
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

            {/* Repete o erro junto do botão: a caixa do topo fica fora da tela no celular. */}
            {errorMsg && (
              <div role="alert" style={{ color: "#C92E09", fontSize: "0.85rem", fontWeight: "bold" }}>
                ⚠️ {errorMsg}
              </div>
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
