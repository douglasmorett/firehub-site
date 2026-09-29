/**
 * AS LISTAS DE OPÇÕES QUE SE REPETEM, ESCRITAS UMA VEZ SÓ NO PROMPT DO ROBÔ.
 *
 * O robô relê o cardápio inteiro a cada mensagem, e metade do texto era a
 * mesma lista copiada produto a produto. Medido em 29/09/2026: na Divinos o
 * "Turbine seu Burger" (todos os adicionais, com preço) aparecia 27 vezes e
 * as três listas do açaí 6 vezes cada — o bloco de combos era 39 mil dos 81
 * mil caracteres do prompt; na Ragnar, 55 mil de 97 mil. É a parte do texto
 * que o Google cobra a preço cheio toda vez que o cache expira.
 *
 * Agora a linha do produto aponta para a lista ("LISTA L1") e a lista vem uma
 * vez, antes dos combos. Só se junta o que é IGUAL caractere a caractere —
 * nome, preço e aviso de pausa —, então nenhum preço muda de produto para
 * produto: opção com preço absoluto (tamanho: base + acréscimo) só coincide
 * quando a base também coincide.
 *
 * Uso: `marcar(texto)` no lugar do texto das opções, ao montar cada linha;
 * `resolver([blocos])` no fim, com todas as linhas que vão para o prompt.
 * Lista que aparece uma vez só, ou que juntada não encurta o texto (curta e
 * repetida duas vezes), volta a ser escrita no lugar.
 */

const MARCA = /\u0000OP(\d+)\u0000/g;

const CABECALHO =
  "=== LISTAS DE OPÇÕES (vários produtos usam a mesma; o produto diz qual — as opções e os preços valem igual em cada um) ===";
const referencia = (rotulo: string) => `mesmas opções e preços da LISTA ${rotulo}`;

/**
 * Quanto se economiza juntando: as N cópias saem, entram N referências e a
 * definição. Lista curta que aparece duas vezes sai MAIS cara juntada — por
 * isso a conta, e não um mínimo de repetições.
 */
function economia(texto: string, usos: number): number {
  const rotulo = "L99";
  return usos * texto.length - (usos * referencia(rotulo).length + `LISTA ${rotulo}: `.length + texto.length + 1);
}

export function registroDeOpcoes() {
  const textos: string[] = [];
  const ids = new Map<string, number>();

  return {
    /** O texto das opções vira uma marca, resolvida depois em `resolver`. */
    marcar(texto: string): string {
      let id = ids.get(texto);
      if (id === undefined) {
        id = textos.length;
        textos.push(texto);
        ids.set(texto, id);
      }
      return `\u0000OP${id}\u0000`;
    },

    /**
     * Conta as marcas nas linhas que de fato vão para o prompt (a linha que
     * ficou de fora não conta) e troca cada uma pela lista ou pela referência.
     */
    resolver(blocos: string[][]): { blocos: string[][]; secao: string } {
      const usos = new Map<number, number>();
      for (const bloco of blocos) {
        for (const linha of bloco) {
          for (const m of linha.matchAll(MARCA)) usos.set(Number(m[1]), (usos.get(Number(m[1])) || 0) + 1);
        }
      }
      // Na ordem em que aparecem, só as que economizam.
      const juntar: number[] = [];
      for (const bloco of blocos) {
        for (const linha of bloco) {
          for (const m of linha.matchAll(MARCA)) {
            const id = Number(m[1]);
            if (!juntar.includes(id) && economia(textos[id] || "", usos.get(id) || 0) > 0) juntar.push(id);
          }
        }
      }
      // A seção tem cabeçalho: se o que se economiza não paga nem ele, nada muda.
      const total = juntar.reduce((s, id) => s + economia(textos[id] || "", usos.get(id) || 0), 0);
      const rotulo = new Map<number, string>(total > CABECALHO.length ? juntar.map((id, i) => [id, `L${i + 1}`]) : []);
      const trocar = (linha: string) =>
        linha.replace(MARCA, (_, n) => {
          const id = Number(n);
          const r = rotulo.get(id);
          return r ? referencia(r) : (textos[id] ?? "");
        });
      const secao = rotulo.size === 0
        ? ""
        : [CABECALHO, ...[...rotulo].map(([id, r]) => `LISTA ${r}: ${textos[id]}`)].join("\n");
      return { blocos: blocos.map((b) => b.map(trocar)), secao };
    },
  };
}
