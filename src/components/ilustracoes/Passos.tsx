"use client";

/**
 * O "como funciona" desenhado dos módulos: uma sequência de quadros (o
 * aparelho de verdade em miniatura + uma legenda curta) que passa sozinha.
 * Um clique num passo para a troca automática, para o dono ler com calma
 * (o mesmo combinado do desenho da Contingência).
 *
 * Os desenhos usam os aparelhos de ./aparelhos. Os rótulos dentro deles são
 * os da tela real de cada módulo — se a tela trocar um texto, troque no
 * desenho também, senão a explicação manda procurar um botão que não existe.
 * Rascunhos aprovados pelo Douglas em 14/11/2026.
 */
import { useEffect, useState, type ReactNode } from "react";

export type Passo = { legenda: string; desenho: ReactNode };

const LARANJA = "#E8360C";

export function Passos({ titulo = "Como funciona", passos, altura = 330 }: { titulo?: string; passos: Passo[]; altura?: number }) {
  const [atual, setAtual] = useState(0);
  const [tocando, setTocando] = useState(true);

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) setTocando(false);
  }, []);

  useEffect(() => {
    if (!tocando) return;
    const t = setInterval(() => setAtual((a) => (a + 1) % passos.length), 4000);
    return () => clearInterval(t);
  }, [tocando, passos.length]);

  return (
    <section style={{ background: "#EEF1F5", borderRadius: 16, padding: 16, display: "grid", gap: 12 }}>
      <style>{CSS}</style>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: "#0F172A" }}>{titulo}</h2>
        <button type="button" onClick={() => setTocando((v) => !v)} style={{ marginLeft: "auto", background: "none", border: 0, color: "#64748B", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
          {tocando ? "❚❚ Pausar" : "▶ Tocar"}
        </button>
      </div>
      {/* Os quadros dividem a mesma célula da grade: a cena fica da altura do maior, sem pular quando troca. */}
      <div className="ilu-cena" style={{ minHeight: altura }}>
        {passos.map((p, i) => (
          <div key={i} aria-hidden={i !== atual} className="ilu-quadro" style={{ opacity: i === atual ? 1 : 0, transform: i === atual ? "none" : "translateY(6px)", pointerEvents: i === atual ? "auto" : "none" }}>
            {p.desenho}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        <span style={{ flex: "none", width: 26, height: 26, borderRadius: "50%", background: LARANJA, color: "#FFF", fontWeight: 900, fontSize: 13, display: "grid", placeItems: "center" }}>{atual + 1}</span>
        <p aria-live="polite" style={{ margin: "2px 0 0", fontWeight: 700, fontSize: 15, color: "#0F172A", lineHeight: 1.4 }}>{passos[atual].legenda}</p>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        {passos.map((_, i) => (
          <button key={i} type="button" aria-label={`Passo ${i + 1}`} onClick={() => { setAtual(i); setTocando(false); }}
            style={{ width: 32, height: 6, borderRadius: 3, border: 0, padding: 0, cursor: "pointer", background: i === atual ? LARANJA : "#CBD5E1" }} />
        ))}
      </div>
    </section>
  );
}

const CSS = `
.ilu-cena{display:grid}
.ilu-quadro{grid-area:1/1;display:flex;align-items:center;justify-content:center;gap:14px;flex-wrap:wrap;transition:opacity .45s,transform .45s}
.ilu-pula{animation:ilu-pula 1s ease-in-out infinite}
.ilu-pisca{animation:ilu-pisca 1.2s ease-in-out infinite}
.ilu-scan{animation:ilu-scan 1.1s ease-in-out infinite alternate}
@keyframes ilu-pula{50%{transform:translateY(-5px)}}
@keyframes ilu-pisca{50%{opacity:.35}}
@keyframes ilu-scan{from{transform:translateY(0)}to{transform:translateY(46px)}}
@media (prefers-reduced-motion:reduce){.ilu-quadro{transition:none}.ilu-pula,.ilu-pisca,.ilu-scan{animation:none}}
`;
