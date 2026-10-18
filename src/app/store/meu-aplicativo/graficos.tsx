"use client";

/**
 * Os gráficos da tela Meu aplicativo — SVG próprio (o projeto não tem
 * biblioteca de gráfico), desenhado na largura real do cartão (texto nítido,
 * sem esticar), com dica ao passar o mouse ou tocar.
 *
 * Regras (skill de dataviz): um eixo só; linha de 2 px; o período anterior
 * tracejado e cinza; cor segue o canal (nunca a posição); legenda sempre que
 * há mais de uma série; grade discreta; texto em tinta de texto, nunca na cor
 * da série.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CANAIS, COR_DO_CANAL, ROTULO_DO_CANAL, diaCurto, inteiro, pct, type CanalDoApp } from "./tipos";

function useLargura<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [largura, setLargura] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setLargura(Math.round(e.contentRect.width)));
    ro.observe(el);
    setLargura(Math.round(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);
  return { ref, largura };
}

/** Um teto "redondo" para o eixo (1, 2, 2,5 ou 5 × 10ⁿ). */
function tetoBonito(max: number): number {
  if (max <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(max)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= max) return m * p;
  return 10 * p;
}

function Dica({ x, largura, children }: { x: number; largura: number; children: ReactNode }) {
  const esquerda = Math.min(Math.max(x - 90, 0), Math.max(0, largura - 180));
  return <div className="ma-dica" style={{ left: esquerda }}>{children}</div>;
}

export function Variacao({ atual, anterior, inverso = false, sufixo = "vs. período anterior" }: { atual: number; anterior: number; inverso?: boolean; sufixo?: string }) {
  if (!(anterior > 0)) return <span className="ma-var neutra">sem base anterior</span>;
  const v = atual / anterior - 1;
  const bom = inverso ? v < 0 : v > 0;
  if (Math.abs(v) < 0.005) return <span className="ma-var neutra">= igual <span className="ma-var-suf">{sufixo}</span></span>;
  return (
    <span className={`ma-var ${bom ? "sobe" : "desce"}`} title={sufixo}>
      {v > 0 ? "▲" : "▼"} {pct(Math.abs(v), Math.abs(v) < 0.1 ? 1 : 0)} <span className="ma-var-suf">{sufixo}</span>
    </span>
  );
}

/** Linha/área do período, com o período anterior tracejado por baixo. */
export function Tendencia({
  atual, anterior, dias, formato, formatoEixo, cor = "#CA8A04", altura = 220, rotuloAtual = "Este período", rotuloAnterior = "Período anterior", vazio,
}: {
  atual: number[]; anterior?: number[]; dias: string[]; formato: (n: number) => string; formatoEixo?: (n: number) => string;
  cor?: string; altura?: number; rotuloAtual?: string; rotuloAnterior?: string; vazio?: string;
}) {
  const { ref, largura } = useLargura<HTMLDivElement>();
  const [foco, setFoco] = useState<number | null>(null);
  const n = atual.length;
  const max = tetoBonito(Math.max(...atual, ...(anterior || [0]), 0));
  const esq = 54, dir = 10, topo = 10, baixo = 24;
  const w = Math.max(0, largura - esq - dir), h = altura - topo - baixo;
  const x = (i: number) => esq + (n <= 1 ? w / 2 : (i * w) / (n - 1));
  const y = (v: number) => topo + h - (v / max) * h;
  const caminho = (l: number[]) => l.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const id = useRef(`g${Math.random().toString(36).slice(2, 8)}`).current;
  const todosZero = atual.every((v) => !v) && (!anterior || anterior.every((v) => !v));
  const marcas = n <= 8 ? dias.map((_, i) => i) : [0, Math.round((n - 1) / 4), Math.round((n - 1) / 2), Math.round((3 * (n - 1)) / 4), n - 1];
  const aoMover = (cx: number) => {
    if (!w || !n) return;
    setFoco(Math.max(0, Math.min(n - 1, Math.round(((cx - esq) / w) * (n - 1)))));
  };
  return (
    <div>
      {anterior && (
        <div className="ma-legenda">
          <span><i style={{ background: cor }} />{rotuloAtual}</span>
          <span><i className="tracejado" />{rotuloAnterior}</span>
        </div>
      )}
      <div ref={ref} className="ma-grafico" style={{ height: altura }}
        onMouseMove={(e) => aoMover(e.clientX - e.currentTarget.getBoundingClientRect().left)}
        onMouseLeave={() => setFoco(null)}
        onTouchStart={(e) => aoMover(e.touches[0].clientX - e.currentTarget.getBoundingClientRect().left)}
        onTouchMove={(e) => aoMover(e.touches[0].clientX - e.currentTarget.getBoundingClientRect().left)}
      >
        {largura > 0 && (
          <svg width={largura} height={altura} role="img" aria-label={`${rotuloAtual}: ${formato(atual.reduce((s, v) => s + v, 0))}`}>
            <defs>
              <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={cor} stopOpacity={0.28} />
                <stop offset="100%" stopColor={cor} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            {[0, 0.25, 0.5, 0.75, 1].map((f) => (
              <g key={f}>
                <line x1={esq} x2={esq + w} y1={y(max * f)} y2={y(max * f)} stroke="#E2E8F0" strokeWidth={1} strokeDasharray={f ? "2 4" : undefined} />
                <text x={esq - 8} y={y(max * f) + 4} textAnchor="end" className="ma-eixo">{(formatoEixo || formato)(max * f)}</text>
              </g>
            ))}
            {marcas.map((i) => (
              <text key={i} x={x(i)} y={altura - 6} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} className="ma-eixo">{dias[i] ? diaCurto(dias[i]) : ""}</text>
            ))}
            {anterior && <path d={caminho(anterior)} fill="none" stroke="#94A3B8" strokeWidth={1.5} strokeDasharray="5 4" />}
            {n > 1 && <path d={`${caminho(atual)}L${x(n - 1)},${topo + h}L${x(0)},${topo + h}Z`} fill={`url(#${id})`} />}
            <path d={caminho(atual)} fill="none" stroke={cor} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {foco != null && (
              <g>
                <line x1={x(foco)} x2={x(foco)} y1={topo} y2={topo + h} stroke="#0F172A" strokeOpacity={0.25} />
                {anterior && <circle cx={x(foco)} cy={y(anterior[foco] || 0)} r={4} fill="#fff" stroke="#94A3B8" strokeWidth={2} />}
                <circle cx={x(foco)} cy={y(atual[foco] || 0)} r={5} fill={cor} stroke="#fff" strokeWidth={2} />
              </g>
            )}
          </svg>
        )}
        {todosZero && vazio && <div className="ma-grafico-vazio">{vazio}</div>}
        {foco != null && largura > 0 && (
          <Dica x={x(foco)} largura={largura}>
            <b>{dias[foco] ? diaCurto(dias[foco]) : ""}</b>
            <div><i style={{ background: cor }} />{rotuloAtual}: <b>{formato(atual[foco] || 0)}</b></div>
            {anterior && <div><i className="tracejado" />{rotuloAnterior}: {formato(anterior[foco] || 0)}</div>}
          </Dica>
        )}
      </div>
    </div>
  );
}

/** Barras empilhadas por canal (dia ou semana). */
export function BarrasPorCanal({ colunas, formato, altura = 230 }: { colunas: { rotulo: string; valores: Record<CanalDoApp, number> }[]; formato: (n: number) => string; altura?: number }) {
  const { ref, largura } = useLargura<HTMLDivElement>();
  const [foco, setFoco] = useState<number | null>(null);
  const presentes = CANAIS.filter((c) => colunas.some((col) => (col.valores[c] || 0) > 0));
  const totais = colunas.map((c) => presentes.reduce((s, k) => s + (c.valores[k] || 0), 0));
  const max = tetoBonito(Math.max(0, ...totais));
  const esq = 54, topo = 8, baixo = 24, h = altura - topo - baixo;
  const w = Math.max(0, largura - esq - 6);
  const passo = colunas.length ? w / colunas.length : 0;
  const larg = Math.max(2, Math.min(28, passo - (passo > 10 ? 4 : 2)));
  const y = (v: number) => (v / max) * h;
  const marcas = colunas.length <= 10 ? colunas.map((_, i) => i) : [0, Math.round(colunas.length / 2), colunas.length - 1];
  return (
    <div>
      <div className="ma-legenda">
        {presentes.map((c) => <span key={c}><i style={{ background: COR_DO_CANAL[c] }} />{ROTULO_DO_CANAL[c]}</span>)}
      </div>
      <div ref={ref} className="ma-grafico" style={{ height: altura }} onMouseLeave={() => setFoco(null)}>
        {largura > 0 && (
          <svg width={largura} height={altura} role="img" aria-label="Faturamento por canal">
            {[0, 0.5, 1].map((f) => (
              <g key={f}>
                <line x1={esq} x2={esq + w} y1={topo + h - y(max * f)} y2={topo + h - y(max * f)} stroke="#E2E8F0" strokeDasharray={f ? "2 4" : undefined} />
                <text x={esq - 8} y={topo + h - y(max * f) + 4} textAnchor="end" className="ma-eixo">{formato(max * f)}</text>
              </g>
            ))}
            {colunas.map((col, i) => {
              let base = topo + h;
              const x0 = esq + i * passo + (passo - larg) / 2;
              return (
                <g key={i} onMouseEnter={() => setFoco(i)} onClick={() => setFoco(i)} opacity={foco == null || foco === i ? 1 : 0.55}>
                  <rect x={esq + i * passo} y={topo} width={passo} height={h} fill="transparent" />
                  {presentes.map((c, k) => {
                    const alt = y(col.valores[c] || 0);
                    if (alt <= 0) return null;
                    base -= alt;
                    const ultimo = presentes.slice(k + 1).every((o) => !(col.valores[o] > 0));
                    return <rect key={c} x={x0} y={base} width={larg} height={Math.max(0, alt - (ultimo ? 0 : 1.5))} rx={ultimo ? 3 : 0} fill={COR_DO_CANAL[c]} />;
                  })}
                </g>
              );
            })}
            {marcas.map((i) => (
              <text key={i} x={esq + i * passo + passo / 2} y={altura - 6} textAnchor="middle" className="ma-eixo">{colunas[i]?.rotulo}</text>
            ))}
          </svg>
        )}
        {foco != null && colunas[foco] && largura > 0 && (
          <Dica x={esq + foco * passo + passo / 2} largura={largura}>
            <b>{colunas[foco].rotulo} · {formato(totais[foco])}</b>
            {presentes.filter((c) => colunas[foco].valores[c] > 0).map((c) => (
              <div key={c}><i style={{ background: COR_DO_CANAL[c] }} />{ROTULO_DO_CANAL[c]}: <b>{formato(colunas[foco].valores[c])}</b> <span className="ma-dica-cinza">{pct(colunas[foco].valores[c] / (totais[foco] || 1))}</span></div>
            ))}
          </Dica>
        )}
      </div>
    </div>
  );
}

/** Funil: cada etapa como barra proporcional à primeira, com a conversão da anterior. */
export function Funil({ etapas, cor = "#CA8A04" }: { etapas: { rotulo: string; valor: number; dica?: string }[]; cor?: string }) {
  const topo = Math.max(1, etapas[0]?.valor || 0);
  return (
    <div className="ma-funil">
      {etapas.map((e, i) => {
        const anterior = i ? etapas[i - 1].valor : null;
        return (
          <div key={e.rotulo} className="ma-funil-linha" title={e.dica}>
            <div className="ma-funil-rotulo">{e.rotulo}</div>
            <div className="ma-funil-trilho">
              <div className="ma-funil-barra" style={{ width: `${Math.max(e.valor > 0 ? 3 : 0, (e.valor / topo) * 100)}%`, background: cor, opacity: 1 - i * 0.16 }} />
            </div>
            <div className="ma-funil-valor">
              <b>{inteiro(e.valor)}</b>
              {anterior != null && <span>{anterior > 0 ? pct(e.valor / anterior, e.valor / anterior < 0.1 ? 1 : 0) : "—"}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Pedidos do app por dia da semana × hora (cor única, do claro ao escuro). */
export function MapaDeCalor({ calor, destaqueHora, cor = "#CA8A04" }: { calor: number[][]; destaqueHora?: number | null; cor?: string }) {
  const [foco, setFoco] = useState<{ d: number; h: number } | null>(null);
  const porHora = Array.from({ length: 24 }, (_, h) => calor.reduce((s, l) => s + (l[h] || 0), 0));
  const comPedido = porHora.map((v, h) => (v > 0 ? h : -1)).filter((h) => h >= 0);
  // Mostra o dia comercial que a loja tem (das 10h às 2h, ou o que tiver pedido).
  const horas: number[] = [];
  const ini = comPedido.length ? Math.min(...comPedido.filter((h) => h >= 5).concat([23])) : 10;
  for (let h = Math.min(ini, 10); h < 24; h++) horas.push(h);
  for (let h = 0; h < 5; h++) if (porHora[h] > 0) horas.push(h);
  const max = Math.max(1, ...calor.flat());
  const dias = [1, 2, 3, 4, 5, 6, 0];
  const nomes = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  return (
    <div className="ma-calor-quadro">
      <div className="ma-calor" style={{ gridTemplateColumns: `34px repeat(${horas.length}, minmax(10px, 1fr))` }} onMouseLeave={() => setFoco(null)}>
        <span />
        {horas.map((h) => <span key={h} className={`ma-calor-hora${h === destaqueHora ? " melhor" : ""}`}>{h % 2 === 0 || horas.length < 14 || h === destaqueHora ? `${h}h` : ""}</span>)}
        {dias.map((d) => (
          <div key={d} style={{ display: "contents" }}>
            <span className="ma-calor-dia">{nomes[d]}</span>
            {horas.map((h) => {
              const v = calor[d]?.[h] || 0;
              return (
                <span
                  key={h}
                  className={`ma-calor-celula${foco?.d === d && foco?.h === h ? " foco" : ""}`}
                  style={{ background: v ? cor : "#F1F5F9", opacity: v ? 0.18 + 0.82 * (v / max) : 1 }}
                  onMouseEnter={() => setFoco({ d, h })}
                  onClick={() => setFoco({ d, h })}
                  title={`${nomes[d]} ${h}h: ${v} pedido(s)`}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="ma-calor-rodape">
        {foco ? <span><b>{nomes[foco.d]}, {foco.h}h:</b> {inteiro(calor[foco.d]?.[foco.h] || 0)} pedidos pelo app</span> : <span>Passe o mouse ou toque num quadrinho.</span>}
        <span className="ma-calor-escala">menos <i style={{ background: cor, opacity: 0.2 }} /><i style={{ background: cor, opacity: 0.55 }} /><i style={{ background: cor }} /> mais</span>
      </div>
    </div>
  );
}

/** Mini-linha sem eixo, para dentro de um cartão. */
export function Sparkline({ valores, cor = "#CA8A04", altura = 34 }: { valores: number[]; cor?: string; altura?: number }) {
  const { ref, largura } = useLargura<HTMLDivElement>();
  const max = Math.max(1, ...valores);
  const n = valores.length;
  const pts = valores.map((v, i) => `${n <= 1 ? largura / 2 : (i * largura) / (n - 1)},${altura - 3 - (v / max) * (altura - 6)}`).join(" ");
  return (
    <div ref={ref} style={{ height: altura }}>
      {largura > 0 && n > 1 && (
        <svg width={largura} height={altura} aria-hidden>
          <polyline points={pts} fill="none" stroke={cor} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      )}
    </div>
  );
}
