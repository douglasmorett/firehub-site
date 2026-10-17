/**
 * LINHAS EQUILIBRADAS — quantos botões por linha numa fila que quebra linha.
 *
 * O flex-wrap enche a primeira linha até não caber mais e joga o resto para
 * baixo: com 10 atalhos na barra da tela de Pedidos, "Mudar tempo de entrega"
 * descia SOZINHO para uma linha só dele (Douglas, 16/10/2026: "podia estar
 * melhor distribuído"). Aqui se escolhe o MENOR número de linhas em que tudo
 * cabe e, com ele, quantos vão em cada uma — 10 em 2 linhas = 5/5, nunca 9/1.
 * Quem usa: components/customer/useLinhasEquilibradas.ts.
 *
 * Como o navegador obedece: todo botão ganha a mesma BASE (flex-basis) e
 * nunca fica menor que o próprio texto. Com a maior base em que cada grupo
 * ainda cabe, o próximo botão já não cabe — a linha quebra exatamente ali —
 * e o flex-grow estica o grupo até fechar a largura.
 */
export type Distribuicao = { porLinha: number; base: number };

/** A largura que um grupo ocupa com a base `b` (botão nunca menor que o texto). */
function ocupa(larguras: number[], b: number, vao: number): number {
  return larguras.reduce((s, w) => s + Math.max(w, b), 0) + Math.max(0, larguras.length - 1) * vao;
}

export function distribuirEmLinhas(larguras: number[], disponivel: number, vao: number): Distribuicao | null {
  const n = larguras.length;
  if (n === 0 || !(disponivel > 0)) return null;
  // Quantas linhas o flex puro usaria: repartir nunca pode gastar MAIS linhas
  // (um botão largo no começo pede grupos desiguais — aí fica o flex puro).
  let linhasDoFlex = 1;
  let usado = -vao;
  for (const w of larguras) {
    if (usado + vao + w > disponivel && usado > 0) { linhasDoFlex++; usado = w; }
    else usado += vao + w;
  }
  let anterior = 0;
  for (let linhas = 1; linhas <= linhasDoFlex; linhas++) {
    const porLinha = Math.ceil(n / linhas);
    if (porLinha === anterior) continue;
    anterior = porLinha;
    const grupos: number[][] = [];
    for (let i = 0; i < n; i += porLinha) grupos.push(larguras.slice(i, i + porLinha));
    const cabe = (b: number) => grupos.every((g) => ocupa(g, b, vao) <= disponivel);
    if (!cabe(0)) continue;
    // A maior base em que todos os grupos cabem (busca binária).
    let lo = 0;
    let hi = (disponivel - (porLinha - 1) * vao) / porLinha;
    if (cabe(hi)) lo = hi;
    else for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (cabe(m)) lo = m; else hi = m; }
    const base = Math.max(0, lo - 0.5); // meio pixel de folga para o arredondamento
    // Confere a quebra: o grupo + o próximo botão não pode caber na linha.
    const quebraCerto = grupos.every((g, k) => {
      if (k === grupos.length - 1) return true;
      return ocupa([...g, grupos[k + 1][0]], base, vao) > disponivel;
    });
    if (porLinha === n || quebraCerto) return { porLinha, base };
  }
  return null;
}
