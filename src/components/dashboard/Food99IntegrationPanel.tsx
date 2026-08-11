"use client";

import { useState } from "react";
import { toast } from "react-hot-toast";

export default function Food99IntegrationPanel({
  userId,
  connected,
  merchantId,
}: {
  userId: string;
  connected: boolean;
  merchantId: string | null;
}) {
  const [loading, setLoading] = useState(false);
  const [shopId, setShopId] = useState(merchantId || "");

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    if (!shopId.trim()) {
      toast.error("Informe o ID da Loja (Merchant ID).");
      return;
    }
    
    setLoading(true);
    try {
      const res = await fetch("/api/99food/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shopId: shopId.trim(), action: "connect" }),
      });
      if (res.ok) {
        toast.success("Loja vinculada à 99Food!");
        setTimeout(() => window.location.reload(), 1500);
      } else {
        const err = await res.json();
        toast.error(err.error || "Erro ao conectar");
      }
    } catch (error) {
      toast.error("Falha na requisição");
    }
    setLoading(false);
  }

  async function handleDisconnect() {
    if (!confirm("Tem certeza que deseja desconectar a 99Food?")) return;
    setLoading(true);
    try {
      const res = await fetch("/api/99food/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "disconnect" }),
      });
      if (res.ok) {
        toast.success("Desconectado com sucesso.");
        setTimeout(() => window.location.reload(), 1500);
      } else {
        toast.error("Erro ao desconectar");
      }
    } catch (error) {
      toast.error("Falha na requisição");
    }
    setLoading(false);
  }

  return (
    <div style={{ background: "#FFF", borderRadius: "12px", border: "1px solid #E2E8F0", padding: "24px", display: "flex", flexDirection: "column", gap: "16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <div style={{ background: "#FFCC00", padding: "8px", borderRadius: "8px", fontWeight: 900, color: "#000" }}>99Food</div>
        <div>
          <h3 style={{ fontSize: "1.1rem", fontWeight: 800, margin: 0, color: "#1E293B" }}>Integração 99Food</h3>
          <p style={{ margin: 0, fontSize: "0.85rem", color: "#64748B" }}>Receba pedidos da 99 direto no FireHub</p>
        </div>
      </div>

      {connected ? (
        <div style={{ background: "#F8FAFC", padding: "16px", borderRadius: "8px", border: "1px solid #E2E8F0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
            <span style={{ width: "10px", height: "10px", background: "#10B981", borderRadius: "50%", display: "inline-block" }}></span>
            <span style={{ fontWeight: 700, color: "#10B981", fontSize: "0.9rem" }}>Conectado</span>
          </div>
          <p style={{ margin: "0 0 16px 0", fontSize: "0.85rem", color: "#475569" }}>
            Loja ID: <strong>{merchantId}</strong>
          </p>
          <button 
            onClick={handleDisconnect}
            disabled={loading}
            style={{ padding: "8px 16px", borderRadius: "6px", border: "1px solid #EF4444", background: "#FEF2F2", color: "#EF4444", fontWeight: 700, cursor: "pointer", width: "100%" }}
          >
            {loading ? "Desconectando..." : "Desconectar 99Food"}
          </button>
        </div>
      ) : (
        <form onSubmit={handleConnect} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ padding: "12px", background: "#F1F5F9", borderRadius: "8px", fontSize: "0.85rem", color: "#334155" }}>
            Para integrar, acesse o portal da 99Food da sua loja e localize o seu <strong>Merchant ID</strong> (ID da Loja).
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 700, color: "#475569", marginBottom: "4px" }}>
              ID da Loja (Shop ID)
            </label>
            <input 
              value={shopId}
              onChange={(e) => setShopId(e.target.value)}
              placeholder="Ex: 5040333..."
              style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid #CBD5E1", outline: "none" }}
            />
          </div>
          <button 
            type="submit"
            disabled={loading}
            style={{ padding: "10px 16px", borderRadius: "6px", border: "none", background: "#FFCC00", color: "#000", fontWeight: 800, cursor: "pointer", marginTop: "8px" }}
          >
            {loading ? "Conectando..." : "Conectar à 99Food"}
          </button>
        </form>
      )}
    </div>
  );
}
