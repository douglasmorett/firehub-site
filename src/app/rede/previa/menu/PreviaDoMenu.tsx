"use client";

// PRÉVIA (sem login e sem banco): onde o Multimarcas aparece no painel — o menu
// lateral de verdade e o topo da tela de Cardápio com a faixa, antes e depois de ativar.

import { useState } from "react";
import StoreSidebar from "@/components/customer/StoreSidebar";
import ConviteDoMultimarcas from "@/components/customer/ConviteDoMultimarcas";

export default function PreviaDoMenu() {
  const [ativo, setAtivo] = useState(false);
  try { localStorage.removeItem("firehub-convite-multimarcas-fechado"); } catch {}
  return (
    <div className="fh-painel" style={{ minHeight: "100vh", display: "flex", backgroundColor: "#F5F5F5" }}>
      <StoreSidebar nomeDaLoja="Cozinha Central" cidade="São Gonçalo" slug="cozinha-central" />
      <div className="fh-conteudo" style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <div style={{ background: "#FFF3BF", borderBottom: "1px solid #FFE066", padding: "10px 16px", fontSize: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <b>Prévia:</b> tela de Cardápio —
          <button onClick={() => setAtivo(false)} style={{ fontWeight: 700, padding: "6px 12px", borderRadius: 8, border: "1px solid #E9C46A", background: ativo ? "#fff" : "#1d1b19", color: ativo ? "#1d1b19" : "#fff", cursor: "pointer" }}>Antes de ativar</button>
          <button onClick={() => setAtivo(true)} style={{ fontWeight: 700, padding: "6px 12px", borderRadius: 8, border: "1px solid #E9C46A", background: ativo ? "#1d1b19" : "#fff", color: ativo ? "#fff" : "#1d1b19", cursor: "pointer" }}>Depois de ativar</button>
          <span style={{ color: "#6b5a00" }}>O item &quot;Multimarcas&quot; está no menu à esquerda, em Cardápio &amp; vendas.</span>
        </div>
        <main style={{ flex: 1, minWidth: 0 }}>
          <div className="container" style={{ marginTop: "1.5rem" }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem", marginBottom: "1.5rem" }}>
              <div>
                <h1 className="font-bold" style={{ fontSize: "1.8rem", margin: 0 }}>🍽️ Cardápio Digital</h1>
                <p className="text-muted" style={{ margin: "4px 0 0" }}>Gerencie seus produtos, preços e disponibilidade.</p>
              </div>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 20px", borderRadius: 12, background: "linear-gradient(135deg,#0F172A,#1E293B)", color: "#fff", fontWeight: 700, fontSize: "0.88rem" }}>
                📊 Cadastrar CMV em Massa
              </span>
            </div>
            <ConviteDoMultimarcas key={String(ativo)} ativo={ativo} slug="cozinha-central" />
            <div style={{ border: "2px dashed #D6D3D1", borderRadius: 16, padding: 40, textAlign: "center", color: "#A8A29E" }}>
              (o resto da tela de Cardápio continua igual)
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
