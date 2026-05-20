"use client";

import { useState } from "react";
import { changePassword } from "@/app/actions/changePassword";
import { Eye, EyeOff, Lock, CheckCircle } from "lucide-react";

export default function ProfileClient() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess(false);

    if (!currentPassword || !newPassword || !confirmPassword) {
      setError("Preencha todos os campos.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("As senhas não coincidem.");
      return;
    }

    if (newPassword.length < 6) {
      setError("A nova senha deve ter pelo menos 6 caracteres.");
      return;
    }

    setLoading(true);
    try {
      await changePassword(currentPassword, newPassword);
      setSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: any) {
      setError(err.message || "Erro ao alterar senha.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      background: "#fff", borderRadius: 16, border: "1px solid #E2E8F0",
      padding: "1.25rem", boxShadow: "0 2px 12px rgba(0,0,0,0.04)",
    }}>
      <h2 style={{
        fontSize: "0.9rem", fontWeight: 700, color: "#0F172A",
        marginBottom: "1rem", paddingBottom: "0.6rem",
        borderBottom: "2px solid #E2E8F0",
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <Lock size={16} /> Alterar Senha
      </h2>

      {success && (
        <div style={{
          background: "#F0FDF4", border: "1.5px solid #BBF7D0",
          borderRadius: 12, padding: "0.85rem 1rem", marginBottom: "1rem",
          display: "flex", alignItems: "center", gap: 8,
          color: "#166534", fontSize: "0.88rem", fontWeight: 600,
        }}>
          <CheckCircle size={18} /> Senha alterada com sucesso!
        </div>
      )}

      {error && (
        <div style={{
          background: "#FEF2F2", border: "1.5px solid #FECACA",
          borderRadius: 12, padding: "0.85rem 1rem", marginBottom: "1rem",
          color: "#DC2626", fontSize: "0.85rem", fontWeight: 600,
        }}>
          ❌ {error}
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
        {/* Senha Atual */}
        <div>
          <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#374151", marginBottom: 4 }}>
            Senha Atual
          </label>
          <div style={{ position: "relative" }}>
            <input
              type={showCurrent ? "text" : "password"}
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              placeholder="Digite sua senha atual"
              style={{
                width: "100%", padding: "0.75rem 2.5rem 0.75rem 0.85rem",
                borderRadius: 10, border: "1.5px solid #E2E8F0",
                fontSize: "0.9rem", outline: "none", fontFamily: "inherit",
                background: "#F8FAFC", boxSizing: "border-box",
              }}
            />
            <button
              type="button"
              onClick={() => setShowCurrent(!showCurrent)}
              style={{
                position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)",
                background: "none", border: "none", cursor: "pointer", color: "#94A3B8",
                padding: 4,
              }}
            >
              {showCurrent ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </div>

        {/* Nova Senha */}
        <div>
          <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#374151", marginBottom: 4 }}>
            Nova Senha
          </label>
          <div style={{ position: "relative" }}>
            <input
              type={showNew ? "text" : "password"}
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              placeholder="Mínimo 6 caracteres"
              style={{
                width: "100%", padding: "0.75rem 2.5rem 0.75rem 0.85rem",
                borderRadius: 10, border: "1.5px solid #E2E8F0",
                fontSize: "0.9rem", outline: "none", fontFamily: "inherit",
                background: "#F8FAFC", boxSizing: "border-box",
              }}
            />
            <button
              type="button"
              onClick={() => setShowNew(!showNew)}
              style={{
                position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)",
                background: "none", border: "none", cursor: "pointer", color: "#94A3B8",
                padding: 4,
              }}
            >
              {showNew ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </div>

        {/* Confirmar Senha */}
        <div>
          <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#374151", marginBottom: 4 }}>
            Confirmar Nova Senha
          </label>
          <input
            type="password"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            placeholder="Repita a nova senha"
            style={{
              width: "100%", padding: "0.75rem 0.85rem",
              borderRadius: 10, border: "1.5px solid #E2E8F0",
              fontSize: "0.9rem", outline: "none", fontFamily: "inherit",
              background: "#F8FAFC", boxSizing: "border-box",
            }}
          />
          {confirmPassword && newPassword && confirmPassword !== newPassword && (
            <p style={{ color: "#DC2626", fontSize: "0.75rem", marginTop: 4, fontWeight: 600 }}>
              As senhas não coincidem
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={loading || !currentPassword || !newPassword || !confirmPassword}
          style={{
            width: "100%", padding: "0.85rem",
            borderRadius: 12, border: "none",
            background: loading || !currentPassword || !newPassword || !confirmPassword
              ? "#94A3B8"
              : "linear-gradient(135deg, #1565C0, #1976D2)",
            color: "#fff", fontWeight: 800, fontSize: "0.95rem",
            cursor: loading ? "not-allowed" : "pointer",
            fontFamily: "inherit", marginTop: "0.25rem",
            boxShadow: loading ? "none" : "0 4px 12px rgba(21,101,192,0.3)",
            transition: "all 0.2s",
          }}
        >
          {loading ? "⏳ Alterando..." : "🔒 Alterar Senha"}
        </button>
      </form>
    </div>
  );
}
