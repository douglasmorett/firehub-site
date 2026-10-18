"use client";

/**
 * O Multimarcas na tela do Cardápio — é ali que o dono organiza as categorias,
 * e cada marca é um conjunto delas (lib/multimarcas). Douglas, 17/10/2026: "vai
 * oferecer isso no botão de cardápio, na aba lateral ou nos dois?" — nos dois:
 * o menu lateral é a casa do módulo; aqui, uma faixa curta.
 *
 *   • Desativado: o convite, com "Conhecer". Fechar vale para este navegador.
 *   • Ativado: o atalho para montar as marcas e o link da página — não fecha.
 */

import { useEffect, useState } from "react";
import { ArrowRight, LayoutGrid, X } from "lucide-react";

const CHAVE_FECHADO = "firehub-convite-multimarcas-fechado";

export default function ConviteDoMultimarcas({ ativo, slug }: { ativo: boolean; slug?: string | null }) {
  const [fechado, setFechado] = useState(true);
  useEffect(() => {
    if (ativo) { setFechado(false); return; }
    try { setFechado(localStorage.getItem(CHAVE_FECHADO) === "1"); } catch { setFechado(false); }
  }, [ativo]);
  if (fechado) return null;

  const fechar = () => {
    setFechado(true);
    try { localStorage.setItem(CHAVE_FECHADO, "1"); } catch {}
  };

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", padding: "14px 16px", marginBottom: "1.25rem",
      borderRadius: 16, color: "#fff", position: "relative",
      background: "radial-gradient(600px 160px at 0% 0%, rgba(232,89,12,.55), transparent 70%), #17120E",
    }}>
      <span style={{ width: 42, height: 42, borderRadius: 12, background: "rgba(255,169,77,.16)", color: "#FFA94D", display: "grid", placeItems: "center", flexShrink: 0 }}>
        <LayoutGrid size={22} />
      </span>
      <div style={{ flex: "1 1 260px", minWidth: 0 }}>
        <div style={{ fontWeight: 800, fontSize: 15, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {ativo ? "Multimarcas ativo" : "Tem várias marcas na mesma cozinha?"}
          {!ativo && <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".06em", background: "#E8590C", padding: "2px 7px", borderRadius: 6 }}>NOVO</span>}
        </div>
        <div style={{ fontSize: 13, color: "rgba(255,255,255,.75)", marginTop: 2, lineHeight: 1.45 }}>
          {ativo
            ? <>Diga quais categorias são de cada marca, suba logos e banners.{slug ? <> Sua página: <b style={{ color: "#fff" }}>firehubfood.com.br/marcas/{slug}</b></> : null}</>
            : "Mostre todas numa página só: o cliente põe no carrinho de uma, de outra, e recebe tudo numa entrega."}
        </div>
      </div>
      <a href="/store/multimarcas" style={{
        display: "inline-flex", alignItems: "center", gap: 6, padding: "10px 16px", borderRadius: 12, background: "#E8590C",
        color: "#fff", fontWeight: 800, fontSize: 14, textDecoration: "none", whiteSpace: "nowrap",
      }}>
        {ativo ? "Montar as marcas" : "Conhecer o Multimarcas"} <ArrowRight size={16} />
      </a>
      {!ativo && (
        <button onClick={fechar} aria-label="Fechar" style={{ position: "absolute", top: 6, right: 6, background: "none", border: 0, color: "rgba(255,255,255,.5)", cursor: "pointer", padding: 4, display: "grid" }}>
          <X size={16} />
        </button>
      )}
    </div>
  );
}
