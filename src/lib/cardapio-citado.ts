/**
 * QUAIS PRODUTOS VÃO COM AS OPÇÕES COMPLETAS NO PROMPT DO ROBÔ.
 *
 * O cardápio que o robô relê a cada mensagem era a maior parte do custo: na
 * Divinos e na Map Grill, ~30 mil tokens por resposta, quase todos listas de
 * opções (adicionais, sabores, bebidas) de produtos que o cliente nem citou.
 * Agora todo produto continua no prompt com nome, preço e descrição, mas as
 * opções completas só vão para o produto que APARECE na conversa — pelo nome,
 * ou por uma opção dele ("calabresa" puxa todas as pizzas que têm calabresa;
 * "bacon", todo lanche que tem bacon como adicional).
 *
 * Na dúvida, inclui: produto a mais no prompt custa centavos; opção que falta
 * faz o robô inventar preço ou anotar o nome errado.
 *
 * Arquivo puro, sem imports: o teste o carrega sozinho
 * (scripts/teste-cardapio-citado.mjs).
 */

const semAcento = (t: unknown) =>
  String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** "X-Tudo!!" → ["x", "tudo"]; tira acento e pontuação. */
function palavras(texto: unknown): string[] {
  return semAcento(texto).replace(/[^a-z0-9]+/g, " ").split(" ").filter(Boolean);
}

/** "pizzas" e "pizza" são a mesma palavra para este fim. */
function singular(p: string): string {
  return p.length > 4 && p.endsWith("s") ? p.slice(0, -1) : p;
}

/** As palavras da conversa (mensagem + histórico), prontas para casar com o cardápio. */
export function palavrasDaConversa(textos: unknown[]): Set<string> {
  const conjunto = new Set<string>();
  for (const t of textos) {
    const ps = palavras(t);
    ps.forEach((p) => { conjunto.add(p); conjunto.add(singular(p)); });
    // "x tudo" escrito "xtudo", "coca cola" escrito "cocacola": as duplas grudadas também contam.
    for (let i = 0; i + 1 < ps.length; i++) conjunto.add(ps[i] + ps[i + 1]);
  }
  return conjunto;
}

/** Palavras que identificam um nome: 4 letras ou mais, e o nome inteiro grudado ("xtudo"). */
function chavesDoNome(nome: unknown): string[] {
  const ps = palavras(String(nome ?? "").split("|")[0]);
  const chaves = ps.filter((p) => p.length >= 4).map(singular);
  const grudado = ps.join("");
  if (grudado.length >= 4) chaves.push(grudado);
  return chaves;
}

type ProdutoDoCardapio = {
  name?: string | null;
  comboGroups?: { items?: { menuProduct?: { name?: string | null } | null }[] | null }[] | null;
};

/** O produto aparece na conversa — pelo nome ou por uma das opções dele? */
export function produtoCitado(produto: ProdutoDoCardapio, conversa: Set<string>): boolean {
  if (conversa.size === 0) return false;
  if (chavesDoNome(produto.name).some((c) => conversa.has(c))) return true;
  for (const g of produto.comboGroups || []) {
    for (const i of g?.items || []) {
      if (chavesDoNome(i?.menuProduct?.name).some((c) => conversa.has(c))) return true;
    }
  }
  return false;
}
