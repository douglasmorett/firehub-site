"use client";

import { useEffect, useState } from "react";

/**
 * A demonstração do topo da página: a fila da cozinha enchendo e esvaziando,
 * com o prazo mudando junto, nas três lojas.
 *
 * É o que explica o produto em 5 segundos para quem nunca ouviu falar dele —
 * e é honesta: usa a mesma tabela que o servidor usa (28/38/58/78 por motoboy).
 * Sem biblioteca de animação: a página precisa abrir em menos de 2 s no 4G,
 * que é o fator com maior efeito medido em conversão.
 */

const ROTEIRO = [3, 5, 8, 11, 14, 9, 6, 3];
const MOTOBOYS = 3;
const LOJAS = ["Centro", "Shopping", "Praia"];

function faixaDoPrazo(pedidos: number) {
  if (pedidos <= MOTOBOYS) return { minutos: 28, cor: "#22C55E", estouro: false };
  if (pedidos <= 2 * MOTOBOYS) return { minutos: 38, cor: "#84CC16", estouro: false };
  if (pedidos <= 3 * MOTOBOYS) return { minutos: 58, cor: "#F59E0B", estouro: false };
  if (pedidos <= 4 * MOTOBOYS) return { minutos: 78, cor: "#F97316", estouro: false };
  return { minutos: 78, cor: "#EF4444", estouro: true };
}

const NOMES = ["Ana", "Lucas", "Bia", "Caio", "Dani", "Edu", "Fê", "Gui", "Hugo", "Ivo", "Jorge", "Kau", "Lia", "Nina"];
const ITENS = ["X-burguer", "Pastel", "Esfiha", "Combo 2", "Pizza", "Açaí", "Coxinha"];

export default function DemoAoVivo() {
  const [passo, setPasso] = useState(0);
  const [aplicou, setAplicou] = useState(false);

  useEffect(() => {
    const t = setInterval(() => {
      setPasso((p) => p + 1);
      setAplicou(false);
      setTimeout(() => setAplicou(true), 1000);
    }, 3000);
    return () => clearInterval(t);
  }, []);

  const pedidos = ROTEIRO[passo % ROTEIRO.length];
  const f = faixaDoPrazo(pedidos);
  const preparo99 = Math.max(5, Math.min(30, f.minutos - 15));
  const cheio = Math.min(100, (pedidos / (4 * MOTOBOYS)) * 100);

  const cartao: React.CSSProperties = {
    background: "#fff", border: "1px solid #E2E8F0", borderRadius: 8,
    padding: "5px 7px", fontSize: ".68rem", marginBottom: 4, lineHeight: 1.25,
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.1fr .9fr", gap: 12, alignItems: "start" }} className="demo-grade">
      {/* Painel do lojista */}
      <div style={{ background: "#fff", borderRadius: 14, padding: 12, boxShadow: "0 18px 45px rgba(0,0,0,.3)", color: "#0F172A" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: ".64rem", fontWeight: 800, color: "#64748B", textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 8 }}>
          <span>Seu painel de pedidos</span><span>ao vivo</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 10, padding: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: ".7rem", fontWeight: 700, marginBottom: 6 }}>
              <span>Novos</span>
              <span style={{ background: "#0F172A", color: "#fff", borderRadius: 999, minWidth: 20, height: 20, display: "grid", placeItems: "center", fontSize: ".66rem" }}>
                {Math.max(1, Math.round(pedidos / 4))}
              </span>
            </div>
            {Array.from({ length: Math.max(1, Math.round(pedidos / 4)) }).map((_, i) => (
              <div key={i} style={cartao}>
                <b style={{ display: "block", fontSize: ".7rem" }}>#{200 + i} {NOMES[(i + 3) % NOMES.length]}</b>
                <span style={{ color: "#64748B" }}>{ITENS[(i + 2) % ITENS.length]}</span>
              </div>
            ))}
          </div>

          <div style={{ background: "#FFF7ED", border: "2px solid #FF5722", borderRadius: 10, padding: 8, boxShadow: "0 0 0 4px rgba(255,87,34,.12)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: ".7rem", fontWeight: 700, marginBottom: 6 }}>
              <span>Em preparo</span>
              <span style={{ background: "#FF5722", color: "#fff", borderRadius: 999, minWidth: 20, height: 20, display: "grid", placeItems: "center", fontSize: ".66rem" }}>
                {pedidos}
              </span>
            </div>
            <div style={{ maxHeight: 250, overflow: "hidden" }}>
              {Array.from({ length: pedidos }).map((_, i) => (
                <div key={i} style={cartao}>
                  <b style={{ display: "block", fontSize: ".7rem" }}>#{100 + i} {NOMES[i % NOMES.length]}</b>
                  <span style={{ color: "#64748B" }}>{ITENS[i % ITENS.length]}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div style={{ fontSize: ".64rem", color: "#94A3B8", marginTop: 8, textAlign: "center" }}>
          A coluna laranja é a que você marcou com um clique.
        </div>
      </div>

      {/* A extensão */}
      <div style={{ background: "linear-gradient(135deg,#0F172A,#1E293B)", border: "1px solid #334155", borderRadius: 14, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 28, height: 28, borderRadius: 9, background: "linear-gradient(135deg,#FF5722,#F44336)", display: "grid", placeItems: "center", fontSize: ".95rem" }}>🔥</div>
          <div>
            <b style={{ fontSize: ".88rem" }}>FireHub Prazos</b>
            <div style={{ color: "#FF7A59", fontSize: ".58rem", fontWeight: 800, letterSpacing: ".3px" }}>MUDANDO SOZINHO</div>
          </div>
        </div>

        <div style={{ background: "#0B1220", border: "1px solid #334155", borderRadius: 11, padding: 11 }}>
          <div style={{ fontSize: ".6rem", color: "#94A3B8", fontWeight: 800, textTransform: "uppercase", letterSpacing: ".5px" }}>Prazo no iFood</div>
          <div style={{ fontSize: "1.9rem", fontWeight: 900, color: f.cor, lineHeight: 1.1, transition: "color .4s" }}>
            {f.minutos} min{f.estouro ? <span style={{ fontSize: ".8rem" }}> · lotou</span> : null}
          </div>
          <div style={{ fontSize: ".66rem", color: "#94A3B8" }}>{pedidos} pedidos na cozinha · {MOTOBOYS} motoboys</div>
          <div style={{ height: 7, borderRadius: 999, background: "#1E293B", overflow: "hidden", marginTop: 7 }}>
            <div style={{ height: "100%", width: `${cheio}%`, background: "linear-gradient(90deg,#22C55E,#F59E0B,#EF4444)", transition: "width .6s ease" }} />
          </div>
        </div>

        <div style={{ background: "#0B1220", border: "1px solid #334155", borderRadius: 11, padding: 11 }}>
          <div style={{ fontSize: ".6rem", color: "#94A3B8", fontWeight: 800, textTransform: "uppercase", letterSpacing: ".5px" }}>Preparo no 99Food</div>
          <div style={{ fontSize: "1.3rem", fontWeight: 900, color: f.cor, transition: "color .4s" }}>{preparo99} min</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {LOJAS.map((l) => (
            <div key={l} style={{ display: "flex", alignItems: "center", gap: 7, background: "#0B1220", border: "1px solid #334155", borderRadius: 9, padding: "6px 9px", fontSize: ".72rem" }}>
              <span>🛵</span><span>{l}</span>
              <span style={{ marginLeft: "auto", fontWeight: 800, fontSize: ".7rem", color: aplicou ? "#34D399" : "#FBBF24" }}>
                {aplicou ? "✓" : "↻"} {f.minutos} min
              </span>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        @media (max-width: 760px) {
          .demo-grade { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
