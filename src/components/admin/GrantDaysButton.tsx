"use client";
import { useState } from "react";

export default function GrantDaysButton({ userId, storeName }: { userId: string; storeName: string }) {
  const [loading, setLoading] = useState(false);

  const handleGrant = async () => {
    const input = prompt(`Quantos dias de teste/benefício deseja conceder para "${storeName}"? (ex: 15 ou 30)`, "15");
    if (!input) return;
    const days = parseInt(input, 10);
    if (isNaN(days) || days <= 0) {
      alert("Por favor digite um número de dias válido.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/admin/grant-days", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, days }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        alert(data.message);
        window.location.reload();
      } else {
        alert(data.error || "Erro ao conceder dias.");
      }
    } catch (e) {
      alert("Erro ao conectar com o servidor.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleGrant}
      disabled={loading}
      style={{
        background: "rgba(16,185,129,0.1)",
        color: "#10B981",
        border: "1px solid rgba(16,185,129,0.3)",
        padding: "4px 8px",
        borderRadius: "6px",
        fontSize: "0.75rem",
        fontWeight: 700,
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
      title="Liberar 15, 30 ou X dias de benefício"
    >
      {loading ? "Salvando..." : "🎁 Liberar Dias"}
    </button>
  );
}
