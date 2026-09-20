/**
 * O selo de garantia.
 *
 * É a arte que o dono escolheu (medalha preta e dourada, "GARANTIA · 30
 * DIAS · TRINTA DIAS"), preparada em 19/09/2026 a partir do arquivo dele:
 * o original era um JPEG com o xadrez de transparência QUEIMADO na imagem —
 * publicado assim, o quadriculado apareceria em volta do selo no site. O
 * disco foi recortado com máscara circular (raio 238 do centro, medido até
 * o xadrez sumir sem comer a borda dourada) e salvo como WebP com alfa de
 * verdade em `public/prazos/selo-garantia.webp`, 400×400, 40 KB.
 *
 * Dois tamanhos, uma imagem só: o navegador escolhe a escala, e o arquivo
 * é baixado uma vez para os dois usos. `loading="lazy"` porque o selo mora
 * no meio da página, longe da primeira dobra — a página tem meta de abrir
 * em menos de 2 s no 4G.
 *
 * Se um dia o prazo deixar de ser 30 dias, esta imagem passa a mentir:
 * trocar aqui, na oferta da Cakto e nos textos da página, juntos.
 */

const ARQUIVO = "/prazos/selo-garantia.webp";
const DESCRICAO = "Selo de garantia de 30 dias — ou seu dinheiro de volta";

export function SeloDeGarantia({ tamanho = 168 }: { tamanho?: number }) {
  return (
    <img
      src={ARQUIVO}
      width={tamanho}
      height={tamanho}
      alt={DESCRICAO}
      loading="lazy"
      decoding="async"
      style={{
        width: tamanho, height: tamanho, flexShrink: 0, display: "block",
        filter: "drop-shadow(0 12px 26px rgba(0,0,0,.4))",
      }}
    />
  );
}

/** A versão miúda, para andar junto do botão de assinar. */
export function SeloPequeno({ tamanho = 76 }: { tamanho?: number }) {
  return (
    <img
      src={ARQUIVO}
      width={tamanho}
      height={tamanho}
      alt={DESCRICAO}
      loading="lazy"
      decoding="async"
      style={{
        width: tamanho, height: tamanho, flexShrink: 0, display: "block",
        filter: "drop-shadow(0 6px 14px rgba(0,0,0,.35))",
      }}
    />
  );
}
