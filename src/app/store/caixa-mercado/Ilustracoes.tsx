/**
 * Ilustrações do módulo Caixa de mercado (SVG inline, sem imagem de fora):
 * o caixa completo no topo e uma por recurso, nas cores do FireHub.
 */

const LARANJA = "#EA580C";
const VERMELHO = "#DC2626";
const ESCURO = "#3F3A35";
const CINZA = "#E9E3DC";
const CLARO = "#FFF4EC";
const PESSEGO = "#FDBA74";
const VERDE = "#16A34A";

type P = { className?: string };
const base = { role: "img", xmlns: "http://www.w3.org/2000/svg", fontFamily: "Inter, system-ui, sans-serif" } as const;

/** Código de barras desenhado com barras de larguras alternadas. */
function Barras({ x, y, largura, altura }: { x: number; y: number; largura: number; altura: number }) {
  const padrao = [2, 1, 1, 3, 1, 2, 1, 1, 2, 3, 1, 1, 2, 1, 3, 1, 2, 1];
  const total = padrao.reduce((s, v) => s + v, 0) * 2;
  const k = largura / total;
  let cx = x;
  return (
    <g fill={ESCURO}>
      {padrao.map((w, i) => {
        const r = <rect key={i} x={cx} y={y} width={w * k} height={altura} />;
        cx += (w + padrao[(i + 5) % padrao.length]) * k;
        return r;
      })}
    </g>
  );
}

/** O caixa de mercado inteiro: computador, leitor, balança e gaveta. */
export function IlustracaoDoCaixa({ className }: P) {
  return (
    <svg {...base} className={className} viewBox="0 0 440 300" aria-label="Caixa de mercado com computador, leitor de código de barras, balança e gaveta">
      <defs>
        <linearGradient id="cm-balcao" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#F97316" />
          <stop offset="1" stopColor={VERMELHO} />
        </linearGradient>
      </defs>
      <ellipse cx="220" cy="150" rx="212" ry="128" fill="#FFE8D6" />
      <circle cx="380" cy="52" r="20" fill="#FFD7B5" />
      <circle cx="54" cy="64" r="12" fill="#FFD7B5" />

      {/* balcão */}
      <rect x="24" y="218" width="392" height="68" rx="12" fill="url(#cm-balcao)" />
      <rect x="24" y="238" width="392" height="5" fill="#fff" opacity=".22" />
      <rect x="10" y="204" width="420" height="16" rx="8" fill={ESCURO} />

      {/* leitor no suporte */}
      <rect x="40" y="194" width="44" height="10" rx="4" fill={ESCURO} />
      <rect x="56" y="146" width="12" height="50" rx="3" fill="#57524C" />
      <path d="M36 120h46a10 10 0 0 1 10 10v8a10 10 0 0 1-10 10H36a10 10 0 0 1-10-10v-8a10 10 0 0 1 10-10z" fill={LARANJA} stroke={ESCURO} strokeWidth="3" />
      <rect x="88" y="124" width="7" height="20" rx="2" fill={VERMELHO} />
      <rect x="40" y="128" width="26" height="4" rx="2" fill="#fff" opacity=".45" />
      <polygon className="cm-laser" points="95,128 95,140 132,198 104,186" fill={VERMELHO} opacity=".2" />
      {/* produto com código */}
      <path d="M102 204v-30l7-9h20l7 9v30z" fill="#fff" stroke={ESCURO} strokeWidth="3" strokeLinejoin="round" />
      <rect x="102" y="174" width="34" height="6" fill={CLARO} />
      <Barras x={107} y={184} largura={24} altura={14} />
      <line className="cm-laser" x1="104" y1="191" x2="134" y2="191" stroke={VERMELHO} strokeWidth="2.5" strokeLinecap="round" />

      {/* computador */}
      <rect x="140" y="28" width="150" height="112" rx="12" fill="#2A2622" />
      <rect x="148" y="36" width="134" height="96" rx="6" fill="#fff" />
      <path d="M148 42a6 6 0 0 1 6-6h122a6 6 0 0 1 6 6v12H148z" fill={LARANJA} />
      <text x="156" y="49" fontSize="9" fontWeight="800" fill="#fff">CAIXA 1</text>
      <circle cx="270" cy="45" r="3" fill="#FFE8D6" />
      {[62, 75, 88].map((y, i) => (
        <g key={y}>
          <rect x="156" y={y} width={[64, 52, 70][i]} height="6" rx="3" fill={CINZA} />
          <rect x="248" y={y} width="26" height="6" rx="3" fill={PESSEGO} />
        </g>
      ))}
      <rect x="156" y="104" width="118" height="20" rx="5" fill={CLARO} />
      <text x="163" y="117" fontSize="8" fontWeight="800" fill="#57524C">TOTAL</text>
      <text x="268" y="118" fontSize="12" fontWeight="900" fill={LARANJA} textAnchor="end">R$ 87,40</text>
      <rect x="205" y="140" width="20" height="22" fill="#57524C" />
      <rect x="182" y="160" width="66" height="7" rx="3.5" fill={ESCURO} />
      {/* gaveta */}
      <rect x="150" y="168" width="130" height="36" rx="6" fill={CINZA} stroke={ESCURO} strokeWidth="3" />
      <rect x="150" y="180" width="130" height="3" fill={ESCURO} opacity=".15" />
      <rect x="195" y="188" width="40" height="7" rx="3.5" fill={ESCURO} />
      <circle cx="266" cy="190" r="4" fill={PESSEGO} stroke={ESCURO} strokeWidth="1.5" />

      {/* balança */}
      <rect x="300" y="190" width="10" height="16" fill={ESCURO} />
      <rect x="398" y="190" width="10" height="16" fill={ESCURO} />
      <rect x="296" y="168" width="116" height="30" rx="8" fill={LARANJA} stroke={ESCURO} strokeWidth="3" />
      <rect x="306" y="175" width="58" height="16" rx="3" fill="#2A2622" />
      <text x="335" y="187" fontSize="10" fontWeight="800" fill={PESSEGO} textAnchor="middle" fontFamily="ui-monospace, Consolas, monospace">0,845 kg</text>
      <circle cx="380" cy="183" r="4.5" fill={CLARO} />
      <circle cx="396" cy="183" r="4.5" fill={CLARO} />
      <rect x="290" y="156" width="128" height="10" rx="5" fill={CINZA} stroke={ESCURO} strokeWidth="3" />
      <circle cx="334" cy="139" r="16" fill={VERMELHO} stroke={ESCURO} strokeWidth="3" />
      <circle cx="364" cy="141" r="14" fill="#F97316" stroke={ESCURO} strokeWidth="3" />
      <path d="M334 123c2-7 7-9 12-9-1 5-5 9-12 9z" fill={VERDE} />
      <path d="M364 127c1-6 5-8 10-8-1 5-4 8-10 8z" fill={VERDE} />
      <circle cx="328" cy="134" r="4" fill="#fff" opacity=".35" />
      {/* etiqueta saindo da balança */}
      <g transform="rotate(9 404 110)">
        <rect x="384" y="82" width="42" height="54" rx="5" fill="#fff" stroke={ESCURO} strokeWidth="2.5" />
        <circle cx="405" cy="90" r="2.5" fill={CINZA} />
        <text x="405" y="105" fontSize="9" fontWeight="900" fill={VERMELHO} textAnchor="middle">R$ 15,90</text>
        <Barras x={390} y={112} largura={30} altura={14} />
      </g>
    </svg>
  );
}

export function IlustracaoLeitor({ className }: P) {
  return (
    <svg {...base} className={className} viewBox="0 0 160 110" aria-hidden="true">
      <circle cx="120" cy="30" r="22" fill="#FFE8D6" />
      <polygon points="74,40 74,50 102,92 100,58" fill={VERMELHO} opacity=".18" />
      <rect x="92" y="52" width="56" height="44" rx="6" fill="#fff" stroke={ESCURO} strokeWidth="2.5" />
      <Barras x={100} y={60} largura={40} altura={24} />
      <text x="120" y="92" fontSize="6.5" fontWeight="700" fill="#57524C" textAnchor="middle" fontFamily="ui-monospace, Consolas, monospace">7 891234 567</text>
      <line x1="96" y1="72" x2="144" y2="72" stroke={VERMELHO} strokeWidth="2" strokeLinecap="round" />
      <path d="M24 30h44a8 8 0 0 1 8 8v10a8 8 0 0 1-8 8H50l-8 34a6 6 0 0 1-6 5h-8a5 5 0 0 1-5-6l7-33h-6a8 8 0 0 1-8-8V38a8 8 0 0 1 8-8z" fill={LARANJA} stroke={ESCURO} strokeWidth="2.5" strokeLinejoin="round" />
      <rect x="72" y="34" width="6" height="18" rx="2" fill={VERMELHO} />
      <rect x="26" y="37" width="30" height="4" rx="2" fill="#fff" opacity=".45" />
      <circle cx="38" cy="62" r="3" fill="#fff" opacity=".6" />
    </svg>
  );
}

export function IlustracaoBalanca({ className }: P) {
  return (
    <svg {...base} className={className} viewBox="0 0 160 110" aria-hidden="true">
      <circle cx="40" cy="34" r="24" fill="#FFE8D6" />
      <path d="M38 58l24-22 26 22z" fill="#FCD34D" stroke={ESCURO} strokeWidth="2.5" strokeLinejoin="round" />
      <circle cx="58" cy="50" r="3" fill="#F59E0B" />
      <circle cx="70" cy="53" r="2" fill="#F59E0B" />
      <rect x="16" y="58" width="96" height="8" rx="4" fill={CINZA} stroke={ESCURO} strokeWidth="2.5" />
      <rect x="22" y="68" width="84" height="28" rx="7" fill={LARANJA} stroke={ESCURO} strokeWidth="2.5" />
      <rect x="30" y="74" width="44" height="15" rx="3" fill="#2A2622" />
      <text x="52" y="85" fontSize="9" fontWeight="800" fill={PESSEGO} textAnchor="middle" fontFamily="ui-monospace, Consolas, monospace">1,250</text>
      <circle cx="86" cy="82" r="3.5" fill={CLARO} />
      <circle cx="97" cy="82" r="3.5" fill={CLARO} />
      <g transform="rotate(8 133 52)">
        <rect x="114" y="24" width="38" height="54" rx="5" fill="#fff" stroke={ESCURO} strokeWidth="2.5" />
        <circle cx="133" cy="32" r="2.5" fill={CINZA} />
        <text x="133" y="46" fontSize="8.5" fontWeight="900" fill={VERMELHO} textAnchor="middle">R$ 15,90</text>
        <rect x="120" y="50" width="26" height="3" rx="1.5" fill={CINZA} />
        <Barras x={120} y={57} largura={26} altura={14} />
      </g>
    </svg>
  );
}

export function IlustracaoPix({ className }: P) {
  const modulos = [[44, 28], [48, 36], [44, 44], [36, 48], [48, 52], [52, 44], [56, 56], [44, 56], [52, 60], [60, 48], [40, 60], [56, 40]];
  return (
    <svg {...base} className={className} viewBox="0 0 160 110" aria-hidden="true">
      <circle cx="128" cy="26" r="20" fill="#FFE8D6" />
      <rect x="14" y="12" width="92" height="66" rx="7" fill="#2A2622" />
      <rect x="20" y="18" width="80" height="54" rx="3" fill="#fff" />
      {[[26, 22], [52, 22], [26, 48]].map(([x, y]) => (
        <g key={`${x}-${y}`}>
          <rect x={x + 1.5} y={y + 1.5} width="11" height="11" rx="1.5" fill="none" stroke={ESCURO} strokeWidth="3" />
          <rect x={x + 5} y={y + 5} width="4" height="4" fill={ESCURO} />
        </g>
      ))}
      {modulos.map(([x, y]) => <rect key={`${x}-${y}`} x={x - 6} y={y} width="4" height="4" fill={ESCURO} />)}
      <text x="84" y="38" fontSize="7" fontWeight="800" fill="#57524C" textAnchor="middle">Pix</text>
      <text x="84" y="50" fontSize="8" fontWeight="900" fill={LARANJA} textAnchor="middle">R$ 42</text>
      <rect x="72" y="56" width="24" height="9" rx="4.5" fill={CLARO} />
      <text x="84" y="63" fontSize="6" fontWeight="800" fill={VERMELHO} textAnchor="middle">0% taxa</text>
      <rect x="52" y="78" width="16" height="9" fill="#57524C" />
      <rect x="40" y="86" width="40" height="5" rx="2.5" fill={ESCURO} />
      <g transform="rotate(-10 128 66)">
        <rect x="111" y="36" width="34" height="62" rx="7" fill={LARANJA} stroke={ESCURO} strokeWidth="2.5" />
        <rect x="115" y="44" width="26" height="44" rx="3" fill="#fff" />
        <circle cx="128" cy="64" r="9" fill={VERDE} />
        <path d="M123.5 64l3 3 6-6" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="123" y="91" width="10" height="3" rx="1.5" fill="#fff" opacity=".6" />
      </g>
    </svg>
  );
}

export function IlustracaoPinpad({ className }: P) {
  const teclas = [0, 1, 2].flatMap((i) => [0, 1, 2].map((j) => [70 + i * 12, 54 + j * 9]));
  return (
    <svg {...base} className={className} viewBox="0 0 160 110" aria-hidden="true">
      <circle cx="134" cy="84" r="20" fill="#FFE8D6" />
      <path d="M62 88C34 88 46 44 22 44" fill="none" stroke={ESCURO} strokeWidth="3" strokeLinecap="round" />
      <rect x="8" y="38" width="16" height="12" rx="2.5" fill={CINZA} stroke={ESCURO} strokeWidth="2.5" />
      <rect x="1" y="40.5" width="8" height="7" rx="1" fill="#A8A29E" stroke={ESCURO} strokeWidth="1.5" />
      <text x="16" y="64" fontSize="7" fontWeight="900" fill="#57524C" textAnchor="middle">USB</text>
      <rect x="62" y="18" width="50" height="84" rx="10" fill={ESCURO} />
      <rect x="68" y="25" width="38" height="20" rx="3" fill={CLARO} />
      <text x="87" y="38.5" fontSize="8" fontWeight="900" fill={LARANJA} textAnchor="middle">R$ 58,90</text>
      {teclas.map(([x, y]) => <rect key={`${x}-${y}`} x={x} y={y} width="9" height="6" rx="1.5" fill="#6B645D" />)}
      <rect x="70" y="84" width="9" height="6" rx="1.5" fill={VERMELHO} />
      <rect x="82" y="84" width="9" height="6" rx="1.5" fill="#F59E0B" />
      <rect x="94" y="84" width="9" height="6" rx="1.5" fill={VERDE} />
      <path d="M114 46a10 10 0 0 1 0 14M119 41a17 17 0 0 1 0 24" fill="none" stroke={LARANJA} strokeWidth="2.5" strokeLinecap="round" />
      <g transform="rotate(-14 140 46)">
        <rect x="122" y="32" width="38" height="26" rx="4" fill={VERMELHO} stroke={ESCURO} strokeWidth="2.5" />
        <rect x="128" y="39" width="9" height="7" rx="1.5" fill="#FDE68A" />
        <rect x="128" y="50" width="22" height="3" rx="1.5" fill="#fff" opacity=".6" />
      </g>
    </svg>
  );
}

export function IlustracaoOperadores({ className }: P) {
  return (
    <svg {...base} className={className} viewBox="0 0 160 110" aria-hidden="true">
      <circle cx="80" cy="34" r="26" fill="#FFE8D6" />
      <circle cx="80" cy="28" r="14" fill="#fff" stroke={ESCURO} strokeWidth="2.5" />
      <path d="M80 19v9l6 4" fill="none" stroke={LARANJA} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="30" cy="42" r="10" fill={PESSEGO} stroke={ESCURO} strokeWidth="2.5" />
      <path d="M14 74a16 16 0 0 1 32 0z" fill={LARANJA} stroke={ESCURO} strokeWidth="2.5" strokeLinejoin="round" />
      <circle cx="130" cy="42" r="10" fill={PESSEGO} stroke={ESCURO} strokeWidth="2.5" />
      <path d="M114 74a16 16 0 0 1 32 0z" fill={VERMELHO} stroke={ESCURO} strokeWidth="2.5" strokeLinejoin="round" />
      <rect x="44" y="60" width="72" height="12" rx="2" fill="#fff" stroke={ESCURO} strokeWidth="2.5" />
      <rect x="50" y="56" width="14" height="8" rx="1.5" fill="#86EFAC" stroke={ESCURO} strokeWidth="1.5" />
      <rect x="67" y="56" width="14" height="8" rx="1.5" fill="#86EFAC" stroke={ESCURO} strokeWidth="1.5" />
      <circle cx="92" cy="62" r="4" fill="#FCD34D" stroke={ESCURO} strokeWidth="1.5" />
      <circle cx="102" cy="62" r="4" fill="#FCD34D" stroke={ESCURO} strokeWidth="1.5" />
      <rect x="36" y="72" width="88" height="26" rx="5" fill={CINZA} stroke={ESCURO} strokeWidth="2.5" />
      <rect x="66" y="83" width="28" height="6" rx="3" fill={ESCURO} />
    </svg>
  );
}

export function IlustracaoFiscal({ className }: P) {
  return (
    <svg {...base} className={className} viewBox="0 0 160 110" aria-hidden="true">
      <circle cx="40" cy="28" r="22" fill="#FFE8D6" />
      <rect x="18" y="14" width="76" height="80" rx="6" fill="#fff" stroke={ESCURO} strokeWidth="2.5" />
      <path d="M18 20a6 6 0 0 1 6-6h64a6 6 0 0 1 6 6v8H18z" fill={LARANJA} />
      {[40, 52, 64, 76].map((y) => <line key={y} x1="18" y1={y} x2="94" y2={y} stroke={CINZA} strokeWidth="1.5" />)}
      {[42, 68].map((x) => <line key={x} x1={x} y1="28" x2={x} y2="94" stroke={CINZA} strokeWidth="1.5" />)}
      <rect x="20" y="41" width="21" height="10" fill={CLARO} />
      <rect x="20" y="65" width="21" height="10" fill={CLARO} />
      <rect x="47" y="45" width="16" height="3" rx="1.5" fill={PESSEGO} />
      <rect x="73" y="57" width="16" height="3" rx="1.5" fill={PESSEGO} />
      <path d="M98 20h46v68l-5.75 5-5.75-5-5.75 5-5.75-5-5.75 5-5.75-5-5.75 5-5.75-5z" fill="#fff" stroke={ESCURO} strokeWidth="2.5" strokeLinejoin="round" />
      <text x="121" y="33" fontSize="9" fontWeight="900" fill={VERMELHO} textAnchor="middle">NFC-e</text>
      {[42, 50, 58].map((y, i) => <rect key={y} x="105" y={y} width={[32, 24, 28][i]} height="3.5" rx="1.75" fill={CINZA} />)}
      <line x1="105" y1="67" x2="137" y2="67" stroke={ESCURO} strokeWidth="1.5" strokeDasharray="3 2" />
      <rect x="105" y="73" width="14" height="4" rx="2" fill="#57524C" />
      <rect x="123" y="73" width="14" height="4" rx="2" fill={LARANJA} />
      <rect x="6" y="72" width="34" height="18" rx="9" fill={LARANJA} stroke={ESCURO} strokeWidth="2" />
      <text x="23" y="84.5" fontSize="9" fontWeight="900" fill="#fff" textAnchor="middle">XML</text>
    </svg>
  );
}
