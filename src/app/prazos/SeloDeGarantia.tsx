/**
 * O selo de garantia.
 *
 * Até 06/11/2026 era a arte que o dono escolheu em setembro (medalha preta
 * e dourada, "GARANTIA · 30 DIAS · TRINTA DIAS", num .webp que saiu do
 * repositório junto com esta troca). Quando ele baixou a garantia para 7
 * dias, aquela imagem passou a mentir — e o 30 estava desenhado dentro dela.
 * A medalha agora é SVG, nas mesmas cores, com o número como texto: trocar o
 * prazo de novo é trocar `DIAS` aqui, na oferta da Cakto e nos textos da
 * página, juntos.
 *
 * Dois tamanhos, o mesmo desenho: SVG não baixa arquivo nenhum, então não
 * pesa no tempo de abertura.
 */

const DIAS = 7;
const DESCRICAO = `Selo de garantia de ${DIAS} dias — ou seu dinheiro de volta`;

function Medalha({ tamanho, sombra }: { tamanho: number; sombra: string }) {
  return (
    <svg
      width={tamanho}
      height={tamanho}
      viewBox="0 0 200 200"
      role="img"
      aria-label={DESCRICAO}
      style={{ flexShrink: 0, display: "block", filter: sombra }}
    >
      <defs>
        <linearGradient id="selo-ouro" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#F9E08B" />
          <stop offset=".5" stopColor="#D4A23A" />
          <stop offset="1" stopColor="#F3D27A" />
        </linearGradient>
        <path id="selo-arco-cima" d="M 34 100 A 66 66 0 0 1 166 100" />
        <path id="selo-arco-baixo" d="M 30 100 A 70 70 0 0 0 170 100" />
      </defs>
      <circle cx="100" cy="100" r="96" fill="url(#selo-ouro)" />
      <circle cx="100" cy="100" r="86" fill="#111827" />
      <circle cx="100" cy="100" r="80" fill="none" stroke="url(#selo-ouro)" strokeWidth="2" strokeDasharray="3 4" />
      <text fontSize="17" fontWeight="900" fill="url(#selo-ouro)" letterSpacing="3" fontFamily="Arial, sans-serif">
        <textPath href="#selo-arco-cima" startOffset="50%" textAnchor="middle">GARANTIA</textPath>
      </text>
      <text x="100" y="128" textAnchor="middle" fontSize="78" fontWeight="900" fill="url(#selo-ouro)" fontFamily="Arial, sans-serif">
        {DIAS}
      </text>
      <text x="100" y="150" textAnchor="middle" fontSize="16" fontWeight="900" fill="#F9E08B" letterSpacing="2" fontFamily="Arial, sans-serif">
        DIAS
      </text>
      <text fontSize="11" fontWeight="800" fill="#F3D27A" letterSpacing="1.5" fontFamily="Arial, sans-serif">
        <textPath href="#selo-arco-baixo" startOffset="50%" textAnchor="middle">DINHEIRO DE VOLTA</textPath>
      </text>
    </svg>
  );
}

export function SeloDeGarantia({ tamanho = 168 }: { tamanho?: number }) {
  return <Medalha tamanho={tamanho} sombra="drop-shadow(0 12px 26px rgba(0,0,0,.4))" />;
}

/** A versão miúda, para andar junto do botão de assinar. */
export function SeloPequeno({ tamanho = 76 }: { tamanho?: number }) {
  return <Medalha tamanho={tamanho} sombra="drop-shadow(0 6px 14px rgba(0,0,0,.35))" />;
}
