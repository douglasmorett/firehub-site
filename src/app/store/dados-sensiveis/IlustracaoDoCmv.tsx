"use client";

/**
 * "Como funciona" desenhado do CMV real: duas contagens + compras → CMV →
 * ÷ vendas = % no ponteiro → onde está o dinheiro. A conta é a de
 * lib/cmv/cmv-real.ts (estoque da contagem de abertura + compras − estoque da
 * contagem de fechamento; ÷ vendas sem a taxa de entrega). Os rótulos são os
 * de ./DadosSensiveisClient.tsx (A conta do CMV, Estoque na contagem de…,
 * Compras de… a…, CMV real, Onde está o dinheiro: Insumo / Saiu / R$) e o
 * ponteiro é o de verdade (components/cmv/Ponteiro). Todos os números são de
 * exemplo e fecham: 12.000 + 8.000 − 9.500 = 10.500; 10.500 ÷ 32.000 = 32,8%.
 */
import type { CSSProperties, ReactNode } from "react";
import { Passos } from "@/components/ilustracoes/Passos";
import { Painel } from "@/components/ilustracoes/aparelhos";
import Ponteiro from "@/components/cmv/Ponteiro";

const MONO = "ui-monospace, 'JetBrains Mono', Consolas, monospace";
const sub: CSSProperties = { color: "#64748B", fontSize: 10 };

function Caixa({ rotulo, valor, resultado }: { rotulo: ReactNode; valor: string; resultado?: boolean }) {
  return (
    <div style={{ background: resultado ? "#0F172A" : "#FFF", color: resultado ? "#FFF" : "#111", borderRadius: 10, padding: "8px 10px", textAlign: "center", fontSize: 10, fontWeight: 600, boxShadow: "0 8px 18px rgba(15,23,42,.14)", maxWidth: 120 }}>
      {rotulo}<b style={{ display: "block", font: `800 15px ${MONO}` }}>{valor}</b>
    </div>
  );
}
const Op = ({ children }: { children: string }) => <span aria-hidden style={{ fontWeight: 800, fontSize: 20, color: "#0F172A" }}>{children}</span>;

// O que mais saiu do estoque entre as duas contagens: soma os R$ 10.500 do CMV.
const CONSUMO: [string, string, string][] = [
  ["Carne bovina", "160 kg", "R$ 4.800,00"],
  ["Queijo mussarela", "90 kg", "R$ 2.970,00"],
  ["Pão brioche", "1.400 un", "R$ 1.540,00"],
  ["Batata congelada", "120 kg", "R$ 1.190,00"],
];
const cel: CSSProperties = { padding: "4px 5px", borderBottom: "1px solid #E5E7EB", textAlign: "left" };

export function IlustracaoDoCmv() {
  return (
    <Passos titulo="Como o CMV é calculado (exemplo)" passos={[
      {
        legenda: "O CMV sai de duas contagens de estoque e das compras lançadas entre elas.",
        desenho: (
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: 8, maxWidth: 560 }}>
            <Caixa rotulo="Estoque na contagem de 01/11" valor="R$ 12.000" />
            <Op>+</Op>
            <Caixa rotulo="Compras de 02/11 a 08/11" valor="R$ 8.000" />
            <Op>−</Op>
            <Caixa rotulo="Estoque na contagem de 08/11" valor="R$ 9.500" />
            <Op>=</Op>
            <Caixa rotulo="CMV real" valor="R$ 10.500" resultado />
          </div>
        ),
      },
      {
        legenda: "Dividido pelas vendas do período (sem a taxa de entrega), vira a porcentagem. O ponteiro compara com a sua meta: verde até a meta, amarelo até 3 pontos acima, vermelho daí para cima.",
        desenho: (
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <Caixa rotulo="CMV real" valor="R$ 10.500" resultado />
            <Op>÷</Op>
            <Caixa rotulo="Vendas no período" valor="R$ 32.000" />
            <Op>=</Op>
            <Painel largura={210} style={{ justifyItems: "center" }}>
              <Ponteiro valor={32.8} meta={30} faixa={3} rotulo="CMV real" tamanho={190} />
              <span style={sub}>exemplo: meta de 30%</span>
            </Painel>
          </div>
        ),
      },
      {
        legenda: "Em \"Onde está o dinheiro\", a tela mostra o que mais saiu do estoque entre as duas contagens.",
        desenho: (
          <Painel titulo="Onde está o dinheiro" largura={360}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10.5 }}>
              <thead><tr style={{ color: "#64748B", fontSize: 9.5 }}><th style={cel}>Insumo</th><th style={cel}>Saiu</th><th style={{ ...cel, textAlign: "right" }}>R$</th></tr></thead>
              <tbody>{CONSUMO.map(([n, q, v]) => <tr key={n}><td style={cel}>{n}</td><td style={cel}>{q}</td><td style={{ ...cel, textAlign: "right", fontWeight: 800 }}>{v}</td></tr>)}</tbody>
            </table>
            <span style={sub}>Números de exemplo.</span>
          </Painel>
        ),
      },
    ]} />
  );
}
