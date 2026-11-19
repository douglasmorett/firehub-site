"use client";

/**
 * "Como funciona no salão" da Balança automática, desenhado (SVG próprio):
 * o prato desce na balança → o visor sobe até o peso → o peso vai pelo cabo
 * para o computador → firmou, a tela faz peso × preço do quilo → o cliente
 * encosta o cartão no leitor de mesa → o valor voa para a comanda 17 → no
 * caixa a conta fecha e a NFC-e sai com o prato em KG.
 *
 * Só o que o sistema faz de verdade (balanca/pesar/TelaDaBalanca.tsx,
 * lib/balanca/protocolo-toledo.ts, api/store/balanca/pesar, lib/fiscal-itens.ts):
 * o peso vem da balança pela serial (protocolo Toledo); só vale quando repete
 * o mesmo valor; o valor é peso × preço do quilo; o leitor "digita" o número
 * do cartão; a comanda abre sozinha; a tela só volta ao começo quando o prato
 * sai. Os rótulos da tela do computador são os da tela de pesar ("Aguarde o
 * peso firmar…", "Passe o cartão da comanda", "✅ R$ … na comanda …",
 * "Total da comanda: … Retire o prato.", "Não verificado — …").
 * Exemplo: 0,452 kg × R$ 51,90 = R$ 23,46; com o suco, R$ 31,46.
 *
 * Passa sozinho; um clique numa etapa para a troca. Com "reduzir movimento"
 * no aparelho, nada anda: as etapas ficam paradas, no estado final de cada uma.
 */
import { useEffect, useState } from "react";

const TEAL = "#0F766E";
const TEAL_VIVO = "#14B8A6";
const TEAL_CLARO = "#5EEAD4";
const ESCURO = "#0F172A";
const MONO = "ui-monospace, 'JetBrains Mono', Consolas, monospace";
const DURACAO_MS = 5500;
const PESO = 0.452;

const kgTexto = (kg: number) => kg.toFixed(3).replace(".", ",");

const PASSOS = [
  {
    rotulo: "1. Pesa",
    titulo: "O cliente põe o prato na balança",
    texto: "Pegou o cartão numerado na entrada, serviu e pôs o prato na balança. O peso vai pelo cabo da balança direto para o FireHub: ninguém digita nada.",
  },
  {
    rotulo: "2. Calcula",
    titulo: "O peso firmou, o sistema faz a conta",
    texto: "Quando a balança repete o mesmo peso, a tela multiplica pelo preço do quilo do seu cardápio e mostra o valor. Prato ainda balançando não vira conta.",
  },
  {
    rotulo: "3. Lança na comanda",
    titulo: "Encostou o cartão, o prato caiu na comanda",
    texto: "O leitor de mesa lê o cartão sozinho e o valor entra na comanda 17. A comanda abre na primeira pesagem e o prato não vai para a cozinha.",
  },
  {
    rotulo: "4. Fecha no caixa",
    titulo: "No caixa, é só fechar a conta",
    texto: "O cliente tira o prato e a balança fica livre para o próximo (o mesmo prato não entra duas vezes). No caixa, passe o cartão em Mesas › Comandas e feche: a NFC-e sai com o prato em quilo (KG).",
  },
];

type Ponto = [number, number];
type Arranjo = {
  vb: [number, number];
  balanca: Ponto; pc: Ponto; leitor: Ponto; comanda: Ponto; conta: Ponto;
  cabo: string; usb: string;
  bancadas: [number, number, number][]; // x, y, largura
};

/** Computador: o desenho largo, tudo numa bancada. */
const LARGO: Arranjo = {
  vb: [780, 300],
  balanca: [16, 130], pc: [250, 136], leitor: [470, 168], comanda: [604, 34], conta: [355, 112],
  cabo: "M208 257 C 226 262, 238 268, 256 266",
  usb: "M474 268 C 468 270, 464 270, 456 268",
  bancadas: [[0, 272, 590]],
};

/** Celular: balança e computador em cima, leitor e comanda embaixo. */
const ALTO: Arranjo = {
  vb: [420, 478],
  balanca: [8, 75], pc: [204, 81], leitor: [20, 285], comanda: [200, 257], conta: [210, 48],
  cabo: "M200 202 C 204 209, 206 213, 210 213",
  usb: "",
  bancadas: [[0, 217, 420], [0, 389, 180]],
};

const ESTILO = `
.bz{border:1.5px solid #CCFBF1;border-radius:16px;background:#fff;overflow:hidden}
.bz-topo{display:flex;align-items:center;gap:10px;padding:14px 16px 0;flex-wrap:wrap}
.bz-topo h2{margin:0;font-size:18px;font-weight:900;color:${ESCURO}}
.bz-tocar{margin-left:auto;background:none;border:0;color:#64748B;font:inherit;font-weight:700;font-size:13px;cursor:pointer}
.bz-abas{display:flex;gap:6px;padding:10px 12px 0;flex-wrap:wrap}
.bz-aba{flex:1 1 130px;border:1.5px solid #E2E8F0;background:#F8FAFC;color:#475569;border-radius:10px;padding:8px 10px;font:inherit;font-size:13px;font-weight:800;cursor:pointer;position:relative;overflow:hidden}
.bz-aba.ativa{border-color:${TEAL_VIVO};background:#F0FDFA;color:${TEAL}}
.bz-tempo{position:absolute;left:0;bottom:0;height:3px;background:${TEAL_VIVO};width:0}
.bz-aba.ativa .bz-tempo.corre{animation:bz-tempo ${DURACAO_MS}ms linear forwards}
@keyframes bz-tempo{to{width:100%}}
.bz-palco{margin:6px 8px 0;background:radial-gradient(520px 220px at 50% 60%,#F0FDFA,transparent 72%)}
.bz-palco svg{display:block;width:100%;height:auto}
.bz-alto{display:none!important}
@media (max-width:600px){.bz-largo{display:none!important}.bz-alto{display:block!important}}
.bz-texto{padding:6px 18px 16px}
.bz-texto b{display:block;font-size:16px;color:${ESCURO};margin-bottom:3px}
.bz-texto p{margin:0;font-size:14px;color:#475569;line-height:1.55}
.bz-texto small{display:block;margin-top:8px;font-size:12px;color:#94A3B8}
.bz svg *{transform-box:fill-box}
.bz-prato-desce{animation:bz-desce .75s cubic-bezier(.3,1.35,.5,1) both}
@keyframes bz-desce{from{transform:translateY(-90px);opacity:0}35%{opacity:1}}
.bz-prato-sai{opacity:0;animation:bz-sai .7s ease-in both}
@keyframes bz-sai{from{transform:none;opacity:1}to{transform:translateY(-70px);opacity:0}}
.bz-fluxo{stroke-dasharray:5 7;animation:bz-fluxo .8s linear infinite}
@keyframes bz-fluxo{to{stroke-dashoffset:-24}}
.bz-pisca{animation:bz-pisca 1.1s ease-in-out infinite}
@keyframes bz-pisca{50%{opacity:.35}}
.bz-cartao{transition:transform .8s cubic-bezier(.2,.9,.3,1.1),opacity .4s;transform-origin:center}
.bz-cartao.longe{opacity:0;transform:translate(22px,44px) rotate(18deg)}
.bz-cartao.espera{transform:translate(12px,34px) rotate(14deg)}
.bz-cartao.encosta{transform:none}
.bz-cartao.foi{opacity:0;transform:translate(30px,-10px) rotate(-6deg)}
.bz-laser{animation:bz-laser .5s .55s ease-in-out 2.5 both}
@keyframes bz-laser{0%,100%{opacity:0}50%{opacity:.55}}
.bz-voa{animation:bz-voa 1.2s .7s cubic-bezier(.5,0,.3,1) both}
@keyframes bz-voa{from{transform:translate(var(--dx),var(--dy)) scale(1.2);opacity:0}12%{opacity:1}80%{opacity:1;transform:none}to{opacity:0;transform:none}}
.bz-entra{animation:bz-entra .5s 1.6s ease-out both}
@keyframes bz-entra{from{opacity:0;transform:translateX(-10px)}}
.bz-surge{animation:bz-surge .45s ease-out both}
@keyframes bz-surge{from{opacity:0;transform:translateY(8px) scale(.96)}}
@media (prefers-reduced-motion:reduce){
  .bz *{animation:none!important;transition:none!important}
  .bz-laser{opacity:.55}
}
`;

export function IlustracaoDaBalanca() {
  const [passo, setPasso] = useState(0);
  const [tocando, setTocando] = useState(true);
  const [movimento, setMovimento] = useState(true);
  const [kg, setKg] = useState(0);

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setMovimento(false);
      setTocando(false);
    }
  }, []);

  useEffect(() => {
    if (!tocando) return;
    const t = setTimeout(() => setPasso((p) => (p + 1) % PASSOS.length), DURACAO_MS);
    return () => clearTimeout(t);
  }, [passo, tocando]);

  // O visor da balança: sobe e balança um pouco antes de firmar no 0,452.
  useEffect(() => {
    if (passo === 1 || passo === 2) { setKg(PESO); return; }
    if (!movimento) { setKg(passo === 0 ? PESO : 0); return; }
    if (passo === 3) {
      const t = setTimeout(() => setKg(0), 450);
      return () => clearTimeout(t);
    }
    const marcas: [number, number][] = [[0, 0], [550, 0], [1000, 0.471], [1350, 0.438], [1650, 0.456], [1900, PESO]];
    const inicio = performance.now();
    let quadro = 0;
    const anda = (agora: number) => {
      // O carimbo do quadro pode vir um tico antes do `inicio`.
      const t = Math.max(1, agora - inicio);
      const i = marcas.findIndex(([ms]) => ms > t);
      if (i === -1) { setKg(PESO); return; }
      const [t0, k0] = marcas[i - 1];
      const [t1, k1] = marcas[i];
      setKg(Math.round((k0 + ((k1 - k0) * (t - t0)) / (t1 - t0)) * 1000) / 1000);
      quadro = requestAnimationFrame(anda);
    };
    quadro = requestAnimationFrame(anda);
    return () => cancelAnimationFrame(quadro);
  }, [passo, movimento]);

  const atual = PASSOS[passo];

  return (
    <section className="bz" aria-label="Como funciona a balança automática">
      <style dangerouslySetInnerHTML={{ __html: ESTILO }} />
      <div className="bz-topo">
        <h2>Como funciona no salão</h2>
        <button type="button" className="bz-tocar" onClick={() => setTocando((v) => !v)}>
          {tocando ? "❚❚ Pausar" : "▶ Tocar"}
        </button>
      </div>
      <div className="bz-abas" role="tablist">
        {PASSOS.map((p, i) => (
          <button key={p.rotulo} type="button" role="tab" aria-selected={passo === i}
            className={`bz-aba${passo === i ? " ativa" : ""}`}
            onClick={() => { setTocando(false); setPasso(i); }}>
            {p.rotulo}
            {/* A barrinha conta o tempo até a próxima etapa; parado, ela some. */}
            <span key={`${passo}-${tocando}`} className={`bz-tempo${tocando ? " corre" : ""}`} />
          </button>
        ))}
      </div>

      <div className="bz-palco" aria-hidden>
        <Cena a={LARGO} passo={passo} kg={kg} movimento={movimento} className="bz-largo" />
        <Cena a={ALTO} passo={passo} kg={kg} movimento={movimento} className="bz-alto" />
      </div>

      <div className="bz-texto">
        <b aria-live="polite">{atual.titulo}</b>
        <p>{atual.texto}</p>
        <small>Exemplo ilustrativo: “Refeição por kg” a R$ 51,90 o quilo, prato de 0,452 kg e um suco de R$ 8,00 lançado pelo garçom no mesmo cartão.</small>
      </div>
    </section>
  );
}

// ─── A cena ──────────────────────────────────────────────────────────────

function Cena({ a, passo, kg, movimento, className }: { a: Arranjo; passo: number; kg: number; movimento: boolean; className: string }) {
  const [w, h] = a.vb;
  // O valor sai do meio da tela do computador e pousa na linha nova da comanda.
  const dx = a.pc[0] + 105 - (a.comanda[0] + 129);
  const dy = a.pc[1] + 40 - (a.comanda[1] + 81);
  const pesando = passo === 0 && kg > 0;
  return (
    <svg className={className} viewBox={`0 0 ${w} ${h}`} xmlns="http://www.w3.org/2000/svg" fontFamily="Inter, system-ui, sans-serif">
      <defs>
        <linearGradient id={`bz-inox-${className}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#F1F5F9" />
          <stop offset="1" stopColor="#94A3B8" />
        </linearGradient>
        <filter id={`bz-sombra-${className}`} x="-20%" y="-20%" width="140%" height="150%">
          <feDropShadow dx="0" dy="8" stdDeviation="9" floodColor="#0F172A" floodOpacity=".16" />
        </filter>
      </defs>

      {a.bancadas.map(([x, y, l]) => (
        <g key={`${x}-${y}`}>
          <rect x={x} y={y} width={l} height={12} rx={6} fill="#CBD5E1" />
          <rect x={x} y={y} width={l} height={3} rx={1.5} fill="#E2E8F0" />
        </g>
      ))}

      {/* Cabos: a balança fala com o computador; o leitor também. */}
      <path d={a.cabo} fill="none" stroke="#334155" strokeWidth={3.5} strokeLinecap="round" />
      {(passo === 0 || passo === 1) && <path d={a.cabo} fill="none" stroke={TEAL_CLARO} strokeWidth={2.5} strokeLinecap="round" className={movimento && pesando ? "bz-fluxo" : undefined} opacity={pesando || passo === 1 ? 1 : 0} />}
      {a.usb && <path d={a.usb} fill="none" stroke="#334155" strokeWidth={3} strokeLinecap="round" />}

      <Balanca x={a.balanca[0]} y={a.balanca[1]} kg={kg} passo={passo} movimento={movimento} inox={`url(#bz-inox-${className})`} />
      <Computador x={a.pc[0]} y={a.pc[1]} kg={kg} passo={passo} />
      <Leitor x={a.leitor[0]} y={a.leitor[1]} passo={passo} />
      <Comanda x={a.comanda[0]} y={a.comanda[1]} passo={passo} sombra={`url(#bz-sombra-${className})`} />

      {/* A conta, por cima do computador, quando o peso firma. */}
      {passo === 1 && (
        <g transform={`translate(${a.conta[0] - 118} ${a.conta[1] - 14})`}>
          <g className="bz-surge">
            <rect width={236} height={28} rx={14} fill="#FFF" stroke={TEAL_VIVO} strokeWidth={2} />
            <text x={118} y={18.5} textAnchor="middle" fontSize={11.5} fontWeight={800} fill={ESCURO}>
              0,452 kg × R$ 51,90/kg <tspan fill={TEAL}>= R$ 23,46</tspan>
            </text>
          </g>
        </g>
      )}

      {/* O valor voando da tela para a comanda. */}
      {passo === 2 && movimento && (
        <g transform={`translate(${a.comanda[0] + 100} ${a.comanda[1] + 71})`}>
          <g className="bz-voa" style={{ ["--dx" as string]: `${dx}px`, ["--dy" as string]: `${dy}px` }}>
            <rect width={58} height={20} rx={10} fill={TEAL_VIVO} />
            <text x={29} y={14} textAnchor="middle" fontSize={10} fontWeight={900} fill={ESCURO}>R$ 23,46</text>
          </g>
        </g>
      )}
    </svg>
  );
}

function Rotulo({ x, y, children }: { x: number; y: number; children: string }) {
  return <text x={x} y={y} textAnchor="middle" fontSize={10.5} fontWeight={800} fill="#475569">{children}</text>;
}

/** Balança de balcão: prato, plataforma de inox, base e o visor na torre. */
function Balanca({ x, y, kg, passo, movimento, inox }: { x: number; y: number; kg: number; passo: number; movimento: boolean; inox: string }) {
  const classe = passo === 0 ? "bz-prato-desce" : passo === 3 ? "bz-prato-sai" : undefined;
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x={150} y={40} width={22} height={78} rx={5} fill="#94A3B8" />
      <rect x={104} y={0} width={86} height={48} rx={9} fill="#1F2937" />
      <rect x={111} y={7} width={72} height={27} rx={4} fill="#042F2E" />
      <text x={178} y={27.5} textAnchor="end" fill={TEAL_CLARO} fontFamily={MONO} fontSize={18} fontWeight={800}>{kgTexto(kg)}</text>
      <text x={180} y={44} textAnchor="end" fill="#94A3B8" fontSize={8} fontWeight={700}>kg</text>
      {kg > 0 && passo < 3 && (
        <circle cx={116} cy={42} r={3} fill={kg === PESO ? "#22C55E" : "#F59E0B"} className={kg !== PESO && movimento ? "bz-pisca" : undefined} />
      )}

      <rect x={0} y={112} width={190} height={30} rx={9} fill="#334155" />
      <rect x={12} y={124} width={46} height={4} rx={2} fill="#475569" />
      <rect x={184} y={120} width={9} height={11} rx={2} fill={ESCURO} />
      <rect x={6} y={100} width={150} height={14} rx={5} fill={inox} />

      <g transform="translate(81 92)">
        <g className={classe} key={passo === 0 ? "desce" : passo === 3 ? "sai" : "parado"}>
          <ellipse cx={0} cy={7} rx={60} ry={11} fill="#CBD5E1" />
          <ellipse cx={0} cy={4} rx={60} ry={11} fill="#FFF" />
          <ellipse cx={0} cy={3} rx={44} ry={7} fill="#F1F5F9" />
          <ellipse cx={-18} cy={-1} rx={17} ry={7} fill="#FEF3C7" />
          <ellipse cx={4} cy={1} rx={12} ry={6} fill="#78350F" />
          <ellipse cx={23} cy={-2} rx={12} ry={6.5} fill="#B45309" />
          <circle cx={-4} cy={-7} r={5.5} fill="#22C55E" />
          <circle cx={7} cy={-8} r={4.5} fill="#16A34A" />
          <circle cx={33} cy={3} r={3.5} fill="#EF4444" />
        </g>
      </g>
      <Rotulo x={95} y={160}>Balança</Rotulo>
    </g>
  );
}

/** O computador com a tela de pesar do FireHub (os textos são os da tela real). */
function Computador({ x, y, kg, passo }: { x: number; y: number; kg: number; passo: number }) {
  let status = "Coloque o prato na balança";
  let cor = "#E2E8F0";
  let pisca = false;
  if (passo === 0 && kg > 0) { status = "Aguarde o peso firmar…"; pisca = true; }
  if (passo === 1) { status = "Passe o cartão da comanda"; cor = TEAL_CLARO; }
  if (passo === 2) { status = "✅ R$ 23,46 na comanda 17"; cor = "#86EFAC"; }

  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x={10} y={0} width={190} height={124} rx={8} fill="#111827" />
      <rect x={18} y={8} width={174} height={108} rx={4} fill={ESCURO} />
      <text x={24} y={20} fontSize={6.5} fontWeight={800} fill="#FFF">⚖️ Restaurante Sabor</text>
      <text x={186} y={20} textAnchor="end" fontSize={6.5} fill="#94A3B8">Refeição por kg · R$ 51,90/kg</text>
      <line x1={18} y1={25} x2={192} y2={25} stroke="#1E293B" />

      <text x={105} y={42} textAnchor="middle" fontSize={10.5} fontWeight={900} fill={cor} className={pisca ? "bz-pisca" : undefined}>{status}</text>
      {passo === 2 && <text x={105} y={54} textAnchor="middle" fontSize={6.5} fill="#CBD5E1">Total da comanda: R$ 31,46. Retire o prato.</text>}

      {passo === 1 ? (
        <>
          <text x={68} y={74} textAnchor="middle" fontSize={19} fontWeight={900} fill="#FFF" fontFamily={MONO}>{kgTexto(kg)} kg</text>
          <text x={156} y={74} textAnchor="middle" fontSize={15} fontWeight={900} fill={TEAL_CLARO}>R$ 23,46</text>
        </>
      ) : (
        <text x={105} y={passo === 2 ? 80 : 76} textAnchor="middle" fontSize={passo === 2 ? 16 : 22} fontWeight={900} fill="#FFF" fontFamily={MONO}>{kgTexto(kg)} kg</text>
      )}
      <text x={105} y={92} textAnchor="middle" fontSize={5} fill="#64748B">Não verificado — o peso que vale é o do visor da balança</text>

      {passo === 1 && (
        <g>
          <rect x={40} y={99} width={88} height={12} rx={3} fill="#0B1220" stroke={TEAL_VIVO} strokeWidth={1.2} />
          <text x={84} y={107.5} textAnchor="middle" fontSize={6} fontWeight={800} fill="#64748B">Nº do cartão</text>
          <rect x={132} y={99} width={40} height={12} rx={3} fill={TEAL_VIVO} />
          <text x={152} y={107.5} textAnchor="middle" fontSize={6.5} fontWeight={900} fill={ESCURO}>Lançar</text>
        </g>
      )}

      <path d="M0 124 H210 L198 136 H12 Z" fill="#CBD5E1" />
      <rect x={88} y={124} width={34} height={4} rx={2} fill="#94A3B8" />
      <Rotulo x={105} y={152}>Computador com o FireHub</Rotulo>
    </g>
  );
}

/** Leitor de código de barras de mesa: o cliente só encosta o cartão na frente. */
function Leitor({ x, y, passo }: { x: number; y: number; passo: number }) {
  const cartao = passo === 0 ? "longe" : passo === 1 ? "espera" : passo === 2 ? "encosta" : "foi";
  return (
    <g transform={`translate(${x} ${y})`}>
      {passo === 2 && <polygon className="bz-laser" points="60,37 60,51 120,72 120,16" fill="#EF4444" />}
      <rect x={4} y={92} width={56} height={12} rx={6} fill="#1F2937" />
      <rect x={26} y={58} width={12} height={36} rx={3} fill="#334155" />
      <rect x={6} y={26} width={52} height={36} rx={10} fill="#475569" />
      <rect x={14} y={32} width={26} height={4} rx={2} fill="#FFF" opacity={0.25} />
      <rect x={52} y={34} width={8} height={20} rx={3} fill="#EF4444" opacity={passo === 2 ? 1 : 0.6} />

      <g transform="translate(76 14)">
        <g className={`bz-cartao ${cartao}`}>
          <rect width={44} height={62} rx={5} fill="#FFF" stroke="#CBD5E1" />
          <text x={22} y={13} textAnchor="middle" fontSize={6.5} fontWeight={700} fill="#475569">Comanda</text>
          <text x={22} y={34} textAnchor="middle" fontSize={17} fontWeight={900} fill="#111" fontFamily={MONO}>17</text>
          {[0, 3, 5, 9, 11, 14, 18, 20, 23, 27, 29, 32].map((bx, i) => (
            <rect key={bx} x={6 + bx} y={42} width={i % 3 === 0 ? 2 : 1.2} height={13} fill="#111" />
          ))}
        </g>
      </g>
      <Rotulo x={32} y={120}>Leitor de mesa</Rotulo>
    </g>
  );
}

/** A comanda 17 no sistema; na última etapa, a conta fechada no caixa. */
function Comanda({ x, y, passo, sombra }: { x: number; y: number; passo: number; sombra: string }) {
  const comPrato = passo >= 2;
  const fechada = passo === 3;
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect width={170} height={215} rx={12} fill="#FFF" filter={sombra} />
      <path d="M12 0 H158 A12 12 0 0 1 170 12 V34 H0 V12 A12 12 0 0 1 12 0 Z" fill={fechada ? ESCURO : TEAL} />
      <text x={14} y={22} fontSize={12.5} fontWeight={900} fill="#FFF">{fechada ? "Caixa · comanda 17" : "Comanda 17"}</text>

      <text x={14} y={56} fontSize={9.5} fontWeight={700} fill="#334155">1x Suco natural</text>
      <text x={156} y={56} textAnchor="end" fontSize={9.5} fontWeight={700} fill="#334155">8,00</text>
      <text x={14} y={67} fontSize={7.5} fill="#94A3B8">lançado pelo garçom</text>

      {comPrato ? (
        <g key={fechada ? "fixo" : "novo"} className={fechada ? undefined : "bz-entra"}>
          <rect x={6} y={74} width={158} height={32} rx={6} fill={fechada ? "#F8FAFC" : "#F0FDFA"} />
          <text x={14} y={88} fontSize={9.5} fontWeight={900} fill={ESCURO}>Refeição por kg</text>
          <text x={156} y={88} textAnchor="end" fontSize={9.5} fontWeight={900} fill={ESCURO}>23,46</text>
          <text x={14} y={100} fontSize={7.5} fill={TEAL}>{fechada ? "0,452 KG × 51,90" : "0,452 kg · pela balança"}</text>
        </g>
      ) : (
        <text x={14} y={92} fontSize={8.5} fill="#94A3B8" fontStyle="italic">esperando o prato…</text>
      )}

      <line x1={14} y1={116} x2={156} y2={116} stroke="#CBD5E1" strokeDasharray="3 3" />
      <text x={14} y={136} fontSize={12} fontWeight={900} fill={ESCURO}>Total</text>
      <text x={156} y={136} textAnchor="end" fontSize={12} fontWeight={900} fill={ESCURO}>R$ {comPrato ? "31,46" : "8,00"}</text>

      {fechada && (
        <g className="bz-surge">
          <rect x={12} y={150} width={146} height={24} rx={12} fill="#DCFCE7" />
          <text x={85} y={165.5} textAnchor="middle" fontSize={9} fontWeight={900} fill="#166534">✓ Conta fechada no caixa</text>
          <rect x={12} y={180} width={146} height={24} rx={12} fill="#ECFEFF" />
          <text x={85} y={195.5} textAnchor="middle" fontSize={9} fontWeight={800} fill="#155E75">NFC-e com o prato em KG</text>
        </g>
      )}
      {passo === 2 && <text x={85} y={170} textAnchor="middle" fontSize={8.5} fontWeight={800} fill={TEAL}>entrou sozinho, sem digitar</text>}
    </g>
  );
}
