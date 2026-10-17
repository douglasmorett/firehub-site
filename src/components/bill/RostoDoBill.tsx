"use client";

/**
 * O ROSTO DO BILL — o personagem do FireHub, em vetor, com olhos de LED que
 * expressam emoção e acompanham o mouse.
 *
 * Douglas, 17/10/2026: "quero que a gente construa um personagem para ser o
 * Bill, não algo genérico: olhos de LED onde ele expressa emoções; na caixinha
 * os olhinhos acompanham o ponteiro do mouse". Escolheu o corpo "A · Visor"
 * (cabeça branca arredondada, visor largo, fones azuis, antena) entre três
 * modelos. Substitui o PNG antigo (public/bill/bill.png) em todo lugar.
 *
 * Este é o build do FireHub. O build do cliente dele vem depois, com o mesmo
 * motor de olhos e outro casco.
 *
 * Como funciona: o SVG é desenhado uma vez pelo React e, dali em diante, só o
 * DOM muda (style.x/width/d/transform nos LEDs, pálpebras e boca), com
 * transição em CSS — o React não re-renderiza a cada movimento do mouse.
 * - `emocao`: normal, feliz, ouvindo (verde), pensando (amarelo), falando,
 *   surpreso, piscada, erro (vermelho), dormindo.
 * - `seguirMouse`: o LED desliza dentro do soquete e a cabeça inclina junto.
 * - Pisca sozinho a cada 2,6–5,8 s (não em dormindo/piscada).
 * - Respeita prefers-reduced-motion (sem pulso/boca mexendo; emoções ainda trocam).
 */

import { useEffect, useId, useRef } from "react";

export type EmocaoDoBill = "normal" | "feliz" | "ouvindo" | "pensando" | "falando" | "surpreso" | "piscada" | "erro" | "dormindo";

const VISOR = "#0B1220";
const COR = { ciano: "#22D3EE", verde: "#4ADE80", amarelo: "#FACC15", vermelho: "#FB7185" };
const OLHOS: [number, number][] = [[78, 100], [122, 100]];
const BOCA_EM: [number, number] = [100, 118];
const OLHO_TAM = 26;

// A boca é um caminho fechado "M esq Q topo dir Q fundo esq Z": sempre a mesma
// estrutura, para o navegador animar de uma forma para a outra (barra → sorriso → "o").
const BOCA = {
  barra: "M -8 0 Q 0 -1 8 0 Q 0 2 -8 0 Z",
  sorriso: "M -13 -2 Q 0 1 13 -2 Q 0 14 -13 -2 Z",
  sorrisinho: "M -11 0 Q 0 1 11 0 Q 0 8 -11 0 Z",
  o: "M -5 0 Q 0 -8 5 0 Q 0 8 -5 0 Z",
  triste: "M -8 2 Q 0 -6 8 2 Q 0 -2 -8 2 Z",
  hmm: "M -4 0 Q 0 -1 4 0 Q 0 1 -4 0 Z",
  mini: "M -5 0 Q 0 0 5 0 Q 0 1 -5 0 Z",
};

type Def = {
  w: number; h: number; cor: string; cima: number; baixo: number; boca: string; bocaX?: number; bochecha: number;
  sobrancelha?: { esq: number; dir: number }; piscaDir?: boolean; inclinar?: boolean;
};
const EMOCOES: Record<EmocaoDoBill, Def> = {
  normal: { w: 1, h: 1, cor: COR.ciano, cima: -74, baixo: 48, boca: BOCA.barra, bochecha: 0 },
  feliz: { w: 1, h: 1.3, cor: COR.ciano, cima: -74, baixo: 14, boca: BOCA.sorriso, bochecha: 0.9 },
  ouvindo: { w: 1.15, h: 1.15, cor: COR.verde, cima: -74, baixo: 48, boca: BOCA.sorrisinho, bochecha: 0 },
  pensando: { w: 1, h: 0.55, cor: COR.amarelo, cima: -74, baixo: 48, boca: BOCA.hmm, bocaX: 5, bochecha: 0, sobrancelha: { esq: -8, dir: 0 } },
  falando: { w: 1, h: 1, cor: COR.ciano, cima: -74, baixo: 48, boca: BOCA.barra, bochecha: 0 },
  surpreso: { w: 1.25, h: 1.35, cor: COR.ciano, cima: -74, baixo: 48, boca: BOCA.o, bochecha: 0, sobrancelha: { esq: -10, dir: -10 } },
  piscada: { w: 1.05, h: 1.05, cor: COR.ciano, cima: -74, baixo: 48, boca: BOCA.sorrisinho, bocaX: 3, bochecha: 0.5, piscaDir: true },
  erro: { w: 1, h: 0.8, cor: COR.vermelho, cima: -74, baixo: 48, boca: BOCA.triste, bochecha: 0, sobrancelha: { esq: 0, dir: 0 }, inclinar: true },
  dormindo: { w: 1, h: 1, cor: COR.ciano, cima: -30, baixo: 48, boca: BOCA.mini, bochecha: 0 },
};

const CSS_ID = "rosto-do-bill-css";
const CSS = `
.rdb .cabeca { transition: transform .35s cubic-bezier(.2,.8,.2,1); transform-box: fill-box; transform-origin: 50% 70%; }
.rdb .led { transition: transform .09s linear; }
.rdb .brilho, .rdb .nucleo { transition: x .25s, y .25s, width .25s, height .25s, rx .25s, fill .3s, transform .25s; transform-box: fill-box; transform-origin: center; }
.rdb .palpebra-cima { transition: y .14s ease-in; }
.rdb .palpebra-baixo { transition: cy .25s cubic-bezier(.2,.8,.2,1); }
.rdb .boca { transition: d .28s cubic-bezier(.2,.8,.2,1), fill .3s, stroke .3s, opacity .25s, transform .25s; }
.rdb .bochecha { transition: opacity .3s; }
.rdb .sobrancelha { transition: transform .25s, opacity .25s; transform-box: fill-box; transform-origin: center; }
.rdb.falando .boca { animation: rdb-boca .34s ease-in-out infinite alternate; }
@keyframes rdb-boca { from { d: path("M -8 0 Q 0 -1 8 0 Q 0 2 -8 0 Z"); } to { d: path("M -9 0 Q 0 -7 9 0 Q 0 8 -9 0 Z"); } }
.rdb.ouvindo .brilho { animation: rdb-pulso 1s ease-in-out infinite; }
@keyframes rdb-pulso { 50% { filter: brightness(1.35); } }
.rdb.pensando .led { animation: rdb-olhar-cima 1.8s ease-in-out infinite; }
@keyframes rdb-olhar-cima { 0%,100% { transform: translate(5px,-6px); } 50% { transform: translate(7px,-4px); } }
.rdb .zz { font: 900 16px system-ui, sans-serif; fill: #67E8F9; opacity: 0; }
.rdb.dormindo .zz { animation: rdb-zz 2.2s ease-in-out infinite; }
.rdb.dormindo .zz + .zz { animation-delay: .7s; }
@keyframes rdb-zz { 0% { opacity: 0; transform: translate(0,0); } 30% { opacity: 1; } 100% { opacity: 0; transform: translate(10px,-22px); } }
@media (prefers-reduced-motion: reduce) { .rdb.falando .boca, .rdb.ouvindo .brilho, .rdb.pensando .led, .rdb.dormindo .zz { animation: none; } }
`;

function garantirCss() {
  if (typeof document === "undefined" || document.getElementById(CSS_ID)) return;
  const s = document.createElement("style");
  s.id = CSS_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

function aplicarEmocao(svg: SVGSVGElement, nome: EmocaoDoBill) {
  const e = EMOCOES[nome] || EMOCOES.normal;
  svg.classList.remove(...(Object.keys(EMOCOES) as string[]));
  svg.classList.add(nome);
  svg.querySelectorAll<SVGGElement>(".olho").forEach((o, i) => {
    const dir = i === 1;
    const w = OLHO_TAM * e.w, h = OLHO_TAM * e.h;
    const br = o.querySelector<SVGRectElement>(".brilho")!, nu = o.querySelector<SVGRectElement>(".nucleo")!;
    const forma = (el: SVGRectElement, w: number, h: number, rx: number) => {
      el.style.x = `${-w / 2}px`; el.style.y = `${-h / 2}px`; el.style.width = `${w}px`; el.style.height = `${h}px`; el.style.rx = `${rx}px`;
    };
    forma(br, w, h, Math.min(w, h) * 0.36);
    forma(nu, w * 0.5, h * 0.5, Math.min(w, h) * 0.18);
    br.style.fill = e.cor;
    br.style.transform = e.inclinar ? `rotate(${dir ? -12 : 12}deg)` : "";
    o.querySelector<SVGRectElement>(".palpebra-cima")!.style.y = `${e.piscaDir && dir ? -24 : e.cima}px`;
    o.querySelector<SVGEllipseElement>(".palpebra-baixo")!.style.cy = `${e.baixo}px`;
    const sb = o.querySelector<SVGRectElement>(".sobrancelha")!;
    if (e.sobrancelha) {
      const giro = e.inclinar ? (dir ? 18 : -18) : nome === "pensando" && !dir ? -12 : 0;
      sb.style.opacity = "0.9";
      sb.style.transform = `translateY(${e.sobrancelha[dir ? "dir" : "esq"]}px) rotate(${giro}deg)`;
    } else {
      sb.style.opacity = "0";
      sb.style.transform = "";
    }
  });
  const boca = svg.querySelector<SVGPathElement>(".boca")!;
  boca.style.d = `path("${e.boca}")`;
  boca.style.fill = e.cor;
  boca.style.stroke = e.cor;
  boca.style.transform = e.bocaX ? `translateX(${e.bocaX}px)` : "";
  boca.style.opacity = nome === "dormindo" ? "0.5" : "1";
  svg.querySelectorAll<SVGCircleElement>(".bochecha").forEach((b) => { b.style.opacity = String(e.bochecha); });
}

type Props = {
  emocao?: EmocaoDoBill;
  /** Lado em px (o SVG é quadrado). */
  tamanho?: number;
  /** Os olhos acompanham o ponteiro (e a cabeça inclina junto a partir de 20 px). */
  seguirMouse?: boolean;
  /** Dormindo e piscada não piscam; aqui dá para desligar nos tamanhos minúsculos. */
  piscar?: boolean;
  style?: React.CSSProperties;
  className?: string;
};

export default function RostoDoBill({ emocao = "normal", tamanho = 60, seguirMouse = false, piscar = true, style, className }: Props) {
  const ref = useRef<SVGSVGElement | null>(null);
  const emocaoAtual = useRef<EmocaoDoBill>(emocao);
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");

  useEffect(() => { garantirCss(); }, []);

  useEffect(() => {
    emocaoAtual.current = emocao;
    if (ref.current) aplicarEmocao(ref.current, emocao);
  }, [emocao]);

  // Piscada sozinha.
  useEffect(() => {
    if (!piscar) return;
    let t: ReturnType<typeof setTimeout>;
    const agendar = () => {
      t = setTimeout(() => {
        const svg = ref.current;
        const e = emocaoAtual.current;
        if (svg && e !== "dormindo" && e !== "piscada") {
          svg.querySelectorAll<SVGRectElement>(".palpebra-cima").forEach((p) => { p.style.y = "-24px"; });
          setTimeout(() => { if (ref.current) aplicarEmocao(ref.current, emocaoAtual.current); }, 130);
        }
        agendar();
      }, 2600 + Math.random() * 3200);
    };
    agendar();
    return () => clearTimeout(t);
  }, [piscar]);

  // Olhar para o ponteiro: o LED desliza dentro do soquete; a cabeça inclina junto.
  useEffect(() => {
    if (!seguirMouse) return;
    let quadro = 0;
    let ultimo: [number, number] | null = null;
    const olhar = () => {
      quadro = 0;
      const svg = ref.current;
      if (!svg || !ultimo) return;
      const r = svg.getBoundingClientRect();
      const dx = ultimo[0] - (r.left + r.width / 2), dy = ultimo[1] - (r.top + r.height / 2);
      const dist = Math.hypot(dx, dy) || 1;
      const f = Math.min(1, dist / 260);
      const ox = (dx / dist) * 7 * f, oy = (dy / dist) * 7 * f;
      const e = emocaoAtual.current;
      if (e !== "pensando" && e !== "dormindo") {
        svg.querySelectorAll<SVGGElement>(".led").forEach((l) => { l.style.transform = `translate(${ox}px, ${oy}px)`; });
      }
      if (tamanho >= 20) {
        svg.querySelector<SVGGElement>(".cabeca")!.style.transform = `rotate(${(dx / dist) * 4 * f}deg) translate(${ox * 0.5}px, ${oy * 0.4}px)`;
      }
    };
    const mover = (ev: PointerEvent) => {
      ultimo = [ev.clientX, ev.clientY];
      if (!quadro) quadro = requestAnimationFrame(olhar);
    };
    const descansar = () => {
      ultimo = null;
      const svg = ref.current;
      if (!svg) return;
      svg.querySelectorAll<SVGGElement>(".led").forEach((l) => { l.style.transform = ""; });
      svg.querySelector<SVGGElement>(".cabeca")!.style.transform = "";
    };
    window.addEventListener("pointermove", mover, { passive: true });
    document.documentElement.addEventListener("pointerleave", descansar);
    return () => {
      window.removeEventListener("pointermove", mover);
      document.documentElement.removeEventListener("pointerleave", descansar);
      if (quadro) cancelAnimationFrame(quadro);
    };
  }, [seguirMouse, tamanho]);

  const h = OLHO_TAM / 2;
  const olho = (cx: number, cy: number, lado: string) => {
    const clip = `rdb-clip-${id}-${lado}`;
    return (
      <g className={`olho ${lado}`} transform={`translate(${cx} ${cy})`}>
        <clipPath id={clip}><rect x="-24" y="-24" width="48" height="48" rx="16" /></clipPath>
        <g clipPath={`url(#${clip})`}>
          <g className="led">
            <rect className="brilho" x={-h} y={-h} width={OLHO_TAM} height={OLHO_TAM} rx={OLHO_TAM * 0.36} fill={COR.ciano} filter={`url(#rdb-glow-${id})`} />
            <rect className="nucleo" x={-h * 0.5} y={-h * 0.5} width={OLHO_TAM * 0.5} height={OLHO_TAM * 0.5} rx={OLHO_TAM * 0.18} fill="white" opacity="0.8" />
          </g>
          <rect className="palpebra-cima" x="-26" y="-74" width="52" height="50" fill={VISOR} />
          <ellipse className="palpebra-baixo" cx="0" cy="48" rx="22" ry="18" fill={VISOR} />
        </g>
        <rect className="sobrancelha" x="-14" y="-24" width="28" height="4" rx="2" fill={COR.ciano} opacity="0" filter={`url(#rdb-glow-${id})`} />
      </g>
    );
  };
  const [[ex1, ey1], [ex2, ey2]] = OLHOS;

  return (
    <svg
      ref={(el) => { ref.current = el; if (el) aplicarEmocao(el, emocaoAtual.current); }}
      className={`rdb ${className || ""}`}
      viewBox="0 0 200 200"
      width={tamanho}
      height={tamanho}
      style={{ display: "block", overflow: "visible", ...style }}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <filter id={`rdb-glow-${id}`} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="2.2" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <linearGradient id={`rdb-casco-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFFFFF" /><stop offset="1" stopColor="#CBD5E1" />
        </linearGradient>
      </defs>
      <g className="cabeca">
        <line x1="100" y1="50" x2="100" y2="34" stroke="#94A3B8" strokeWidth="4" strokeLinecap="round" />
        <circle cx="100" cy="30" r="6" fill={COR.ciano} filter={`url(#rdb-glow-${id})`} />
        <rect x="26" y="88" width="16" height="40" rx="8" fill="#0EA5E9" /><rect x="158" y="88" width="16" height="40" rx="8" fill="#0EA5E9" />
        <rect x="40" y="48" width="120" height="112" rx="44" fill={`url(#rdb-casco-${id})`} stroke="#94A3B8" strokeWidth="1.5" />
        <rect x="52" y="66" width="96" height="66" rx="30" fill={VISOR} />
        <rect x="58" y="70" width="84" height="22" rx="11" fill="white" opacity="0.06" />
        {olho(ex1, ey1, "esq")}
        {olho(ex2, ey2, "dir")}
        <circle className="bochecha" cx={ex1 - 4} cy={ey1 + 20} r="5" fill="#F472B6" opacity="0" filter={`url(#rdb-glow-${id})`} />
        <circle className="bochecha" cx={ex2 + 4} cy={ey2 + 20} r="5" fill="#F472B6" opacity="0" filter={`url(#rdb-glow-${id})`} />
        {/* O <g> posiciona; o transform CSS da boca (bocaX) fica relativo a ele. */}
        <g transform={`translate(${BOCA_EM[0]} ${BOCA_EM[1]})`}>
          <path className="boca" d={BOCA.barra} fill={COR.ciano} stroke={COR.ciano} strokeWidth="2.5" strokeLinejoin="round" filter={`url(#rdb-glow-${id})`} />
        </g>
        <text className="zz" x={ex2 + 22} y={ey2 - 20}>z</text><text className="zz" x={ex2 + 30} y={ey2 - 30}>z</text>
      </g>
    </svg>
  );
}
