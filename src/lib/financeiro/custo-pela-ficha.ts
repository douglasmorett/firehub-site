/**
 * O CUSTO DE UM ITEM VENDIDO pela ficha técnica × o custo do insumo no dia —
 * a fonte 2 do CMV do DRE (lib/financeiro/dre.ts), usada nos dias que a
 * contagem do estoque não cobre. Puro: quem busca é
 * lib/financeiro/cmv-do-financeiro.ts. Testado em scripts/teste-dre.ts.
 *
 * ── A ordem ─────────────────────────────────────────────────────────────────
 *
 *   1. Produto com ficha técnica (`ProductRecipe`): Σ quantidade × custo do
 *      insumo NAQUELE dia (lib/cmv/custo-do-insumo.ts: a última compra até o
 *      dia; preparo pela receita ÷ rendimento).
 *   2. Combo: a ficha dele (a embalagem) + a ficha de cada opção escolhida ×
 *      a quantidade da opção — a mesma conta da baixa (lib/stock.ts).
 *   3. Sem ficha: o custo digitado no produto (`MenuProduct.cost`).
 *   4. Nada disso: SEM custo. O item entra como "não coberto", nunca como R$ 0.
 *
 * ── As armadilhas ───────────────────────────────────────────────────────────
 *
 *   • O item do iFood (e 99, Brendi, JotaJá, Wabiz) aponta para um ESPELHO
 *     (`ifood-…`, categoria "iFood", sem ficha e sem lugar para ter uma). Ele
 *     casa pelo NOME, sem diferenciar caixa, com o produto ATIVO do cardápio —
 *     o mesmo que a baixa faz. "Esfirra de Carne (Promo)" existe como produto;
 *     nome que não existe ("Combo Imperial Mix") fica sem custo e a tela diz
 *     qual é.
 *   • `comboSelections` tem dois formatos: o do iFood/PDV é a lista
 *     `[{ name, quantity, price }]`; o do site é `{ grupoId: { nome: qtd } }`.
 *     A quantidade da opção é POR unidade do item nos dois.
 *   • O `price` do item do iFood JÁ inclui os acréscimos das opções: o valor do
 *     item é preço × quantidade e ponto — somar o preço da opção contaria duas
 *     vezes (lib/relatorios, preco-da-opcao-do-ifood-e-da-linha).
 *   • Insumo sem custo (nenhuma compra lançada, nem custo no cadastro) e
 *     preparo com componente sem custo deixam a linha SEM custo — um R$ 0
 *     calado faria o CMV parecer bom justamente quando falta informação.
 *   • Insumo marcado "não entra no CMV" não soma (a mesma regra da contagem).
 *
 * Opção que não é produto nenhum ("Sem cebola") num produto com ficha própria
 * e sem preço não muda o custo. Em combo, ou com preço, fica sem custo.
 *
 * NÃO coberto (de propósito): pizza meio a meio cuja opção é o sabor inteiro —
 * nenhuma loja tem ficha de pizza hoje; quando tiver, a metade precisa de regra
 * própria (hoje somaria o sabor inteiro duas vezes).
 */
import { ehPreparo, type CustoNoDia, type InsumoParaCusto } from "@/lib/cmv/custo-do-insumo";

export type LinhaDaFicha = { insumoId: string; nome: string; quantidade: number };

export type ProdutoParaCusto = {
  id: string;
  nome: string;
  ativo: boolean;
  /** `MenuProduct.cost` digitado (nulo/zero = sem custo). */
  custo: number | null;
  combo: boolean;
  ficha: LinhaDaFicha[];
  grupos: { id: string; opcoes: { id: string; produtoId: string }[] }[];
};

/** O que falta para o item ter custo. */
export type MotivoSemCusto =
  /** Produto sem ficha técnica e sem custo digitado. */
  | "SEM_FICHA"
  /** A ficha existe, mas um insumo (ou um componente do preparo) não tem custo no dia. */
  | "INSUMO_SEM_CUSTO"
  /** Item do app com um nome que não existe no cardápio. */
  | "NOME_NAO_CASA"
  /** Opção escolhida (sabor do combo, adicional pago) sem ficha nem custo. */
  | "OPCAO_SEM_FICHA";

export type FaltaDoItem = { motivo: MotivoSemCusto; nome: string };

export type CustoDoItem = {
  nome: string;
  /** Preço × quantidade (a régua do Itens vendidos). */
  valor: number;
  /** Nulo = sem custo (não coberto). */
  custo: number | null;
  fonte: "FICHA" | "CADASTRO" | null;
  faltas: FaltaDoItem[];
};

export type ItemParaCusto = {
  produtoId: string | null;
  /** O nome gravado no pedido (`productName`). */
  nome: string | null;
  quantidade: number;
  preco: number;
  escolhas: unknown;
};

/** Produto-espelho de marketplace (lib/ifood-itens.ts, food99-pedido.ts, processBrendiEvent.ts, processJotajaEvent.ts, wabiz-traducao.ts). */
export const ehEspelho = (id: string) => /^(ifood-|99food_|brendi-|jotaja-|wabiz-|keeta-)/i.test(id);

const chave = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
const r2 = (n: number) => Math.round(n * 100) / 100;
const temCusto = (p: ProdutoParaCusto | null | undefined): boolean => Boolean(p && p.custo != null && p.custo > 0 && Number.isFinite(p.custo));

export type Catalogo = {
  porId: Map<string, ProdutoParaCusto>;
  /** Produtos ATIVOS que não são espelho, pelo nome. Nulo = dois produtos com o mesmo nome e fichas diferentes. */
  porNome: Map<string, ProdutoParaCusto | null>;
  /** A loja tem alguma ficha técnica gravada. */
  usaFicha: boolean;
};

const assinaturaDaFicha = (p: ProdutoParaCusto) =>
  p.ficha.map((l) => `${l.insumoId}:${l.quantidade}`).sort().join("|");

export function montarCatalogo(produtos: ProdutoParaCusto[]): Catalogo {
  const porId = new Map(produtos.map((p) => [p.id, p]));
  const porNome = new Map<string, ProdutoParaCusto | null>();
  const peso = (p: ProdutoParaCusto) => (p.ficha.length ? 2 : temCusto(p) || p.grupos.length ? 1 : 0);
  for (const p of produtos) {
    if (!p.ativo || ehEspelho(p.id) || !p.nome.trim()) continue;
    const k = chave(p.nome);
    if (!porNome.has(k)) { porNome.set(k, p); continue; }
    const atual = porNome.get(k);
    if (!atual) continue; // já ambíguo
    if (peso(p) > peso(atual)) porNome.set(k, p);
    else if (peso(p) === 2 && peso(atual) === 2 && assinaturaDaFicha(p) !== assinaturaDaFicha(atual)) {
      // Dois "Esfirra de Carne" ativos com fichas diferentes: qual o iFood vendeu? Não chuta.
      porNome.set(k, null);
    }
  }
  return { porId, porNome, usaFicha: produtos.some((p) => p.ficha.length > 0) };
}

// ── O custo do insumo no dia ────────────────────────────────────────────────

export type InsumoNoDia = { custo: number | null; faltando: string[]; foraDoCmv: boolean };
export type CustoDoInsumo = (insumoId: string, nomeNaFicha: string) => InsumoNoDia;

/**
 * Lê `custosNoDia` (lib/cmv/custo-do-insumo.ts) do jeito que o CMV precisa:
 * sem custo, ou preparo calculado com componente faltando, vira a lista do que
 * falta (o insumo de verdade, o que se compra), e não um número parcial.
 */
export function custoDoInsumoNoDia(
  insumos: (InsumoParaCusto & { entraNoCmv?: boolean })[],
  custos: Map<string, CustoNoDia>,
): CustoDoInsumo {
  const porId = new Map(insumos.map((i) => [i.id, i]));
  const faltandoDe = (id: string, caminho: string[]): string[] => {
    const i = porId.get(id);
    if (!i) return [];
    const c = custos.get(id);
    // Preparo sem receita com o custo digitado é custo de cadastro: vale.
    if (c && c.custo != null && !(c.incompleto && c.fonte === "PREPARO")) return [];
    if (ehPreparo(i) && i.componentes.length && Number(i.rendimento) > 0 && caminho.length < 5) {
      const lista = i.componentes
        .filter((comp) => Number(comp.quantidade) > 0 && !caminho.includes(comp.insumoId))
        .flatMap((comp) => (porId.has(comp.insumoId) ? faltandoDe(comp.insumoId, [...caminho, comp.insumoId]) : [`componente desativado de ${i.nome}`]));
      return lista.length ? lista : [i.nome];
    }
    if (ehPreparo(i) && i.componentes.length && !(Number(i.rendimento) > 0)) return [`${i.nome} (preparo sem rendimento)`];
    return [i.nome];
  };
  return (id, nomeNaFicha) => {
    const i = porId.get(id);
    if (!i) return { custo: null, faltando: [`${nomeNaFicha} (desativado no estoque)`], foraDoCmv: false };
    if (i.entraNoCmv === false) return { custo: 0, faltando: [], foraDoCmv: true };
    const faltando = [...new Set(faltandoDe(id, [id]))];
    if (faltando.length) return { custo: null, faltando, foraDoCmv: false };
    return { custo: custos.get(id)!.custo!, faltando: [], foraDoCmv: false };
  };
}

// ── As escolhas do combo ────────────────────────────────────────────────────

export type EscolhaDoItem = { grupoId?: string; chaves: string[]; nome: string; qtd: number; preco: number | null };

/**
 * Os dois formatos de `comboSelections` numa lista só — o mesmo trabalho de
 * `normalizarEscolhasDoCombo` (lib/stock.ts, que importa o banco e não exporta
 * a função), mais o preço da opção quando a lista traz.
 */
export function lerEscolhas(bruto: unknown): EscolhaDoItem[] {
  if (!bruto) return [];
  let dados: any = bruto;
  if (typeof dados === "string") {
    try { dados = JSON.parse(dados); } catch { return []; }
  }
  if (Array.isArray(dados)) {
    const lista: EscolhaDoItem[] = [];
    for (const e of dados) {
      if (typeof e === "string") {
        const texto = e.trim();
        if (!texto) continue;
        // O "x" é obrigatório: "5 Queijos" é o nome do sabor, não 5 × "Queijos".
        const m = texto.match(/^(\d+)\s*x\s+(.+)$/i);
        const nome = m ? m[2].trim() : texto;
        const qtd = m ? Number(m[1]) : 1;
        if (nome && qtd > 0) lista.push({ chaves: [nome], nome, qtd, preco: null });
        continue;
      }
      if (!e || typeof e !== "object") continue;
      const qtd = Number(e.quantity ?? e.qty ?? 1);
      if (!Number.isFinite(qtd) || qtd <= 0) continue;
      const nome = String(e.name ?? e.productName ?? e.label ?? "").trim();
      const chaves = [e.comboGroupItemId, e.optionId, e.menuProductId, e.productId, e.id, nome]
        .map((c) => (c == null ? "" : String(c).trim()))
        .filter(Boolean);
      if (!chaves.length) continue;
      const grupoId = e.groupId ?? e.comboGroupId;
      const preco = e.price != null && Number.isFinite(Number(e.price)) ? Number(e.price) : null;
      lista.push({ grupoId: grupoId ? String(grupoId) : undefined, chaves, nome: nome || chaves[0], qtd, preco });
    }
    return lista;
  }
  if (typeof dados === "object") {
    const lista: EscolhaDoItem[] = [];
    for (const [grupoId, grupo] of Object.entries(dados as Record<string, any>)) {
      if (!grupo || typeof grupo !== "object" || Array.isArray(grupo)) continue;
      for (const [nome, qtd] of Object.entries(grupo as Record<string, any>)) {
        const n = Number(qtd);
        if (nome && Number.isFinite(n) && n > 0) lista.push({ grupoId, chaves: [nome], nome, qtd: n, preco: null });
      }
    }
    return lista;
  }
  return [];
}

type IndiceDoCombo = { porGrupo: Map<string, string>; porChave: Map<string, string | null> };

/** As opções do combo por grupo e por chave (id da opção, id do produto, nome). Chave que aponta para dois produtos = ambígua. */
function indexarCombo(produto: ProdutoParaCusto, cat: Catalogo): IndiceDoCombo {
  const porGrupo = new Map<string, string>();
  const porChave = new Map<string, string | null>();
  for (const g of produto.grupos) {
    for (const o of g.opcoes) {
      const nome = cat.porId.get(o.produtoId)?.nome || "";
      for (const k of [o.id, o.produtoId, nome].map(chave).filter(Boolean)) {
        porGrupo.set(`${g.id}::${k}`, o.produtoId);
        if (!porChave.has(k)) porChave.set(k, o.produtoId);
        else if (porChave.get(k) !== o.produtoId) porChave.set(k, null);
      }
    }
  }
  return { porGrupo, porChave };
}

function acharOpcao(indice: IndiceDoCombo | null, e: EscolhaDoItem, cat: Catalogo): ProdutoParaCusto | null {
  if (indice) {
    for (const c of e.chaves) {
      const k = chave(c);
      if (!k) continue;
      if (e.grupoId) {
        const id = indice.porGrupo.get(`${e.grupoId}::${k}`);
        if (id) return cat.porId.get(id) ?? null;
      }
      const id = indice.porChave.get(k);
      if (id) return cat.porId.get(id) ?? null;
    }
  }
  // Combo do iFood (o espelho não tem grupos) ou opção fora dos grupos: pelo nome.
  return cat.porNome.get(chave(e.nome)) ?? null;
}

// ── O item ──────────────────────────────────────────────────────────────────

export function custoDoItem(item: ItemParaCusto, cat: Catalogo, insumo: CustoDoInsumo): CustoDoItem {
  const q = Number(item.quantidade) || 0;
  const valor = r2((Number(item.preco) || 0) * q);
  const proprio = item.produtoId ? cat.porId.get(item.produtoId) ?? null : null;
  const nome = (item.nome || proprio?.nome || "Item sem nome").trim();
  const temEstrutura = (p: ProdutoParaCusto) => p.ficha.length > 0 || p.grupos.length > 0;

  // O produto que diz o custo: o do item, se tem ficha ou grupos; senão o do
  // cardápio com o mesmo nome (o espelho do app; um produto renomeado).
  let produto: ProdutoParaCusto | null = proprio && temEstrutura(proprio) ? proprio : null;
  if (!produto) {
    produto = cat.porNome.get(chave(nome)) ?? (proprio ? cat.porNome.get(chave(proprio.nome)) ?? null : null);
    if (produto && !temEstrutura(produto) && !temCusto(produto) && proprio) produto = proprio;
  }
  if (!produto && proprio && !ehEspelho(proprio.id)) produto = proprio;

  const escolhas = lerEscolhas(item.escolhas);
  const faltas: FaltaDoItem[] = [];
  let custoUnitario = 0;
  let usouFicha = false;
  let usouCadastro = false;

  const somarFicha = (p: ProdutoParaCusto, vezes: number) => {
    usouFicha = true;
    for (const l of p.ficha) {
      const qtd = Number(l.quantidade);
      if (!(qtd > 0)) continue;
      const c = insumo(l.insumoId, l.nome);
      if (c.custo == null) { for (const f of c.faltando) faltas.push({ motivo: "INSUMO_SEM_CUSTO", nome: f }); continue; }
      custoUnitario += qtd * c.custo * vezes;
    }
  };

  const ehCombo = Boolean(produto && (produto.combo || produto.grupos.length > 0));
  if (produto && produto.ficha.length) {
    somarFicha(produto, 1);
  } else if (ehCombo && escolhas.length > 0) {
    // Combo sem ficha própria: o custo vem todo das opções escolhidas.
  } else {
    const comCusto = [proprio, produto].find(temCusto);
    if (comCusto) {
      // Fonte 3, como sempre foi: o custo digitado vale pelo item inteiro.
      return { nome, valor, custo: r2(comCusto.custo! * q), fonte: "CADASTRO", faltas: [] };
    }
    if (!produto) return { nome, valor, custo: null, fonte: null, faltas: [{ motivo: "NOME_NAO_CASA", nome }] };
    return { nome, valor, custo: null, fonte: null, faltas: [{ motivo: "SEM_FICHA", nome: produto.nome }] };
  }

  if (escolhas.length) {
    const indice = produto && produto.grupos.length ? indexarCombo(produto, cat) : null;
    for (const e of escolhas) {
      const o = acharOpcao(indice, e, cat);
      if (o && o.ficha.length) { somarFicha(o, e.qtd); continue; }
      if (o && temCusto(o)) { custoUnitario += o.custo! * e.qtd; usouCadastro = true; continue; }
      if (o) { faltas.push({ motivo: "OPCAO_SEM_FICHA", nome: o.nome }); continue; }
      // Não é produto nenhum. Num produto com ficha própria, opção sem preço é
      // modificador ("Sem cebola", "Bem passada"): não muda o custo.
      if (!ehCombo && produto?.ficha.length && !((e.preco ?? 0) > 0)) continue;
      faltas.push({ motivo: "OPCAO_SEM_FICHA", nome: e.nome });
    }
  }

  if (faltas.length) {
    const unicas = new Map(faltas.map((f) => [`${f.motivo}|${f.nome}`, f]));
    return { nome, valor, custo: null, fonte: null, faltas: [...unicas.values()] };
  }
  return { nome, valor, custo: r2(custoUnitario * q), fonte: usouFicha ? "FICHA" : usouCadastro ? "CADASTRO" : "FICHA", faltas: [] };
}
