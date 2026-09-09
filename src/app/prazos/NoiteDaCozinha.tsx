/**
 * Uma noite de cozinha, em dois painéis empilhados que dividem o mesmo eixo
 * de horas: em cima quantos pedidos estão na cozinha; embaixo o prazo que o
 * cliente vê — fixo em 30 minutos versus o que a extensão escreve.
 *
 * Dois painéis e não um: pedidos e minutos são unidades diferentes, e chart
 * de eixo duplo é o erro mais comum de leitura. Empilhados com o mesmo x, o
 * olho faz a ligação sozinho ("a barra subiu, a linha laranja subiu junto").
 *
 * Os minutos saem da MESMA regra que a extensão usa de verdade (28/38/58/78
 * com 3 motoboys, a mesma da demonstração do topo). Os pedidos por hora são
 * um exemplo de uma noite — a legenda diz isso.
 *
 * SVG puro, sem biblioteca, para a página continuar abrindo em menos de 2 s.
 */

const MOTOBOYS = 3;
const NOITE = [
  { hora: "18h", pedidos: 3 },
  { hora: "19h", pedidos: 5 },
  { hora: "20h", pedidos: 8 },
  { hora: "21h", pedidos: 14 },
  { hora: "22h", pedidos: 9 },
  { hora: "23h", pedidos: 4 },
];
const FIXO = 30;

function prazoDaExtensao(pedidos: number) {
  if (pedidos <= MOTOBOYS) return 28;
  if (pedidos <= 2 * MOTOBOYS) return 38;
  if (pedidos <= 3 * MOTOBOYS) return 58;
  return 78;
}

// Geometria
const W = 640;
const ESQ = 46, DIR = 14;
const LARG = W - ESQ - DIR;
const SLOT = LARG / NOITE.length;
const BARRA = 38;

const TOPO = { y0: 30, alt: 100 };          // painel de pedidos
const BAIXO = { y0: 184, alt: 100 };        // painel de minutos
const MAX_PED = 16, MAX_MIN = 90;

const xCentro = (i: number) => ESQ + SLOT * i + SLOT / 2;
const yPed = (n: number) => TOPO.y0 + TOPO.alt - (n / MAX_PED) * TOPO.alt;
const yMin = (m: number) => BAIXO.y0 + BAIXO.alt - (m / MAX_MIN) * BAIXO.alt;

const CINZA_TEXTO = "#475569";
const CINZA_FRACO = "#94A3B8";
const BARRA_COR = "#94A3B8";
const LARANJA = "#FF5722";

export default function NoiteDaCozinha() {
  const pontos = NOITE.map((h, i) => ({ x: xCentro(i), y: yMin(prazoDaExtensao(h.pedidos)), min: prazoDaExtensao(h.pedidos), ...h }));
  // linha em degraus: cada hora segura o valor até a próxima
  const degraus = pontos
    .map((p, i) => {
      const x0 = ESQ + SLOT * i, x1 = ESQ + SLOT * (i + 1);
      return `${i === 0 ? "M" : "L"}${x0},${p.y} L${x1},${p.y}`;
    })
    .join(" ");
  const pico = pontos.reduce((a, b) => (b.pedidos > a.pedidos ? b : a));

  return (
    <figure style={{ margin: 0 }}>
      <svg
        viewBox={`0 0 ${W} 318`}
        role="img"
        aria-label="Uma noite: pedidos na cozinha por hora, e o prazo que o cliente vê com prazo fixo de 30 minutos e com a extensão"
        style={{ width: "100%", height: "auto", display: "block", fontFamily: "inherit" }}
      >
        {/* ── painel de cima: pedidos ── */}
        <text x={ESQ} y={TOPO.y0 - 8} fontSize="17" fontWeight="800" fill={CINZA_TEXTO} letterSpacing=".4">PEDIDOS NA COZINHA</text>
        <line x1={ESQ} x2={W - DIR} y1={TOPO.y0 + TOPO.alt} y2={TOPO.y0 + TOPO.alt} stroke="#E2E8F0" strokeWidth="1" />
        {pontos.map((p) => (
          <g key={p.hora}>
            <title>{`${p.hora}: ${p.pedidos} pedidos na cozinha`}</title>
            <rect
              x={p.x - BARRA / 2}
              y={yPed(p.pedidos)}
              width={BARRA}
              height={TOPO.y0 + TOPO.alt - yPed(p.pedidos)}
              rx="4"
              fill={BARRA_COR}
            />
            {/* cobre o arredondamento de baixo: a barra nasce reta na base */}
            <rect x={p.x - BARRA / 2} y={TOPO.y0 + TOPO.alt - 4} width={BARRA} height="4" fill={BARRA_COR} />
          </g>
        ))}
        {/* rótulo só no pico e no vale — nunca um número em cada barra */}
        <text x={pico.x} y={yPed(pico.pedidos) - 6} textAnchor="middle" fontSize="18" fontWeight="800" fill={CINZA_TEXTO}>
          {pico.pedidos} pedidos
        </text>
        <text x={pontos[0].x} y={yPed(pontos[0].pedidos) - 6} textAnchor="middle" fontSize="18" fontWeight="700" fill={CINZA_TEXTO}>
          {pontos[0].pedidos}
        </text>

        {/* ── painel de baixo: minutos ── */}
        <text x={ESQ} y={BAIXO.y0 - 8} fontSize="17" fontWeight="800" fill={CINZA_TEXTO} letterSpacing=".4">PRAZO QUE O CLIENTE VÊ</text>
        <line x1={ESQ} x2={W - DIR} y1={BAIXO.y0 + BAIXO.alt} y2={BAIXO.y0 + BAIXO.alt} stroke="#E2E8F0" strokeWidth="1" />

        {/* prazo fixo: uma reta, tracejada, neutra */}
        <line x1={ESQ} x2={W - DIR} y1={yMin(FIXO)} y2={yMin(FIXO)} stroke={CINZA_FRACO} strokeWidth="3" strokeDasharray="7 6">
          <title>Prazo fixo: 30 minutos a noite inteira</title>
        </line>
        {/* Rótulo na PONTA ESQUERDA: às 18h a extensão está em 28 min, abaixo da
            reta dos 30, então o espaço acima dela está livre. Na direita a linha
            laranja (38 min às 23h) passava por cima do texto. */}
        <text x={ESQ + 4} y={yMin(FIXO) - 7} textAnchor="start" fontSize="17" fontWeight="700" fill={CINZA_FRACO}>fixo · 30 min</text>

        {/* extensão: degraus laranja seguindo a cozinha */}
        <path d={degraus} fill="none" stroke={LARANJA} strokeWidth="3.5" strokeLinejoin="round" />
        {pontos.map((p) => (
          <g key={p.hora}>
            <title>{`${p.hora}: extensão escreve ${p.min} min (${p.pedidos} pedidos, ${MOTOBOYS} motoboys)`}</title>
            <circle cx={p.x} cy={p.y} r="6" fill={LARANJA} stroke="#fff" strokeWidth="2.5" />
          </g>
        ))}
        <text x={pico.x} y={pico.y - 9} textAnchor="middle" fontSize="18" fontWeight="800" fill={CINZA_TEXTO}>
          {pico.min} min
        </text>
        <text x={xCentro(0)} y={yMin(28) + 16} textAnchor="middle" fontSize="17" fontWeight="700" fill={CINZA_TEXTO}>28 min</text>

        {/* onde o fixo atrasa: a área entre os 30 e o degrau, só quando o degrau passa dos 30 */}
        {pontos.map((p, i) =>
          p.min > FIXO ? (
            <rect
              key={"a" + p.hora}
              x={ESQ + SLOT * i}
              y={p.y}
              width={SLOT}
              height={yMin(FIXO) - p.y}
              fill="#FEE2E2"
              opacity=".7"
            />
          ) : null,
        )}
        <text x={xCentro(3)} y={yMin(FIXO) + 14} textAnchor="middle" fontSize="17" fontWeight="800" fill="#B91C1C">o fixo atrasa aqui</text>

        {/* eixo de horas, uma vez só */}
        {pontos.map((p) => (
          <text key={"h" + p.hora} x={p.x} y={BAIXO.y0 + BAIXO.alt + 18} textAnchor="middle" fontSize="18" fontWeight="700" fill={CINZA_TEXTO}>
            {p.hora}
          </text>
        ))}
      </svg>

      {/* legenda: duas séries embaixo, então ela existe — texto em cor de texto */}
      <figcaption style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "center", color: CINZA_TEXTO, fontSize: ".85rem", marginTop: 8 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
          <span style={{ width: 22, height: 0, borderTop: `2px dashed ${CINZA_FRACO}` }} /> prazo fixo
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
          <span style={{ width: 22, height: 3, background: LARANJA, borderRadius: 2 }} /> com a extensão
        </span>
        <span style={{ marginLeft: "auto", color: CINZA_FRACO }}>
          exemplo de uma noite · {MOTOBOYS} motoboys · a tabela é a mesma que a extensão usa
        </span>
      </figcaption>
    </figure>
  );
}
