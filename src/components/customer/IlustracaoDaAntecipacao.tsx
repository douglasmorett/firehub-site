"use client";

/**
 * "Como funciona" desenhado da Antecipação de produção: média dos dois últimos
 * dias iguais da semana → lista do que deixar pronto → impressa para a
 * cozinha. A regra é a de lib/antecipacao.ts e api/store/antecipacao (feriado
 * e dia sem venda são pulados e ele volta mais uma semana; modo feriado
 * multiplica por FATOR_DO_FERIADO). Os rótulos são os de ./AntecipacaoClient.tsx
 * (Insumos para deixar pronto, Deixar pronto, Média, Dia inteiro, De … até,
 * Modo feriado, Imprimir). Itens e quantidades são de exemplo.
 */
import type { CSSProperties } from "react";
import { Passos } from "@/components/ilustracoes/Passos";
import { Barras, Painel, Papel, Traco } from "@/components/ilustracoes/aparelhos";

const cel: CSSProperties = { padding: "4px 5px", borderBottom: "1px solid #E5E7EB", textAlign: "left" };
const num: CSSProperties = { ...cel, textAlign: "right", whiteSpace: "nowrap" };
const th: CSSProperties = { ...cel, color: "#64748B", fontWeight: 700, fontSize: 8.5, textTransform: "uppercase" };
const chip = (ativo: boolean): CSSProperties => ({ borderRadius: 6, padding: "2px 7px", fontWeight: 700, fontSize: 9.5, background: ativo ? "#0F172A" : "#F1F5F9", color: ativo ? "#FFF" : "#475569" });

// [insumo, deixar pronto, média, sáb 31/10, sáb 07/11]
const INSUMOS: [string, string, string, string, string][] = [
  ["Hambúrguer porcionado", "42 un", "42", "40", "44"],
  ["Pão brioche", "42 un", "42", "40", "44"],
  ["Batata cortada", "3 kg", "3", "2,8", "3,2"],
  ["Cebola caramelizada", "2,1 kg", "2,1", "1,9", "2,3"],
];

export function IlustracaoDaAntecipacao({ pctDoFeriado = 20 }: { pctDoFeriado?: number }) {
  return (
    <Passos passos={[
      {
        legenda: "O sistema olha os dois últimos sábados (o mesmo dia da semana) e tira a média. Feriado e dia sem venda ficam de fora, e o que veio dentro de combo já está somado.",
        desenho: (
          <Painel titulo="X-Bacon vendidos" largura={340}>
            <Barras linhas={[
              { rotulo: "Sáb 31/10", pct: 80, valor: "40" },
              { rotulo: "Sáb 07/11", pct: 88, valor: "44" },
              { rotulo: "Média", pct: 84, valor: "42", cor: "#0F172A" },
            ]} />
          </Painel>
        ),
      },
      {
        legenda: `Vira a lista do que deixar pronto, do dia inteiro ou de um horário. Em feriado, o modo feriado soma ${pctDoFeriado}%.`,
        desenho: (
          <Painel titulo="Insumos para deixar pronto · Sáb 14/11" largura={380}>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
              <span style={chip(true)}>Dia inteiro</span><span style={chip(false)}>De … até</span>
              <span style={{ marginLeft: "auto", color: "#64748B", fontSize: 9.5 }}>🎉 Modo feriado (+{pctDoFeriado}%)</span>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
              <thead><tr><th style={th}>Insumo</th><th style={{ ...th, textAlign: "right" }}>Deixar pronto</th><th style={{ ...th, textAlign: "right" }}>Média</th><th style={{ ...th, textAlign: "right" }}>Sáb 31/10</th><th style={{ ...th, textAlign: "right" }}>Sáb 07/11</th></tr></thead>
              <tbody>
                {INSUMOS.map(([n, d, m, a, b]) => (
                  <tr key={n}><td style={cel}>{n}</td><td style={{ ...num, fontWeight: 900, color: "#E8360C" }}>{d}</td><td style={num}>{m}</td><td style={num}>{a}</td><td style={num}>{b}</td></tr>
                ))}
              </tbody>
            </table>
          </Painel>
        ),
      },
      {
        legenda: "Toque em Imprimir e a cozinha prepara antes de o pedido chegar.",
        desenho: (
          <Papel largura={180}>
            <b>ANTECIPAÇÃO DE PRODUÇÃO</b><br />Sáb 14/11 · dia inteiro<Traco />
            42 un  Hambúrguer porcionado<br />42 un  Pão brioche<br />3 kg   Batata cortada<br />2,1 kg Cebola caramelizada<Traco />
            Média dos 2 últimos sábados
          </Papel>
        ),
      },
    ]} />
  );
}
