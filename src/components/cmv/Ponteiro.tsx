"use client";
/**
 * O PONTEIRO do CMV (e do CMO): meio círculo do verde ao vermelho, com a
 * agulha no valor. Verde até a meta, âmbar até 3 pontos acima, vermelho daí
 * para cima — a mesma régua de lib/cmv/cmv-real.ts (`zonaDoCmv`).
 *
 * Feito em SVG puro, sem biblioteca: é o mesmo desenho que vai para a tela
 * da loja depois.
 */
import React from "react";
import { PALETA } from "@/lib/paleta-brasa";

const GRAU = Math.PI / 180;

function ponto(cx: number, cy: number, r: number, angulo: number) {
  // 0° = esquerda (valor 0), 180° = direita (valor máximo).
  const a = (180 - angulo) * GRAU;
  return { x: cx + r * Math.cos(a), y: cy - r * Math.sin(a) };
}

function arco(cx: number, cy: number, r: number, de: number, ate: number) {
  const p0 = ponto(cx, cy, r, de);
  const p1 = ponto(cx, cy, r, ate);
  const grande = ate - de > 180 ? 1 : 0;
  return `M ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} A ${r} ${r} 0 ${grande} 1 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`;
}

export default function Ponteiro({
  valor, meta, faixa = 3, maximo, rotulo, tamanho = 280, semValor,
}: {
  /** Percentual (ex.: 31,2). Nulo = sem número ainda. */
  valor: number | null;
  meta: number;
  faixa?: number;
  /** Fim da escala. Padrão: o maior entre 50 e meta + 15. */
  maximo?: number;
  rotulo: string;
  tamanho?: number;
  /** Texto no lugar do número quando `valor` é nulo. */
  semValor?: string;
}) {
  const max = maximo ?? Math.max(50, Math.ceil((meta + 15) / 5) * 5);
  const w = tamanho;
  const h = tamanho * 0.62;
  const cx = w / 2;
  const cy = h - 18;
  // Folga dos lados para os números das pontas (0 e o máximo) não saírem do desenho.
  const r = w / 2 - 40;
  const espessura = Math.max(14, tamanho * 0.07);
  const ang = (v: number) => (Math.max(0, Math.min(v, max)) / max) * 180;

  const verde = ang(meta);
  const ambar = ang(meta + faixa);
  const tem = valor != null && Number.isFinite(valor);
  const agulha = tem ? ang(valor as number) : 0;
  const ponta = ponto(cx, cy, r - espessura / 2 - 6, agulha);
  const cor = !tem ? PALETA.areiaTinta : (valor as number) <= meta ? PALETA.ok : (valor as number) <= meta + faixa ? PALETA.atencao : PALETA.grave;

  const marcas: number[] = [];
  for (let v = 0; v <= max; v += max > 60 ? 20 : 10) marcas.push(v);

  return (
    <figure style={{ margin: 0, display: "flex", flexDirection: "column", alignItems: "center", width: "100%", maxWidth: w }}>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" role="img" aria-label={tem ? `${rotulo}: ${String(valor).replace(".", ",")}%, meta ${meta}%` : `${rotulo}: ${semValor || "sem número"}`}>
        <path d={arco(cx, cy, r, 0, verde)} stroke={PALETA.ok} strokeWidth={espessura} fill="none" opacity={tem ? 1 : 0.35} />
        <path d={arco(cx, cy, r, verde, ambar)} stroke={PALETA.atencao} strokeWidth={espessura} fill="none" opacity={tem ? 1 : 0.35} />
        <path d={arco(cx, cy, r, ambar, 180)} stroke={PALETA.grave} strokeWidth={espessura} fill="none" opacity={tem ? 1 : 0.35} />
        {marcas.map((m) => {
          const p0 = ponto(cx, cy, r + espessura / 2 + 2, ang(m));
          const p1 = ponto(cx, cy, r + espessura / 2 + 8, ang(m));
          const t = ponto(cx, cy, r + espessura / 2 + 16, ang(m));
          return (
            <g key={m}>
              <line x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y} stroke={PALETA.areiaTinta} strokeWidth={1.5} />
              <text x={t.x} y={t.y + 3} fontSize={10} textAnchor="middle" fill={PALETA.areiaTinta} fontWeight={700}>{m}</text>
            </g>
          );
        })}
        {/* A meta, marcada no arco. */}
        {(() => {
          const a = ponto(cx, cy, r - espessura / 2 - 2, verde);
          const b = ponto(cx, cy, r + espessura / 2 + 2, verde);
          return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={PALETA.carvao} strokeWidth={2.5} />;
        })()}
        {tem && (
          <>
            <line x1={cx} y1={cy} x2={ponta.x} y2={ponta.y} stroke={PALETA.carvao} strokeWidth={4} strokeLinecap="round" />
            <circle cx={cx} cy={cy} r={9} fill={PALETA.carvao} />
          </>
        )}
      </svg>
      <figcaption style={{ textAlign: "center", marginTop: -6 }}>
        <div style={{ fontSize: tamanho > 240 ? "2.4rem" : "1.6rem", fontWeight: 900, color: cor, fontVariantNumeric: "tabular-nums", lineHeight: 1.05 }}>
          {tem ? `${(valor as number).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` : "—"}
        </div>
        <div style={{ fontSize: "0.78rem", fontWeight: 800, color: PALETA.areiaTinta, textTransform: "uppercase", letterSpacing: "0.04em" }}>{rotulo}</div>
        <div style={{ fontSize: "0.74rem", color: PALETA.areiaTinta, marginTop: 2 }}>
          {tem ? <>meta {meta.toLocaleString("pt-BR")}%</> : semValor || "sem número ainda"}
        </div>
      </figcaption>
    </figure>
  );
}
