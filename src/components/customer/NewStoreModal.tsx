"use client";

import { useState } from "react";
import { X, Store, MapPin, Phone, Building2, FileText, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";

export default function NewStoreModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form, setForm] = useState({ storeName: "", storeAddress: "", storePhone: "", city: "", cpfCnpj: "" });
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.storeName.trim()) { setError("Nome da loja é obrigatório"); return; }
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/store/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSuccess(true);
        setTimeout(() => window.location.reload(), 1500);
      } else {
        setError(data.error || "Erro ao cadastrar loja");
      }
    } catch (err: any) {
      setError(err.message || "Erro de conexão");
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (field: string, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
    if (error) setError("");
  };

  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
      background: "rgba(0,0,0,0.6)", backdropFilter: "blur(6px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 9999, padding: "1rem",
    }} onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "#fff", borderRadius: 20, width: "100%", maxWidth: 520,
          boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
          overflow: "hidden", animation: "slideUp 0.3s ease",
        }}
      >
        {/* Header */}
        <div style={{
          background: "linear-gradient(135deg, #B71C1C, #C62828)",
          padding: "1.5rem 1.5rem 1.25rem", position: "relative",
        }}>
          <button onClick={onClose} style={{
            position: "absolute", top: 12, right: 12, background: "rgba(255,255,255,0.2)",
            border: "none", borderRadius: 8, width: 32, height: 32, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", color: "#fff",
          }}>
            <X size={16} />
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 44, height: 44, borderRadius: 12,
              background: "rgba(255,255,255,0.15)", display: "flex",
              alignItems: "center", justifyContent: "center",
            }}>
              <Store size={22} color="#fff" />
            </div>
            <div>
              <h2 style={{ margin: 0, color: "#fff", fontWeight: 900, fontSize: "1.2rem" }}>
                Cadastrar Nova Loja
              </h2>
              <p style={{ margin: 0, color: "rgba(255,255,255,0.7)", fontSize: "0.8rem", fontWeight: 500 }}>
                Expanda sua operação com uma nova unidade
              </p>
            </div>
          </div>
        </div>

        {success ? (
          /* Tela de sucesso */
          <div style={{ padding: "3rem 2rem", textAlign: "center" }}>
            <div style={{
              width: 64, height: 64, borderRadius: "50%",
              background: "#DCFCE7", display: "flex",
              alignItems: "center", justifyContent: "center",
              margin: "0 auto 1rem",
            }}>
              <CheckCircle2 size={32} color="#16A34A" />
            </div>
            <h3 style={{ margin: "0 0 6px", fontWeight: 900, fontSize: "1.2rem", color: "#0F172A" }}>
              Loja cadastrada com sucesso! 🎉
            </h3>
            <p style={{ margin: 0, color: "#64748B", fontSize: "0.85rem" }}>
              Recarregando para exibir a nova loja...
            </p>
          </div>
        ) : (
          /* Formulário */
          <form onSubmit={handleSubmit} style={{ padding: "1.5rem" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              {/* Nome da Loja */}
              <div>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.78rem", fontWeight: 700, color: "#334155", marginBottom: 5 }}>
                  <Store size={13} /> Nome da Loja *
                </label>
                <input
                  type="text" required value={form.storeName}
                  onChange={e => handleChange("storeName", e.target.value)}
                  placeholder="Ex: Hakim Praia, Loja Centro..."
                  style={{
                    width: "100%", padding: "10px 14px", borderRadius: 10,
                    border: "1.5px solid #E2E8F0", fontSize: "0.88rem", fontFamily: "inherit",
                    outline: "none", transition: "border 0.2s",
                  }}
                  onFocus={e => e.target.style.borderColor = "#C62828"}
                  onBlur={e => e.target.style.borderColor = "#E2E8F0"}
                />
              </div>

              {/* Cidade + Telefone */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                <div>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.78rem", fontWeight: 700, color: "#334155", marginBottom: 5 }}>
                    <MapPin size={13} /> Cidade
                  </label>
                  <input
                    type="text" value={form.city}
                    onChange={e => handleChange("city", e.target.value)}
                    placeholder="Rio das Ostras"
                    style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1.5px solid #E2E8F0", fontSize: "0.88rem", fontFamily: "inherit", outline: "none" }}
                  />
                </div>
                <div>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.78rem", fontWeight: 700, color: "#334155", marginBottom: 5 }}>
                    <Phone size={13} /> Telefone
                  </label>
                  <input
                    type="tel" value={form.storePhone}
                    onChange={e => handleChange("storePhone", e.target.value)}
                    placeholder="(22) 99999-9999"
                    style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1.5px solid #E2E8F0", fontSize: "0.88rem", fontFamily: "inherit", outline: "none" }}
                  />
                </div>
              </div>

              {/* Endereço */}
              <div>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.78rem", fontWeight: 700, color: "#334155", marginBottom: 5 }}>
                  <Building2 size={13} /> Endereço
                </label>
                <input
                  type="text" value={form.storeAddress}
                  onChange={e => handleChange("storeAddress", e.target.value)}
                  placeholder="Rua, número, bairro..."
                  style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1.5px solid #E2E8F0", fontSize: "0.88rem", fontFamily: "inherit", outline: "none" }}
                />
              </div>

              {/* CNPJ/CPF */}
              <div>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.78rem", fontWeight: 700, color: "#334155", marginBottom: 5 }}>
                  <FileText size={13} /> CNPJ / CPF
                </label>
                <input
                  type="text" value={form.cpfCnpj}
                  onChange={e => handleChange("cpfCnpj", e.target.value)}
                  placeholder="00.000.000/0001-00"
                  style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1.5px solid #E2E8F0", fontSize: "0.88rem", fontFamily: "inherit", outline: "none" }}
                />
              </div>
            </div>

            {/* Aviso de cobrança */}
            <div style={{
              marginTop: "1.25rem", padding: "0.85rem 1rem", borderRadius: 12,
              background: "#FFF7ED", border: "1.5px solid #FDBA74",
              display: "flex", alignItems: "flex-start", gap: 10,
            }}>
              <AlertTriangle size={18} color="#D97706" style={{ flexShrink: 0, marginTop: 1 }} />
              <div style={{ fontSize: "0.78rem", color: "#92400E", lineHeight: 1.5 }}>
                <strong>Cobrança Mensal</strong><br />
                Uma cobrança mensal FireHub será gerada para esta unidade, baseada no faturamento dela.
                Cada loja opera de forma independente com seu próprio cardápio, pedidos, estoque e equipe.
              </div>
            </div>

            {error && (
              <div style={{
                marginTop: "0.75rem", padding: "8px 12px", borderRadius: 8,
                background: "#FEF2F2", border: "1px solid #FECACA",
                color: "#DC2626", fontSize: "0.8rem", fontWeight: 600,
              }}>
                ❌ {error}
              </div>
            )}

            {/* Botão */}
            <button
              type="submit" disabled={loading}
              style={{
                marginTop: "1.25rem", width: "100%", padding: "12px",
                borderRadius: 12, border: "none", cursor: loading ? "not-allowed" : "pointer",
                background: loading ? "#94A3B8" : "linear-gradient(135deg, #B71C1C, #C62828)",
                color: "#fff", fontWeight: 900, fontSize: "0.95rem", fontFamily: "inherit",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                boxShadow: loading ? "none" : "0 6px 20px rgba(183,28,28,0.3)",
                transition: "all 0.2s",
              }}
            >
              {loading ? (
                <><Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} /> Cadastrando...</>
              ) : (
                <>🏪 Cadastrar Loja</>
              )}
            </button>
          </form>
        )}

        <style>{`
          @keyframes slideUp { from { opacity: 0; transform: translateY(30px); } to { opacity: 1; transform: translateY(0); } }
          @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        `}</style>
      </div>
    </div>
  );
}
