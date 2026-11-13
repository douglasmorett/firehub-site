/**
 * Os desenhos da tela do Modo Contingência (12/11/2026): os DOIS modos lado a
 * lado e os 3 passos da instalação. SVG feito aqui, sem biblioteca: escala
 * com a largura do cartão e fica nítido em qualquer tela.
 *
 *   DesenhoModoWeb          Modo 1 — a loja sem internet, a nuvem pausa os
 *                           canais e avisa o dono; o celular segue pelo 4G.
 *   DesenhoModoComputador   Modo 2 — o FireHub inteiro no computador do
 *                           caixa (janela, banco, impressora, TV e garçom),
 *                           com a nuvem fora e o escudo.
 *   DesenhoDoPasso          instalar → ativar → pronto.
 */

const roxo = "#7C3AED";
const roxoEscuro = "#5B21B6";
const roxoClaro = "#EDE9FE";
const verde = "#16A34A";
const vermelho = "#DC2626";
const ambar = "#D97706";
const ardosia = "#334155";
const cinza = "#94A3B8";

function Nuvem({ x, y, escala = 1, cor = "#fff", borda = "#CBD5E1" }: { x: number; y: number; escala?: number; cor?: string; borda?: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${escala})`}>
      <path
        d="M14 34c-7.7 0-14-5.6-14-12.6 0-6.4 5.2-11.6 12-12.4C14.3 3.8 20.4 0 27.4 0c8.6 0 15.8 5.8 17.4 13.6 6.6.4 11.2 5 11.2 10.4 0 5.6-5 10-11.4 10Z"
        fill={cor}
        stroke={borda}
        strokeWidth={2}
      />
    </g>
  );
}

function Selo({ x, y, texto, fundo, cor }: { x: number; y: number; texto: string; fundo: string; cor: string }) {
  const largura = texto.length * 5.6 + 16;
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect width={largura} height={18} rx={9} fill={fundo} />
      <text x={largura / 2} y={12.5} textAnchor="middle" fontSize={9.5} fontWeight={800} fill={cor} fontFamily="inherit">
        {texto}
      </text>
    </g>
  );
}

/** Modo 1 — "Na web": a loja caiu, a nuvem protege. */
export function DesenhoModoWeb() {
  return (
    <svg viewBox="0 0 320 170" width="100%" role="img" aria-label="A internet da loja caiu: o FireHub na nuvem pausa os canais e avisa o dono; o celular segue pelo 4G" style={{ display: "block" }}>
      <defs>
        <linearGradient id="dm-web-fundo" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#EFF6FF" />
          <stop offset="1" stopColor="#F8FAFC" />
        </linearGradient>
      </defs>
      <rect width="320" height="170" rx="16" fill="url(#dm-web-fundo)" />

      {/* A nuvem do FireHub */}
      <Nuvem x={128} y={14} escala={1.15} cor="#fff" borda="#93C5FD" />
      <text x={160} y={42} textAnchor="middle" fontSize={10} fontWeight={900} fill="#1D4ED8" fontFamily="inherit">FireHub</text>
      <Selo x={196} y={10} texto="iFood pausado" fundo="#FEF3C7" cor={ambar} />
      <Selo x={30} y={10} texto="site: volte já" fundo="#FEF3C7" cor={ambar} />

      {/* A loja, sem internet */}
      <g transform="translate(34 92)">
        <rect x={0} y={18} width={78} height={52} rx={6} fill="#fff" stroke="#CBD5E1" strokeWidth={2} />
        <path d="M-4 18 L6 0 H72 L82 18 Z" fill="#FCA5A5" />
        <path d="M6 0 H19 L14 18 H-4 Z M32 0 H45 L42 18 H28 Z M58 0 H72 L82 18 H64 Z" fill="#fff" opacity={0.7} />
        <rect x={10} y={32} width={24} height={38} rx={3} fill="#E2E8F0" />
        <rect x={44} y={32} width={26} height={18} rx={3} fill="#DBEAFE" />
      </g>
      {/* A linha da loja até a nuvem, cortada */}
      <path d="M86 96 L136 50" stroke={vermelho} strokeWidth={2.5} strokeDasharray="5 5" fill="none" />
      <g transform="translate(103 66)">
        <circle r={10} fill="#FEE2E2" />
        <path d="M-4 -4 L4 4 M4 -4 L-4 4" stroke={vermelho} strokeWidth={2.6} strokeLinecap="round" />
      </g>

      {/* O celular do dono, pelo 4G */}
      <g transform="translate(226 74)">
        <rect x={0} y={0} width={40} height={70} rx={8} fill={ardosia} />
        <rect x={4} y={8} width={32} height={52} rx={3} fill="#fff" />
        <rect x={8} y={13} width={24} height={6} rx={2} fill={roxo} />
        <rect x={8} y={23} width={24} height={4} rx={2} fill="#E2E8F0" />
        <rect x={8} y={30} width={18} height={4} rx={2} fill="#E2E8F0" />
        <g transform="translate(9 40)">
          <rect width={22} height={14} rx={3} fill="#DCFCE7" />
          <path d="M4 5 L10 5 M4 9 L16 9" stroke={verde} strokeWidth={1.8} strokeLinecap="round" />
        </g>
        <g transform="translate(46 4)">
          {[0, 1, 2, 3].map((i) => (
            <rect key={i} x={i * 5} y={12 - i * 4} width={3.5} height={4 + i * 4} rx={1} fill={verde} />
          ))}
          <text x={10} y={28} textAnchor="middle" fontSize={9} fontWeight={900} fill={verde} fontFamily="inherit">4G</text>
        </g>
      </g>
      <path d="M232 76 L190 48" stroke={verde} strokeWidth={2.5} strokeDasharray="5 5" fill="none" />

      {/* O aviso no WhatsApp */}
      <g transform="translate(150 112)">
        <rect width={64} height={26} rx={8} fill="#DCFCE7" stroke="#86EFAC" />
        <text x={32} y={11} textAnchor="middle" fontSize={7.5} fontWeight={800} fill="#166534" fontFamily="inherit">Aviso no</text>
        <text x={32} y={21} textAnchor="middle" fontSize={7.5} fontWeight={800} fill="#166534" fontFamily="inherit">WhatsApp</text>
      </g>
    </svg>
  );
}

/** Modo 2 — "FireHub instalado no computador": tudo roda no PC, até com a nuvem fora. */
export function DesenhoModoComputador({ escuro = false }: { escuro?: boolean }) {
  return (
    <svg viewBox="0 0 320 170" width="100%" role="img" aria-label="O FireHub inteiro no computador do caixa: telas, banco da loja, impressora, TV e celular do garçom funcionando sem internet" style={{ display: "block" }}>
      <defs>
        <linearGradient id={`dm-pc-fundo-${escuro ? "e" : "c"}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={escuro ? "#2E1065" : "#F5F3FF"} />
          <stop offset="1" stopColor={escuro ? "#4C1D95" : "#EDE9FE"} />
        </linearGradient>
        <linearGradient id="dm-pc-tela" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8B5CF6" />
          <stop offset="1" stopColor={roxoEscuro} />
        </linearGradient>
      </defs>
      <rect width="320" height="170" rx="16" fill={`url(#dm-pc-fundo-${escuro ? "e" : "c"})`} />

      {/* A nuvem fora do ar — e não faz falta */}
      <g opacity={0.9}>
        <Nuvem x={238} y={12} escala={0.85} cor={escuro ? "#3B0764" : "#fff"} borda={escuro ? "#7C3AED" : "#C4B5FD"} />
        <path d="M244 46 L290 14" stroke={vermelho} strokeWidth={3} strokeLinecap="round" />
      </g>

      {/* O computador do caixa com o FireHub aberto */}
      <g transform="translate(92 26)">
        <rect x={0} y={0} width={136} height={90} rx={9} fill={ardosia} />
        <rect x={6} y={6} width={124} height={76} rx={5} fill="#fff" />
        <rect x={6} y={6} width={124} height={14} rx={5} fill="url(#dm-pc-tela)" />
        <rect x={6} y={14} width={124} height={6} fill="url(#dm-pc-tela)" />
        <circle cx={14} cy={13} r={2.4} fill="#fff" opacity={0.9} />
        <text x={22} y={16.5} fontSize={8} fontWeight={900} fill="#fff" fontFamily="inherit">FireHub</text>
        {/* colunas do quadro de pedidos */}
        {[0, 1, 2].map((c) => (
          <g key={c} transform={`translate(${12 + c * 40} 26)`}>
            <rect width={34} height={50} rx={4} fill="#F1F5F9" />
            <rect x={4} y={5} width={26} height={12} rx={3} fill={c === 0 ? "#FEF3C7" : c === 1 ? roxoClaro : "#DCFCE7"} />
            <rect x={4} y={21} width={26} height={12} rx={3} fill={c === 0 ? "#FEF3C7" : c === 1 ? roxoClaro : "#DCFCE7"} />
            {c < 2 && <rect x={4} y={37} width={26} height={9} rx={3} fill="#E2E8F0" />}
          </g>
        ))}
        <rect x={56} y={90} width={24} height={12} fill="#475569" />
        <rect x={40} y={101} width={56} height={6} rx={3} fill="#475569" />
      </g>

      {/* O escudo: funciona até offline */}
      <g transform="translate(70 18)">
        <path d="M22 0 L42 8 V24 C42 37 33 46 22 50 C11 46 2 37 2 24 V8 Z" fill={verde} stroke="#fff" strokeWidth={3} />
        <path d="M12 25 L19 32 L32 18" stroke="#fff" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </g>

      {/* O banco da loja (a cópia) */}
      <g transform="translate(236 72)">
        <ellipse cx={20} cy={6} rx={20} ry={6} fill="#A78BFA" />
        <path d="M0 6 V34 C0 37.3 9 40 20 40 C31 40 40 37.3 40 34 V6" fill={roxo} />
        <path d="M0 16 C0 19.3 9 22 20 22 C31 22 40 19.3 40 16 M0 26 C0 29.3 9 32 20 32 C31 32 40 29.3 40 26" stroke="#C4B5FD" strokeWidth={1.6} fill="none" />
        <ellipse cx={20} cy={6} rx={20} ry={6} fill="#C4B5FD" />
      </g>
      <text x={256} y={128} textAnchor="middle" fontSize={8.5} fontWeight={800} fill={escuro ? "#DDD6FE" : roxoEscuro} fontFamily="inherit">dados da loja</text>
      <path d="M228 86 L236 88" stroke="#C4B5FD" strokeWidth={2} />

      {/* A impressora */}
      <g transform="translate(22 106)">
        <rect x={0} y={10} width={50} height={28} rx={6} fill="#475569" />
        <rect x={8} y={0} width={34} height={14} rx={2} fill="#fff" stroke="#CBD5E1" />
        <rect x={10} y={30} width={30} height={22} rx={2} fill="#fff" stroke="#CBD5E1" />
        <path d="M15 37 H35 M15 42 H31 M15 47 H27" stroke={cinza} strokeWidth={1.6} strokeLinecap="round" />
        <circle cx={42} cy={20} r={2.5} fill="#4ADE80" />
      </g>
      <path d="M72 120 L94 112" stroke={escuro ? "#A78BFA" : "#C4B5FD"} strokeWidth={2} strokeDasharray="4 4" />

      {/* TV da cozinha e celular do garçom pela rede da loja */}
      <g transform="translate(126 140)">
        <rect x={0} y={0} width={36} height={22} rx={3} fill={ardosia} />
        <rect x={3} y={3} width={30} height={16} rx={2} fill="#FEF3C7" />
        <path d="M8 8 H20 M8 13 H26" stroke={ambar} strokeWidth={1.8} strokeLinecap="round" />
      </g>
      <g transform="translate(176 136)">
        <rect x={0} y={0} width={18} height={30} rx={4} fill={ardosia} />
        <rect x={2.5} y={4} width={13} height={21} rx={1.5} fill="#fff" />
        <rect x={5} y={8} width={8} height={3} rx={1} fill={roxo} />
      </g>
      <path d="M144 140 L152 134 M185 136 L178 134" stroke={escuro ? "#A78BFA" : "#C4B5FD"} strokeWidth={2} strokeDasharray="3 3" />
      <Selo x={210} y={142} texto="sem internet: ok" fundo="#DCFCE7" cor="#166534" />
    </svg>
  );
}

/** Os 3 passos: 1 instalar, 2 ativar, 3 pronto. */
export function DesenhoDoPasso({ n }: { n: 1 | 2 | 3 }) {
  return (
    <svg viewBox="0 0 120 76" width="100%" role="img" aria-label={n === 1 ? "Instalar" : n === 2 ? "Ativar" : "Pronto"} style={{ display: "block", maxWidth: 160, margin: "0 auto" }}>
      <rect width="120" height="76" rx="14" fill={n === 3 ? "#F0FDF4" : "#F5F3FF"} />
      {n === 1 && (
        <g>
          <rect x={30} y={18} width={60} height={40} rx={5} fill={ardosia} />
          <rect x={34} y={22} width={52} height={30} rx={3} fill="#fff" />
          <rect x={52} y={58} width={16} height={6} fill="#475569" />
          <path d="M60 25 V43 M52 36 L60 44 L68 36" stroke={roxo} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <rect x={48} y={46} width={24} height={3} rx={1.5} fill={roxoClaro} />
        </g>
      )}
      {n === 2 && (
        <g>
          <rect x={24} y={26} width={72} height={26} rx={13} fill={roxo} />
          <circle cx={83} cy={39} r={10} fill="#fff" />
          <text x={50} y={43} textAnchor="middle" fontSize={11} fontWeight={900} fill="#fff" fontFamily="inherit">ATIVAR</text>
          <path d="M84 52 l8 14 l3 -6 l6 -1 Z" fill={ardosia} stroke="#fff" strokeWidth={1.5} strokeLinejoin="round" />
        </g>
      )}
      {n === 3 && (
        <g>
          <path d="M60 12 L82 20 V36 C82 50 72 60 60 64 C48 60 38 50 38 36 V20 Z" fill={verde} />
          <path d="M49 38 L57 46 L72 30" stroke="#fff" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <path d="M24 22 l3 -6 l3 6 l6 3 l-6 3 l-3 6 l-3 -6 l-6 -3 Z" fill="#FBBF24" />
          <path d="M94 46 l2 -4 l2 4 l4 2 l-4 2 l-2 4 l-2 -4 l-4 -2 Z" fill="#FBBF24" />
        </g>
      )}
    </svg>
  );
}
