"use client";

import { useState } from "react";

export default function ToggleFranqueadoHakim({ userId, initialValue }: { userId: string; initialValue: boolean }) {
  const [checked, setChecked] = useState(initialValue);
  const [loading, setLoading] = useState(false);

  const handleToggle = async () => {
    setLoading(true);
    const newVal = !checked;
    try {
      const res = await fetch("/api/admin/toggle-franqueado", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, isFranqueadoHakim: newVal })
      });
      if (res.ok) {
        setChecked(newVal);
      } else {
        alert("Erro ao atualizar");
      }
    } catch {
      alert("Erro de conexão");
    }
    setLoading(false);
  };

  return (
    <label style={{
      display: "inline-flex", alignItems: "center", gap: "8px",
      cursor: loading ? "wait" : "pointer", userSelect: "none",
      padding: "0.35rem 0.75rem", borderRadius: "8px",
      background: checked ? "rgba(198,40,40,0.08)" : "rgba(0,0,0,0.03)",
      border: checked ? "1.5px solid #C62828" : "1.5px solid #E2E8F0",
      transition: "all 0.2s"
    }}>
      <div style={{
        width: "18px", height: "18px", borderRadius: "4px",
        border: checked ? "2px solid #C62828" : "2px solid #CBD5E1",
        background: checked ? "#C62828" : "#fff",
        display: "flex", alignItems: "center", justifyContent: "center",
        transition: "all 0.2s"
      }} onClick={handleToggle}>
        {checked && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </div>
      <span style={{
        fontSize: "0.82rem", fontWeight: checked ? 700 : 500,
        color: checked ? "#C62828" : "#64748B"
      }} onClick={handleToggle}>
        Franqueado Hakim
      </span>
      {checked && (
        <span style={{ fontSize: "0.65rem", background: "#C62828", color: "#fff", padding: "1px 6px", borderRadius: "4px", fontWeight: 700 }}>
          HK
        </span>
      )}
    </label>
  );
}
