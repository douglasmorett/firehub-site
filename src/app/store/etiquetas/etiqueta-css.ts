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
    width: 4in; height: 6in;
    overflow: hidden;
    background: #fff;
    color: #000;
    font-family: Arial, Helvetica, sans-serif;
  }
  .print-area {
    display: block !important;
    width: 4in;
    height: 6in;
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
