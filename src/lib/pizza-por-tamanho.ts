/**
 * PIZZA POR TAMANHO — o que o passo a passo "Cadastrar pizza" grava.
 *
 * Pedido do Douglas (02/10/2026): o lojista não conseguia cadastrar pizza meio
 * a meio sozinho. "Novo Item" agora pergunta se é pizza ou outro item; a pizza
 * segue perguntas próprias (tamanhos, quantos sabores, como cobra o meio a
 * meio, sabores e preços, borda) e o sistema monta o resto. "Qualquer criança
 * de 10 anos tem que conseguir lançar isso."
 *
 * ── O modelo gravado ────────────────────────────────────────────────────────
 * É o do iFood e o que já roda na Vinhedos, na Pizzaria do Costa e na do Digão:
 *
 *   - cada TAMANHO é um produto do cardápio ("Pizza Grande"), de preço 0;
 *   - dentro dele, a pergunta "Escolha até 2 sabores" (mínimo 1) lista os
 *     sabores com o preço CHEIO da pizza inteira naquele tamanho, e a regra da
 *     pergunta (MAIOR ou MEDIA, lib/preco-combo.ts) faz a conta do meio a meio
 *     — ninguém cadastra sabor "pela metade";
 *   - cada SABOR é UM produto só (`apenasEmCombo`, na categoria da pizza, que é
 *     a impressora dela), usado em todos os tamanhos: pausar a Calabresa tira a
 *     Calabresa de todos os tamanhos de uma vez;
 *   - a borda recheada, se houver, é outra pergunta (0 ou 1) que soma.
 *
 * Arquivo puro, sem banco: a tela e a rota (api/admin/cardapio/pizzas) usam as
 * mesmas regras, e o teste roda sem servidor.
 */

export type RegraDaPizza = "MAIOR" | "MEDIA";

export type TamanhoDaPizza = {
  /** Produto do tamanho, quando a montagem já existe (edição). */
  id?: string | null;
  nome: string;
  fatias: number | null;
  /** Até quantos sabores o cliente escolhe neste tamanho. */
  sabores: number;
};

export type SaborDaPizza = {
  id?: string | null;
  nome: string;
  descricao: string;
  /** Preço da pizza INTEIRA deste sabor em cada tamanho (mesma ordem). Nulo = não tem neste tamanho. */
  precos: (number | null)[];
};

export type BordaDaPizza = {
  id?: string | null;
  nome: string;
  /** Quanto a borda soma em cada tamanho. Nulo = não tem neste tamanho; 0 = grátis. */
  precos: (number | null)[];
};

export type MontagemDaPizza = {
  categoria: string;
  regra: RegraDaPizza;
  tamanhos: TamanhoDaPizza[];
  sabores: SaborDaPizza[];
  bordas: BordaDaPizza[];
};

/** Os tamanhos que o passo a passo oferece, do menor para o maior. */
export const TAMANHOS_SUGERIDOS: { nome: string; fatias: number; sabores: number }[] = [
  { nome: "Broto", fatias: 4, sabores: 1 },
  { nome: "Pequena", fatias: 6, sabores: 1 },
  { nome: "Média", fatias: 6, sabores: 2 },
  { nome: "Grande", fatias: 8, sabores: 2 },
  { nome: "Família", fatias: 12, sabores: 3 },
  { nome: "Gigante", fatias: 16, sabores: 4 },
];

export const MAX_SABORES = 4;
export const TITULO_DA_BORDA = "Borda recheada?";

export function tituloDosSabores(n: number): string {
  return n <= 1 ? "Escolha o sabor" : `Escolha até ${n} sabores`;
}

/** A pergunta de sabores que este passo a passo grava (e que a edição relê). */
export function ehPerguntaDeSabores(grupo: { title?: string | null; priceRule?: string | null } | null | undefined): boolean {
  const regra = String(grupo?.priceRule || "").toUpperCase();
  return (regra === "MAIOR" || regra === "MEDIA") && /^escolha (o sabor|até \d+ sabores)$/i.test(String(grupo?.title || "").trim());
}

export function ehPerguntaDeBorda(grupo: { title?: string | null } | null | undefined): boolean {
  return String(grupo?.title || "").trim().toLowerCase() === TITULO_DA_BORDA.toLowerCase();
}

/** "Grande" → "Pizza Grande"; quem já escreveu "Pizza Broto" não ganha "Pizza Pizza Broto". */
export function nomeDoTamanho(tamanho: string): string {
  const t = tamanho.trim();
  return /\bpizza\b/i.test(t) ? t : `Pizza ${t}`;
}

/** O nome que o lojista digitou, sem o "Pizza " que o cadastro acrescentou. */
export function tamanhoDoNome(nomeDoProduto: string): string {
  return nomeDoProduto.trim().replace(/^pizza\s+/i, "") || nomeDoProduto.trim();
}

/** "8 fatias · até 2 sabores" — a linha que o cliente lê embaixo do nome. */
export function descricaoDoTamanho(t: Pick<TamanhoDaPizza, "fatias" | "sabores">): string {
  const partes = [];
  if (t.fatias && t.fatias > 0) partes.push(`${t.fatias} fatias`);
  partes.push(t.sabores <= 1 ? "1 sabor" : `até ${t.sabores} sabores`);
  return partes.join(" · ");
}

/**
 * O valor digitado em reais. "45", "45,90", "R$ 45,90", "1.200,00". Vazio ou
 * lixo = null. Nunca `type="number"`: o Chrome em português lê "1.200,00" como
 * 1,2 sem avisar (Contas a Pagar, 02/10/2026).
 */
export function lerPreco(texto: unknown): number | null {
  if (typeof texto === "number") return Number.isFinite(texto) ? Math.round(texto * 100) / 100 : null;
  let s = String(texto ?? "").replace(/[R$\s]/gi, "");
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

export function reais(n: number): string {
  return `R$ ${n.toFixed(2).replace(".", ",")}`;
}

/** O preço da meio a meio, pela regra. É a mesma conta de lib/preco-combo.ts (totalDoGrupo). */
export function precoDoMeio(regra: RegraDaPizza, precos: number[]): number {
  if (precos.length === 0) return 0;
  if (regra === "MAIOR") return Math.max(...precos);
  return Math.round((precos.reduce((s, p) => s + p, 0) / precos.length) * 100) / 100;
}

const chave = (s: string) => s.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ");

/**
 * O que impede salvar, em frases para o lojista. Vazio = pode salvar.
 * A tela mostra no passo certo; a rota confere de novo antes de gravar.
 */
export function errosDaMontagem(m: MontagemDaPizza): string[] {
  const erros: string[] = [];
  if (!String(m?.categoria || "").trim()) erros.push("Escolha a categoria do cardápio onde as pizzas vão ficar.");
  if (m?.regra !== "MAIOR" && m?.regra !== "MEDIA") erros.push("Escolha como a pizza de mais de um sabor é cobrada.");

  const tamanhos = Array.isArray(m?.tamanhos) ? m.tamanhos : [];
  if (tamanhos.length === 0) erros.push("Escolha pelo menos um tamanho de pizza.");
  const nomesDeTamanho = new Set<string>();
  for (const t of tamanhos) {
    const nome = String(t?.nome || "").trim();
    if (!nome) { erros.push("Um dos tamanhos está sem nome."); continue; }
    if (nomesDeTamanho.has(chave(nome))) erros.push(`O tamanho "${nome}" aparece duas vezes.`);
    nomesDeTamanho.add(chave(nome));
    if (!Number.isInteger(t.sabores) || t.sabores < 1 || t.sabores > MAX_SABORES) erros.push(`Em "${nome}", escolha de 1 a ${MAX_SABORES} sabores.`);
    if (t.fatias !== null && t.fatias !== undefined && (!Number.isInteger(t.fatias) || t.fatias < 1 || t.fatias > 64)) erros.push(`Em "${nome}", o número de fatias não está certo.`);
  }

  const sabores = (Array.isArray(m?.sabores) ? m.sabores : []).filter((s) => String(s?.nome || "").trim());
  if (sabores.length === 0) erros.push("Cadastre pelo menos um sabor, com o nome e o preço.");
  const nomesDeSabor = new Set<string>();
  for (const s of sabores) {
    const nome = s.nome.trim();
    if (nomesDeSabor.has(chave(nome))) erros.push(`O sabor "${nome}" aparece duas vezes.`);
    nomesDeSabor.add(chave(nome));
    const precos = Array.isArray(s.precos) ? s.precos : [];
    if (!precos.some((p) => p !== null && p !== undefined)) erros.push(`O sabor "${nome}" está sem preço. Digite o preço em pelo menos um tamanho.`);
    if (precos.some((p) => p !== null && p !== undefined && (!(p > 0) || p > 9999))) erros.push(`Confira os preços do sabor "${nome}": o preço da pizza tem que ser maior que zero.`);
  }
  tamanhos.forEach((t, i) => {
    if (String(t?.nome || "").trim() && sabores.length > 0 && !sabores.some((s) => s.precos?.[i] !== null && s.precos?.[i] !== undefined)) {
      erros.push(`Nenhum sabor tem preço na pizza ${String(t.nome).trim()}. Digite o preço de pelo menos um sabor nesse tamanho, ou tire o tamanho.`);
    }
  });

  const nomesDeBorda = new Set<string>();
  for (const b of (Array.isArray(m?.bordas) ? m.bordas : []).filter((b) => String(b?.nome || "").trim())) {
    const nome = b.nome.trim();
    if (nomesDeBorda.has(chave(nome))) erros.push(`A borda "${nome}" aparece duas vezes.`);
    nomesDeBorda.add(chave(nome));
    const precos = Array.isArray(b.precos) ? b.precos : [];
    if (!precos.some((p) => p !== null && p !== undefined)) erros.push(`A borda "${nome}" está sem preço. Digite quanto ela soma (0 se for grátis).`);
    if (precos.some((p) => p !== null && p !== undefined && (p < 0 || p > 9999))) erros.push(`Confira os preços da borda "${nome}".`);
  }
  return [...new Set(erros)];
}

/** Só o que tem nome: linha em branco que sobrou na tabela não vira produto. */
export function limparMontagem(m: MontagemDaPizza): MontagemDaPizza {
  const n = m.tamanhos.length;
  const ajustar = (precos: (number | null)[]) => Array.from({ length: n }, (_, i) => {
    const p = precos?.[i];
    return p === null || p === undefined || !Number.isFinite(Number(p)) ? null : Math.round(Number(p) * 100) / 100;
  });
  return {
    categoria: m.categoria.trim(),
    regra: m.regra,
    tamanhos: m.tamanhos.map((t) => ({ id: t.id || null, nome: t.nome.trim(), fatias: t.fatias || null, sabores: t.sabores })),
    sabores: m.sabores
      .filter((s) => s.nome.trim())
      .map((s) => ({ id: s.id || null, nome: s.nome.trim(), descricao: (s.descricao || "").trim(), precos: ajustar(s.precos) })),
    bordas: m.bordas
      .filter((b) => b.nome.trim())
      .map((b) => ({ id: b.id || null, nome: b.nome.trim(), precos: ajustar(b.precos) })),
  };
}

export type GrupoDaPizza = {
  title: string;
  minQty: number;
  maxQty: number;
  priceRule: RegraDaPizza | null;
  items: { id: string; additionalPrice: number }[];
};

/**
 * As perguntas de um tamanho, com os ids já gravados de cada sabor e borda
 * (mesma ordem da montagem). Sabor sem preço no tamanho não entra nele.
 */
export function perguntasDoTamanho(m: MontagemDaPizza, i: number, idsDosSabores: string[], idsDasBordas: string[]): GrupoDaPizza[] {
  const t = m.tamanhos[i];
  const grupos: GrupoDaPizza[] = [{
    title: tituloDosSabores(t.sabores),
    minQty: 1,
    maxQty: t.sabores,
    // Gravada também no tamanho de 1 sabor (onde não muda a conta): é a marca
    // que a edição usa para reconhecer a pizza montada por aqui.
    priceRule: m.regra,
    items: m.sabores.flatMap((s, k) => {
      const p = s.precos[i];
      return p === null || p === undefined ? [] : [{ id: idsDosSabores[k], additionalPrice: p }];
    }),
  }];
  const bordas = m.bordas.flatMap((b, k) => {
    const p = b.precos[i];
    return p === null || p === undefined ? [] : [{ id: idsDasBordas[k], additionalPrice: p }];
  });
  if (bordas.length > 0) grupos.push({ title: TITULO_DA_BORDA, minQty: 0, maxQty: 1, priceRule: null, items: bordas });
  return grupos;
}

/** O "a partir de" do tamanho: o sabor mais barato. */
export function precoInicialDoTamanho(m: MontagemDaPizza, i: number): number | null {
  const precos = m.sabores.map((s) => s.precos[i]).filter((p): p is number => p !== null && p !== undefined);
  return precos.length ? Math.min(...precos) : null;
}

/**
 * Junta a ordem das opções de cada tamanho numa só. Cada tamanho grava os
 * sabores na ordem da montagem, sem os que ele não tem — então cada lista é um
 * pedaço da ordem original. Começando pela lista mais longa, quem falta entra
 * logo depois do vizinho de cima dele.
 */
function juntarOrdens(listas: string[][]): string[] {
  const ordem: string[] = [];
  for (const lista of [...listas].sort((a, b) => b.length - a.length)) {
    let depoisDe = -1;
    for (const id of lista) {
      const k = ordem.indexOf(id);
      if (k >= 0) { depoisDe = k; continue; }
      ordem.splice(depoisDe + 1, 0, id);
      depoisDe++;
    }
  }
  return ordem;
}

type ProdutoLido = {
  id: string;
  name?: string | null;
  description?: string | null;
  category?: string | null;
  isCombo?: boolean | null;
  apenasEmCombo?: boolean | null;
  active?: boolean | null;
  sortOrder?: number | null;
  comboGroups?: {
    title?: string | null;
    maxQty?: number | null;
    priceRule?: string | null;
    sortOrder?: number | null;
    items?: { additionalPrice?: number | null; sortOrder?: number | null; menuProductId?: string | null; menuProduct?: { id?: string | null } | null }[] | null;
  }[] | null;
};

/**
 * As pizzas que já existem neste modelo, por categoria — para "Adicionar
 * sabor ou mudar preços" sem refazer tudo. Reconhece o produto de tamanho pela
 * pergunta de sabores que este passo a passo grava (título + regra) com todos
 * os sabores sendo opções (`apenasEmCombo`). Outras perguntas que o lojista
 * tenha posto no tamanho ficam fora da montagem e a rota as preserva.
 */
export function pizzasJaMontadas(produtos: ProdutoLido[]): (MontagemDaPizza & { ativos: boolean[] })[] {
  const porId = new Map(produtos.map((p) => [String(p.id), p]));
  const idDoItem = (it: { menuProductId?: string | null; menuProduct?: { id?: string | null } | null }) => String(it?.menuProduct?.id || it?.menuProductId || "");
  const porCategoria = new Map<string, ProdutoLido[]>();
  for (const p of produtos) {
    if (p.isCombo || p.apenasEmCombo) continue;
    const sabores = (p.comboGroups || []).find(ehPerguntaDeSabores);
    if (!sabores || !(sabores.items || []).length) continue;
    if (!(sabores.items || []).every((it) => porId.get(idDoItem(it))?.apenasEmCombo === true)) continue;
    const cat = String(p.category || "").trim();
    porCategoria.set(cat, [...(porCategoria.get(cat) || []), p]);
  }

  const saida: (MontagemDaPizza & { ativos: boolean[] })[] = [];
  for (const [categoria, tamanhosLidos] of porCategoria) {
    const ordenados = [...tamanhosLidos].sort((a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0) || String(a.name).localeCompare(String(b.name), "pt-BR"));
    let regra: RegraDaPizza | null = null;
    let regraDeMeio: RegraDaPizza | null = null;
    const n = ordenados.length;
    // Preço de cada opção em cada tamanho, e a ordem dela dentro de cada tamanho.
    const precoDoSabor = new Map<string, (number | null)[]>();
    const precoDaBorda = new Map<string, (number | null)[]>();
    const listasDeSabores: string[][] = [];
    const listasDeBordas: string[][] = [];
    const porOrdem = <T extends { sortOrder?: number | null }>(lista: T[] | null | undefined) =>
      [...(lista || [])].sort((a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0));
    for (const [i, p] of ordenados.entries()) {
      const grupos = porOrdem(p.comboGroups);
      const gSabores = grupos.find(ehPerguntaDeSabores)!;
      // A regra que vale é a de um tamanho de 2 sabores ou mais (no de 1 sabor ela não muda a conta).
      const desta = String(gSabores.priceRule).toUpperCase() as RegraDaPizza;
      if (!regraDeMeio && Number(gSabores.maxQty) >= 2) regraDeMeio = desta;
      if (!regra) regra = desta;
      const ler = (itens: typeof gSabores.items, precos: Map<string, (number | null)[]>) => porOrdem(itens).map((it) => {
        const id = idDoItem(it);
        if (!precos.has(id)) precos.set(id, Array(n).fill(null));
        precos.get(id)![i] = Number(it.additionalPrice) || 0;
        return id;
      });
      listasDeSabores.push(ler(gSabores.items, precoDoSabor));
      listasDeBordas.push(ler(grupos.find(ehPerguntaDeBorda)?.items, precoDaBorda));
    }
    const sabores: SaborDaPizza[] = juntarOrdens(listasDeSabores).map((id) => ({
      id, nome: String(porId.get(id)?.name || "").trim(), descricao: String(porId.get(id)?.description || "").trim(), precos: precoDoSabor.get(id)!,
    }));
    const bordas: BordaDaPizza[] = juntarOrdens(listasDeBordas).map((id) => ({
      id, nome: String(porId.get(id)?.name || "").trim(), precos: precoDaBorda.get(id)!,
    }));
    // A descrição do sabor que nasceu sem ingredientes é o próprio nome: na tela ela volta vazia.
    for (const s of sabores) if (s.descricao === s.nome) s.descricao = "";
    saida.push({
      categoria,
      regra: regraDeMeio || regra || "MAIOR",
      tamanhos: ordenados.map((p) => {
        const sabores = Number((p.comboGroups || []).find(ehPerguntaDeSabores)?.maxQty) || 1;
        const fatias = /(\d+)\s*fatias/i.exec(String(p.description || ""))?.[1];
        return { id: p.id, nome: tamanhoDoNome(String(p.name || "")), fatias: fatias ? Number(fatias) : null, sabores };
      }),
      sabores,
      bordas,
      ativos: ordenados.map((p) => p.active !== false),
    });
  }
  return saida;
}
