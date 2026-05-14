"use client";

import { useState } from "react";
import { markPayableAsPaid, deletePayable } from "@/app/actions/finance";

export function MarkPaidButton({ id }: { id: string }) {
  const [loading, setLoading] = useState(false);

  const handlePaid = async () => {
    if (!confirm("Confirmar baixa deste boleto?")) return;
    setLoading(true);
    try {
      await markPayableAsPaid(id);
    } catch (e) {
      alert("Erro ao dar baixa.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <button onClick={handlePaid} disabled={loading} className="btn" style={{ padding: "0.25rem 0.5rem", fontSize: "0.85rem", backgroundColor: "var(--success)", color: "white" }}>
      Dar Baixa
    </button>
  );
}

export function DeletePayableButton({ id }: { id: string }) {
  const [loading, setLoading] = useState(false);

  const handleDelete = async () => {
    if (!confirm("Excluir este registro?")) return;
    setLoading(true);
    try {
      await deletePayable(id);
    } catch (e) {
      alert("Erro ao excluir.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <button onClick={handleDelete} disabled={loading} className="btn btn-outline" style={{ padding: "0.25rem 0.5rem", fontSize: "0.85rem", color: "var(--danger)" }}>
      Excluir
    </button>
  );
}

export function BarcodeDisplay({ barcode }: { barcode: string | null }) {
  const [copied, setCopied] = useState(false);

  if (!barcode) return <span>-</span>;

  const handleCopy = () => {
    navigator.clipboard.writeText(barcode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
      <span style={{ 
        fontFamily: "monospace", 
        fontSize: "0.75rem", 
        maxWidth: "180px", 
        display: "inline-block", 
        overflow: "hidden", 
        textOverflow: "ellipsis", 
        whiteSpace: "nowrap" 
      }} title={barcode}>
        {barcode}
      </span>
      <button 
        onClick={handleCopy}
        title="Copiar código de barras"
        style={{
          background: copied ? "var(--success)" : "var(--primary)",
          color: "white",
          border: "none",
          borderRadius: "4px",
          padding: "4px 8px",
          fontSize: "0.75rem",
          cursor: "pointer",
          transition: "background 0.3s"
        }}
      >
        {copied ? "Copiado!" : "Copiar"}
      </button>
    </div>
  );
}
