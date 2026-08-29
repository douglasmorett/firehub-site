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
export const CSS_DA_ETIQUETA = `
  @page { size: 4in 6in; margin: 0; }
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
    width: 4in; min-height: 6in;
    overflow: visible;
    background: #fff;
    color: #000;
    font-family: Arial, Helvetica, sans-serif;
  }
  .print-area {
    display: block !important;
    width: 4in;
    /* Sem altura fixa: a área é a PILHA de etiquetas, não uma folha. */
  }
  .label-page {
    display: flex;
    flex-direction: column;
    width: 4in;
    height: 6in;
    padding: 0.12in;
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
