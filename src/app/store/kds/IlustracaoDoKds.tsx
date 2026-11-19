"use client";

/**
 * "Como funciona" desenhado do KDS: o pedido entra na TV da cozinha → o número
 * no teclado dá pronto → Produção passa para a Finalização. Os rótulos são os
 * de kds/tela/page.tsx (o número da posição no canto do cartão, o selo iFood /
 * Online / 🍽️ Mesa, "Aperte o NÚMERO em destaque para dar PRONTO", "Pedido #… —
 * PRONTO!") e as etapas, as de ./KDSHubClient (🔥 Produção · Montar e
 * preparar, 📦 Finalização · Embalar e conferir).
 */
import type { ReactNode } from "react";
import { Passos } from "@/components/ilustracoes/Passos";
import { Painel, Selo, Seta, TV } from "@/components/ilustracoes/aparelhos";

const MONO = "ui-monospace, 'JetBrains Mono', Consolas, monospace";

function Cartao({ pos, numero, selo, children, pronto }: { pos: number; numero: number; selo: string; children: ReactNode; pronto?: boolean }) {
  return (
    <div style={{ background: pronto ? "#065F46" : "#1E293B", outline: pronto ? "2px solid #34D399" : undefined, borderRadius: 6, padding: 6, display: "flex", flexDirection: "column", gap: 2, fontSize: 9.5, textAlign: "left" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
        <span style={{ width: 18, height: 18, borderRadius: 5, background: "#FBBF24", color: "#111", font: `800 11px ${MONO}`, display: "grid", placeItems: "center" }}>{pos}</span>
        <b style={{ fontSize: 10.5 }}>#{numero}</b>
        <span style={{ fontSize: 8.5, color: "#94A3B8" }}>{selo}</span>
      </div>
      {children}
    </div>
  );
}

const grade = { display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6, alignContent: "start" } as const;
const dica = (
  <div style={{ gridColumn: "span 3", color: "#94A3B8", textAlign: "center", marginTop: 4 }}>
    Aperte o <b style={{ background: "#E8360C", color: "#FFF", borderRadius: 4, padding: "1px 5px", fontFamily: MONO }}>NÚMERO</b> em destaque para dar <b style={{ color: "#FB923C" }}>PRONTO</b>
  </div>
);

export function IlustracaoDoKds() {
  return (
    <Passos passos={[
      {
        legenda: "O pedido entra e aparece na TV da cozinha, já filtrado por categoria. Cada cartão ganha um número.",
        desenho: (
          <TV style={grade}>
            <Cartao pos={1} numero={127} selo="iFood">2x X-Bacon<br />1x Batata</Cartao>
            <Cartao pos={2} numero={128} selo="Online">1x Smash duplo<br />sem cebola</Cartao>
            <Cartao pos={3} numero={129} selo="🍽️ Mesa 4">2x X-Salada</Cartao>
            {dica}
          </TV>
        ),
      },
      {
        legenda: "O cozinheiro aperta o número no teclado. O cartão fica pronto e sai da tela.",
        desenho: (<>
          <TV style={grade}>
            <Cartao pos={1} numero={127} selo="iFood">2x X-Bacon<br />1x Batata</Cartao>
            <Cartao pos={2} numero={128} selo="Online" pronto>1x Smash duplo<br />sem cebola</Cartao>
            <Cartao pos={3} numero={129} selo="🍽️ Mesa 4">2x X-Salada</Cartao>
            <div style={{ gridColumn: "span 3", justifySelf: "center", marginTop: 4, background: "#065F46", color: "#FFF", borderRadius: 6, padding: "4px 10px", fontWeight: 800 }}>✅ Pedido #128 — PRONTO!</div>
          </TV>
          <div aria-hidden style={{ display: "grid", gridTemplateColumns: "repeat(3,26px)", gap: 4, background: "#1F2937", padding: 7, borderRadius: 8 }}>
            {[7, 8, 9, 4, 5, 6, 1, 2, 3].map((n) => (
              <span key={n} className={n === 2 ? "ilu-pula" : undefined} style={{ height: 24, borderRadius: 4, background: n === 2 ? "#FBBF24" : "#374151", color: n === 2 ? "#111" : "#E5E7EB", font: `700 11px ${MONO}`, display: "grid", placeItems: "center" }}>{n}</span>
            ))}
          </div>
        </>),
      },
      {
        legenda: "O pedido passa para a tela de finalização (embalar e conferir) e depois vai para a entrega.",
        desenho: (<>
          <Painel largura={150} style={{ textAlign: "center" }} titulo="🔥 Produção" sub="Montar e preparar" />
          <Seta />
          <Painel largura={150} style={{ textAlign: "center" }} titulo="📦 Finalização" sub="#128 · Embalar e conferir" />
          <Seta />
          <Selo cor="verde">#128 pronto para entrega</Selo>
        </>),
      },
    ]} />
  );
}
