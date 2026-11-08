/**
 * PIZZA MEIO A MEIO: quanto de cada sabor entra na baixa (lib/stock.ts) e no
 * CMV pela ficha (lib/financeiro/custo-pela-ficha.ts). Puro, sem banco.
 * Testado em scripts/teste-metade-da-pizza.ts.
 *
 * A ficha técnica de um sabor é a da pizza INTEIRA (massa, molho, queijo,
 * recheio). Somar inteiro o sabor de cada metade dava, na NIK (16/10/2026),
 * duas massas e dois recheios numa pizza só. Cada sabor entra com a sua parte:
 *
 *   • grupo com regra MAIOR/MÉDIA (o sabor é fração da mesma pizza):
 *     quantidade ÷ total escolhido no grupo — a regra que a baixa já tinha;
 *   • escolha que já vem com a fração no nome ("1/2 Calabresa", iFood):
 *     a fração do nome;
 *   • grupo "Meio a meio? Escolha a outra metade" (regra SOMA, NIK): o sabor
 *     da metade e o primeiro sabor dividem a pizza. O primeiro sabor é a
 *     escolha do grupo "Escolha o sabor" do mesmo produto, ou — se o produto
 *     não tem esse grupo — a ficha do próprio produto (a pizza Calabresa com a
 *     outra metade Frango Especial: ½ Calabresa + ½ Frango Especial).
 *
 * Adicional e borda (outros grupos) seguem inteiros.
 */

export type GrupoDaPizza = {
  id: string;
  titulo?: string | null;
  regra?: string | null;
  /** Ids dos produtos que o grupo oferece. */
  produtos: string[];
};

export type EscolhaDaPizza = {
  /** Produto que a escolha entrega (já resolvido). */
  produtoId: string;
  qtd: number;
  /** Fração que veio no nome ("1/2 X" → 0,5). */
  fracao?: number | null;
  /** Grupo, quando o formato traz (site, totem). */
  grupoId?: string | null;
};

/** Grupo de sabores de pizza: cada escolha é uma fração da mesma pizza (preco-combo.ts). */
export function ehGrupoDeFracao(priceRule: unknown): boolean {
  const r = String(priceRule || "").trim().toUpperCase();
  return r === "MAIOR" || r === "MEDIA";
}

const semAcento = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** "Meio a meio? Escolha a outra metade", "2º sabor (opcional)". */
export function ehGrupoDeMetade(titulo: unknown): boolean {
  const t = semAcento(titulo);
  return /meio a meio|meia a meia|outra metade|2\s*[ºo°]?\s*sabor|segundo sabor/.test(t);
}

/** "Escolha o sabor" — o primeiro sabor quando a pizza é combo. */
function ehGrupoDeSabor(titulo: unknown): boolean {
  return !ehGrupoDeMetade(titulo) && /\bsabor/.test(semAcento(titulo));
}

/**
 * A fração escrita no começo do nome: "1/2 Calabresa" → { nome: "Calabresa",
 * fracao: 0,5 }. Sem fração (ou fração estranha), devolve o nome como veio e
 * fracao nula.
 */
export function fracaoDoNome(nome: string): { nome: string; fracao: number | null } {
  const m = String(nome ?? "").match(/^\s*(\d+)\s*\/\s*(\d+)\s+(.+)$/);
  if (!m) return { nome, fracao: null };
  const fracao = Number(m[1]) / Number(m[2]);
  if (!(fracao > 0 && fracao < 1)) return { nome, fracao: null };
  return { nome: m[3].trim(), fracao };
}

/**
 * O fator de cada escolha (multiplica a ficha do produto escolhido, por
 * unidade do item) e o da ficha do próprio produto do item.
 */
export function fatoresDasMetades(e: {
  grupos: GrupoDaPizza[];
  escolhas: EscolhaDaPizza[];
  temFichaPropria: boolean;
}): { fatores: number[]; fatorDaFicha: number } {
  const porId = new Map(e.grupos.map((g) => [g.id, g]));
  // O grupo da escolha: o informado; senão o primeiro que oferece o produto,
  // preferindo o de fração e os de sabor (o PDV e o iFood não dizem o grupo).
  const peso = (g: GrupoDaPizza) => (ehGrupoDeFracao(g.regra) ? 3 : ehGrupoDeMetade(g.titulo) ? 2 : ehGrupoDeSabor(g.titulo) ? 1 : 0);
  const grupoDe = (x: EscolhaDaPizza): GrupoDaPizza | null => {
    if (x.grupoId && porId.has(x.grupoId)) return porId.get(x.grupoId)!;
    const candidatos = e.grupos.filter((g) => g.produtos.includes(x.produtoId));
    return candidatos.sort((a, b) => peso(b) - peso(a))[0] ?? null;
  };
  const grupos = e.escolhas.map(grupoDe);
  const fatores = e.escolhas.map((x) => x.qtd);
  let fatorDaFicha = 1;

  // 1. A fração do nome manda.
  e.escolhas.forEach((x, i) => { if (x.fracao) fatores[i] = x.qtd * x.fracao; });

  // 2. MAIOR/MÉDIA: quantidade ÷ total do grupo.
  const totalDoGrupo = new Map<string, number>();
  e.escolhas.forEach((x, i) => {
    const g = grupos[i];
    if (!x.fracao && g && ehGrupoDeFracao(g.regra)) totalDoGrupo.set(g.id, (totalDoGrupo.get(g.id) || 0) + x.qtd);
  });
  e.escolhas.forEach((x, i) => {
    const g = grupos[i];
    const total = g ? totalDoGrupo.get(g.id) : undefined;
    if (!x.fracao && total) fatores[i] = x.qtd / total;
  });

  // 3. O grupo "outra metade" (SOMA): os sabores dividem a pizza.
  const temGrupoDeMetade = e.grupos.some((g) => !ehGrupoDeFracao(g.regra) && ehGrupoDeMetade(g.titulo));
  if (temGrupoDeMetade) {
    const sabores = e.escolhas
      .map((x, i) => ({ x, i, g: grupos[i] }))
      .filter(({ x, g }) => x.produtoId && !x.fracao && g && !ehGrupoDeFracao(g.regra) && (ehGrupoDeMetade(g.titulo) || ehGrupoDeSabor(g.titulo)));
    const temGrupoDeSabor = e.grupos.some((g) => ehGrupoDeSabor(g.titulo));
    const fichaEhSabor = e.temFichaPropria && !temGrupoDeSabor;
    const partes = sabores.reduce((s, { x }) => s + x.qtd, 0) + (fichaEhSabor ? 1 : 0);
    // O PDV e o iFood não dizem o grupo, e o mesmo sabor está nos dois
    // ("Escolha o sabor" e "2º sabor"): basta o produto ter o grupo da metade.
    if (partes > 1) {
      for (const { x, i } of sabores) fatores[i] = x.qtd / partes;
      if (fichaEhSabor) fatorDaFicha = 1 / partes;
    }
  }
  return { fatores, fatorDaFicha };
}
