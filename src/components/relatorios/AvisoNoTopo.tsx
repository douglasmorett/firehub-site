"use client";
/**
 * Aviso no topo das telas de relatório que GRAVAM alguma coisa (o estoque
 * ideal da Lista de compras) — cópia local do AvisoNoTopo do Perfil da loja,
 * como manda a regra da casa: nunca alert().
 */
import React, { useEffect } from "react";

export type Aviso = { tipo: "ok" | "erro" | "info"; titulo: string; detalhe?: string };
const COR = { ok: { cor: "#15803D", fundo: "#F0FDF4" }, erro: { cor: "#B91C1C", fundo: "#FEF2F2" }, info: { cor: "#1D4ED8", fundo: "#EFF6FF" } };

export default function AvisoNoTopo({ aviso, onFechar }: { aviso: Aviso | null; onFechar: () => void }) {
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(onFechar, aviso.tipo === "erro" ? 12000 : 4000);
    return () => clearTimeout(t);
  }, [aviso, onFechar]);
  if (!aviso) return null;
  const { cor, fundo } = COR[aviso.tipo];
  return (
    <div role={aviso.tipo === "erro" ? "alert" : "status"} onClick={onFechar} className="fh-sem-impressao"
      style={{
        position: "fixed", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 1200,
        width: "min(440px, calc(100vw - 24px))", background: fundo, borderLeft: `4px solid ${cor}`,
        borderRadius: 12, padding: "12px 14px", boxShadow: "0 10px 30px rgba(15,23,42,.18)", cursor: "pointer",
      }}>
      <div style={{ fontWeight: 800, fontSize: 14, color: "#0F172A" }}>{aviso.titulo}</div>
      {aviso.detalhe && <div style={{ fontSize: 13, color: "#475569", marginTop: 2 }}>{aviso.detalhe}</div>}
    </div>
  );
}
