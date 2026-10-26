/**
 * O CSS da etiqueta, em UM lugar só.
 *
 * Vivia dentro do `doc.write` do handlePrint, o que era suportável enquanto a
 * etiqueta só existia dentro do iframe. Com a prévia na tela, duas cópias do
 * mesmo CSS viram duas etiquetas diferentes: a que o lojista vê e a que sai no
 * papel. Divergiram uma vez que seja, a prévia deixa de servir para o que ela
 * existe.
 *
 * O reset completo (`* , *::before, *::after`) não estava aqui: o iframe herdava
 * o reset do globals.css por acidente de nada nunca ter dependido disso. Escrito
 * explicitamente, a etiqueta passa a ser a mesma nos dois lados.
 */
export type TamanhoDaEtiqueta = "4x6" | "100x60" | "60x40" | "50x30" | "bobina80" | "bobina58";

export type MedidasDaEtiqueta = {
  nome: string;
  /** Largura e altura do PAPEL, em CSS — é o que vai no `@page`. */
  largura: string;
  altura: string;
  larguraMm: number;
  alturaMm: number;
  /** A completa é a de 4x6, com tabela nutricional; as outras são a compacta. */
  completa: boolean;
  /** Margem de dentro. Na bobina, a lateral é o que a cabeça não alcança (80 → 72 mm, 58 → 48 mm). */
  margemMm: [number, number];
  /** 0 = o QR não cabe legível neste tamanho. */
  qrMm: number;
  nomeMm: number;
  textoMm: number;
  cabeLoja: boolean;
};

/**
 * Os tamanhos de papel. 4x6 pol. é o de sempre; 100x60, 60x40 e 50x30 mm são
 * os rolos de etiqueta das térmicas de mercado (Elgin, Zebra, Argox); a bobina
 * adesiva de 80/58 mm sai na impressora da COMANDA, pelo mesmo diálogo de
 * impressão do navegador — o caminho que esta tela já usa, sem driver novo.
 */
export const TAMANHOS: Record<TamanhoDaEtiqueta, MedidasDaEtiqueta> = {
  "4x6": { nome: "4 × 6 pol. (101,6 × 152,4 mm)", largura: "4in", altura: "6in", larguraMm: 101.6, alturaMm: 152.4, completa: true, margemMm: [3.048, 3.048], qrMm: 20, nomeMm: 5, textoMm: 3.5, cabeLoja: true },
  "100x60": { nome: "100 × 60 mm", largura: "100mm", altura: "60mm", larguraMm: 100, alturaMm: 60, completa: false, margemMm: [3, 3], qrMm: 22, nomeMm: 5, textoMm: 3.3, cabeLoja: true },
  "60x40": { nome: "60 × 40 mm", largura: "60mm", altura: "40mm", larguraMm: 60, alturaMm: 40, completa: false, margemMm: [2, 2], qrMm: 15, nomeMm: 3.4, textoMm: 2.4, cabeLoja: false },
  "50x30": { nome: "50 × 30 mm", largura: "50mm", altura: "30mm", larguraMm: 50, alturaMm: 30, completa: false, margemMm: [1.5, 1.5], qrMm: 0, nomeMm: 2.8, textoMm: 2, cabeLoja: false },
  bobina80: { nome: "Bobina 80 mm (impressora da comanda)", largura: "80mm", altura: "60mm", larguraMm: 80, alturaMm: 60, completa: false, margemMm: [2, 4], qrMm: 18, nomeMm: 4.4, textoMm: 3, cabeLoja: true },
  bobina58: { nome: "Bobina 58 mm (impressora da comanda)", largura: "58mm", altura: "40mm", larguraMm: 58, alturaMm: 40, completa: false, margemMm: [2, 5], qrMm: 0, nomeMm: 3.2, textoMm: 2.3, cabeLoja: false },
};

export function lerTamanho(v: unknown): TamanhoDaEtiqueta {
  return typeof v === "string" && v in TAMANHOS ? (v as TamanhoDaEtiqueta) : "4x6";
}

/** Milímetro em pixel CSS (96 por polegada) — o tamanho da folha na prévia. */
export const pxDoMm = (mm: number) => (mm * 96) / 25.4;

export function cssDaEtiqueta(tamanho: TamanhoDaEtiqueta = "4x6"): string {
  const t = TAMANHOS[tamanho];
  return `
  @page { size: ${t.largura} ${t.altura}; margin: 0; }
  *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0;
    /* min-height e overflow visible, não altura FIXA com overflow hidden.
       Com altura fixa, a partir da segunda etiqueta o conteúdo ficava
       fora da caixa do body e só chegava ao papel porque o Chrome fragmenta
       sozinho — o melhor caso era funcionar, e o pior era a segunda etiqueta em
       diante sair cortada, ou nascer uma folha em branco entre cada uma.
       Imprimir 40 etiquetas com uma folha em branco no meio é meio rolo de
       ribbon no lixo. */
    width: ${t.largura}; min-height: ${t.altura};
    overflow: visible;
    background: #fff;
    color: #000;
    font-family: Arial, Helvetica, sans-serif;
  }
  .print-area {
    display: block !important;
    width: ${t.largura};
    /* Sem altura fixa: a área é a PILHA de etiquetas, não uma folha. */
  }
  .label-page {
    display: flex;
    flex-direction: column;
    width: ${t.largura};
    height: ${t.altura};
    padding: ${t.margemMm[0]}mm ${t.margemMm[1]}mm;
    background: #fff;
    color: #000;
    font-family: Arial, Helvetica, sans-serif;
    box-sizing: border-box;
    /* A quebra EXPLÍCITA, que não existia em lugar nenhum do projeto. As duas
       propriedades juntas de propósito: page-break-after é o que as versões
       mais velhas do motor de impressão entendem, e é impressora térmica que
       está do outro lado. */
    break-after: page;
    page-break-after: always;
  }
  /* A última não força quebra: senão sai uma etiqueta em branco no fim de toda
     impressão — o defeito mais caro deste arquivo, porque só aparece no papel. */
  .label-page:last-child {
    break-after: auto;
    page-break-after: auto;
  }
  .label-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .label-footer {
    margin-top: auto;
    flex-shrink: 0;
  }
`;
}

export const CSS_DA_ETIQUETA = cssDaEtiqueta("4x6");

/**
 * O mesmo CSS, preso ao palco da prévia.
 *
 * `@page` sai fora (não existe página aqui) e o `html, body` de 4x6in também:
 * na tela ele encolheria o painel inteiro para o tamanho de uma etiqueta.
 */
export const CSS_DA_PREVIA = `
  .palco-da-etiqueta *, .palco-da-etiqueta *::before, .palco-da-etiqueta *::after {
    margin: 0; padding: 0; box-sizing: border-box;
  }
  .palco-da-etiqueta .label-page {
    display: flex;
    flex-direction: column;
    width: 4in;
    height: 6in;
    padding: 0.12in;
    background: #fff;
    color: #000;
    font-family: Arial, Helvetica, sans-serif;
    box-sizing: border-box;
  }
  .palco-da-etiqueta .label-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .palco-da-etiqueta .label-footer {
    margin-top: auto;
    flex-shrink: 0;
  }
`;
