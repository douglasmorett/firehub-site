/**
 * A conta da aba Antecipação: quanto de cada lanche sai no dia (ou numa faixa
 * de horas), pela média dos últimos dois dias iguais da semana — para a
 * cozinha deixar pronto antes do pedido chegar.
 *
 * ── O que conta como "um lanche" ────────────────────────────────────────────
 *
 * A mesma leitura das escolhas do relatório Itens vendidos
 * (`escolhasDoItemComGrupo`): a escolha do combo é POR UNIDADE do combo e
 * multiplica pela quantidade dele (Hakim, set–out/2026: "Combo 10 Esfirras
 * Simples" ×2 grava 10 escolhas, não 20), e meia pizza vale 0,5 de cada sabor.
 * A conta antiga desta aba não multiplicava — o combo pedido em dobro saía
 * pela metade.
 *
 * Do combo, o que conta é o que o cliente ESCOLHEU dentro dele: a esfiha do
 * "Combo 10" soma na linha da esfiha avulsa. Três casos que a conta antiga
 * perdia, todos vistos nos pedidos do Hakim de 11/10/2026:
 *
 * - o iFood grava o nome curto dentro do combo ("Carne", "Queijo Temperado",
 *   "Guaravita"): casa com o único produto do cardápio que termina ou começa
 *   com esse nome ("Esfirra de Carne", "Guaravita 280ml"); sem um único
 *   candidato, fica com o nome que veio ("Carne c/ Queijo");
 * - "4 Esfirras de Carne" chega sem escolha nenhuma: são 4 "Esfirra de Carne";
 * - o combo em si não é lanche para preparar: vai para a lista de combos, que
 *   avisa que o que vem FIXO nele (o burger de um combo que só pergunta o
 *   refrigerante) não está somado nos lanches.
 *
 * O casamento solto (fim/começo do nome) só vale DENTRO de combo. No produto
 * comum só a opção de nome igual a um produto conta — a "Esfirra de Kitkat"
 * do iFood traz a opção "Chocolate ao Leite", que é recheio, não outra esfiha.
 *
 * ── As bases do Hakim ───────────────────────────────────────────────────────
 *
 * Regra do Douglas (18/10/2026): a cozinha do Hakim antecipa só quatro bases.
 * Queijo temperado serve só a de queijo temperado; carne, tudo o que leva
 * carne (com queijo, com catupiry); calabresa, tudo o que leva calabresa (com
 * catupiry, com cheddar, com mussarela); e a de mussarela é a de todo o resto
 * — bacon, peperoni, frango, 4 queijos: pega a base pronta e põe o insumo por
 * cima. Doce não usa base nenhuma. Só faz sentido para o Hakim.
 *
 * Puro: recebe pedidos e o catálogo já lidos (lib/relatorios/catalogo.ts).
 */
import { chaveDoNome } from "@/lib/categoria-do-item";
import { complementosDaOpcao } from "@/lib/complemento-da-opcao";
import { categoriaDoItem } from "@/lib/itens-do-relatorio";
import { dentroDaFaixa, naLoja } from "@/lib/relatorios/base";
import { escolhasDoItemComGrupo, nomeDoProduto, produtoDePizza, type ContextoDaConta, type ItemParaRelatorio } from "@/lib/relatorios/itens-vendidos";

// ── AS BASES DO HAKIM ───────────────────────────────────────────────────────

export type BaseDoHakim = "carne" | "calabresa" | "queijo temperado" | "mussarela";

export const BASES_DO_HAKIM: { chave: BaseDoHakim; nome: string; serve: string }[] = [
  { chave: "carne", nome: "Carne", serve: "Carne, carne c/ queijo, carne c/ catupiry…" },
  { chave: "calabresa", nome: "Calabresa", serve: "Calabresa c/ mussarela, c/ catupiry, c/ cheddar…" },
  { chave: "queijo temperado", nome: "Queijo temperado", serve: "Só a de queijo temperado" },
  { chave: "mussarela", nome: "Mussarela", serve: "Queijo, bacon, peperoni, frango, 4 queijos e os outros salgados" },
];

/** O que não é esfiha: bebida, acompanhamento, sachê. */
const NAO_E_ESFIHA = /\b(pizzas?|batatas?|nuggets?|doguinhos?|pastel|pasteis|refri\w*|coca|guarana|guaravita|fanta|sprite|agua|aguas|sucos?|cervejas?|maionese|molhos?|limao|ketchup|mostarda|sache\w*|brindes?|panda)\b/;
const DOCE = /\b(chocolates?|nutella|doces?|brigadeiro|ninho|banana|romeu|julieta|morango|beijinho|ovomaltine|sensacao|kit ?kat|m m|duo|prestigio|confete|goiabada|pacoca|oreo|churros|leite condensado)\b/;
/** Recheio salgado que vai por cima da base de mussarela. */
const SALGADO = /\b(esfi\w*|queijos?|salaminho|salame|mussarela|mucarela|muzzarela|frango|bacon|pepperoni|peperoni|catupiry|cheddar|requeijao|presunto|palmito|milho|atum|escarola|lombo|provolone|parmesao|brocolis|portuguesa|marguerita|margherita|napolitana|tomate)\b/;

/** A base do Hakim de um lanche pelo nome; "doce" ou null quando não usa base. */
export function baseDoHakim(nome: string): BaseDoHakim | "doce" | null {
  const n = chaveDoNome(nome);
  // "20 Esfihas do Sábio" sem escolha: são várias esfihas de sabor que o pedido não diz.
  if (!n || NAO_E_ESFIHA.test(n) || /^\d/.test(n)) return null;
  if (DOCE.test(n)) return "doce";
  if (/\bqueijo temperado\b/.test(n)) return "queijo temperado";
  if (/\bcarnes?\b/.test(n)) return "carne";
  if (/\bcalabres\w*/.test(n)) return "calabresa";
  if (SALGADO.test(n)) return "mussarela";
  return null;
}

// ── DE UM PEDIDO PARA LANCHES ───────────────────────────────────────────────

export type PedidoDaAntecipacao = {
  franchiseeId: string;
  canal: string;
  createdAt: Date | string;
  items: (ItemParaRelatorio & { menuProduct?: (ItemParaRelatorio["menuProduct"] & { isCombo?: boolean | null }) | null })[];
};

export type CatalogoDaAntecipacao = Pick<ContextoDaConta, "mapasDe" | "grupos" | "vendaveisDe" | "gruposDoItem"> & {
  /** Ids dos produtos ATIVOS: o casamento solto não vai para produto desligado ("Calabresa" → "Pizza Calabresa" pausada). */
  ativos?: Set<string>;
  /** Nomes (chaveDoNome) dos produtos que são combo no cardápio: o "Hakim Kids" do iFood chega sem a marca de combo. */
  combos?: Set<string>;
};

/** Uma unidade contada: um lanche (ou combo) e quanto dele saiu. */
export type Contado = { chave: string; nome: string; combo: boolean; quantidade: number };

const FALA_DE_COMBO = /\b(combos?|kits?)\b/;
/** Escolha que é observação, não lanche: "Sem cebola", "Com gelo". */
const OBSERVACAO = /^(sem|com|obs|observacao|nao|tirar|retirar|adicional|extra)\b/;

/** "esfirras de queijo temperado" → "esfirra de queijo temperado". */
function singular(texto: string): string {
  return texto.split(" ").map((p) => {
    if (p.length <= 3) return p;
    if (p.endsWith("eis")) return `${p.slice(0, -3)}el`;
    if (p.endsWith("oes") || p.endsWith("aes")) return `${p.slice(0, -3)}ao`;
    return p.endsWith("s") ? p.slice(0, -1) : p;
  }).join(" ");
}

type Vendavel = { id: string; nome: string; categoria: string };

/**
 * O produto do cardápio que uma escolha nomeia. Nome igual sempre; dentro de
 * combo (`solto`), também o ÚNICO produto que termina ou começa com o nome
 * ("Carne" → "Esfirra de Carne"). Dois candidatos = não dá para saber.
 */
function produtoDaEscolha(nome: string, vendaveis: Map<string, Vendavel>, solto: boolean, ativos?: Set<string>): Vendavel | null {
  const c = chaveDoNome(nome);
  if (!c) return null;
  const igual = vendaveis.get(c);
  if (igual || !solto || c.length < 3) return igual || null;
  let achado: Vendavel | null = null;
  for (const [chave, v] of vendaveis) {
    if (!chave.endsWith(` ${c}`) && !chave.startsWith(`${c} `)) continue;
    // O combo "4 Esfirras de Carne" também termina em "carne" — não é candidato.
    if (/^\d/.test(chave) || FALA_DE_COMBO.test(chaveDoNome(v.categoria))) continue;
    if (ativos && !ativos.has(v.id)) continue;
    if (achado && achado.id !== v.id) return null;
    achado = v;
  }
  return achado;
}

/**
 * O nome que já diz quantas unidades são: "3x Esfirra de Bacon" e, sem o "x",
 * "4 Esfirras de Carne" (plural de mais de uma palavra). Só vale quando o resto
 * é um produto do cardápio — "5 Queijos" é o sabor, não 5 de "Queijo" (a mesma
 * armadilha que lib/stock.ts evita).
 */
function unidadesNoNome(nome: string, vendaveis: Map<string, Vendavel>, ativos?: Set<string>): { nome: string; vezes: number; id: string | null } | null {
  const m = /^(\d+)\s*(x?)\s+([^+|]+)$/i.exec(nome.trim());
  if (!m || !(Number(m[1]) > 0)) return null;
  const texto = chaveDoNome(m[3]);
  const palavras = texto.split(" ");
  if (!m[2] && !(palavras.length >= 2 && palavras[0].endsWith("s"))) return null;
  const produto = produtoDaEscolha(texto, vendaveis, true, ativos) || produtoDaEscolha(singular(texto), vendaveis, true, ativos);
  if (produto) return { nome: produto.nome, vezes: Number(m[1]), id: produto.id };
  // "4 Esfirras de Calabresa" quando o cardápio já não tem a "Esfirra de
  // Calabresa": o nome diz o sabor ("de"). "20 Esfihas do Sábio" não diz.
  if (!m[2] && palavras[1] === "de" && palavras.length >= 3) {
    const s = singular(texto);
    return { nome: s.charAt(0).toUpperCase() + s.slice(1), vezes: Number(m[1]), id: null };
  }
  return null;
}

/** "Esfiha do sabio 5x esfirra de carne 5x esfirra de calabresa…" e "Monte seu Combo | 2x Esfirra…": o conteúdo escrito no nome. */
function conteudoNoNome(nome: string): { nome: string; quantidade: number }[] {
  const saida: { nome: string; quantidade: number }[] = [];
  for (const m of nome.matchAll(/(\d+)\s*x\s+(.+?)(?=\s+\d+\s*x\s|\s*\||$)/gi)) {
    if (Number(m[1]) > 0 && m[2].trim()) saida.push({ nome: m[2].trim(), quantidade: Number(m[1]) });
  }
  return saida;
}

const linha = (nome: string, combo: boolean, quantidade: number): Contado =>
  ({ chave: `${combo ? "c" : "p"}:${chaveDoNome(nome) || nome.toLowerCase()}`, nome, combo, quantidade });

/**
 * Uma peça do pedido: o item, o que o nome dele diz que vem dentro ("4
 * Esfirras de Carne"), cada escolha. `lanche` = entra na lista de lanches; o
 * complemento (sabor de pizza, borda) não entra, mas tem ficha técnica.
 */
export type Peca = Contado & {
  produtoId: string | null;
  origem: "item" | "nome" | "escolha";
  lanche: boolean;
  /** Índice do item no pedido: junta a peça ao item dela. */
  item: number;
};

/** Os lanches de UM pedido. */
export function lanchesDoPedido(pedido: PedidoDaAntecipacao, catalogo: CatalogoDaAntecipacao): Contado[] {
  return pecasDoPedido(pedido, catalogo)
    .filter((p) => p.lanche)
    .map(({ chave, nome, combo, quantidade }) => ({ chave, nome, combo, quantidade }));
}

/** As peças de UM pedido (lanches e complementos). */
export function pecasDoPedido(pedido: PedidoDaAntecipacao, catalogo: CatalogoDaAntecipacao): Peca[] {
  const saida: Peca[] = [];
  const mapas = catalogo.mapasDe(pedido.franchiseeId);
  const vendaveis = catalogo.vendaveisDe(pedido.franchiseeId);
  for (const [indice, item] of pedido.items.entries()) {
    const qtd = Number(item.quantity) || 0;
    if (qtd <= 0) continue;
    const idDoItem = item.menuProductId || item.menuProduct?.id || null;
    const peca = (c: Contado, produtoId: string | null, origem: Peca["origem"], lanche = true): Peca =>
      ({ ...c, produtoId, origem, lanche, item: indice });
    const nome = nomeDoProduto(item);
    const categoria = categoriaDoItem(item as any, mapas);
    const ehCombo = item.menuProduct?.isCombo === true
      || Boolean(catalogo.combos?.has(chaveDoNome(nome)))
      || FALA_DE_COMBO.test(chaveDoNome(categoria))
      || FALA_DE_COMBO.test(chaveDoNome(item.menuProduct?.category))
      || FALA_DE_COMBO.test(chaveDoNome(nome));
    // Item que o cardápio não conhece pelo nome (o iFood manda "Oferta Hk - 5
    // Itens a partir de 29,90"; o cardápio diz "apartir"): a escolha casa pelo
    // nome curto, mas nome solto que não casa não vira lanche.
    // Produto apagado ("Produto removido") não conta: sem ele não dá para
    // saber se a opção é outra esfiha ou o recheio desta.
    const desconhecido = !ehCombo && nome !== "Produto removido" && !vendaveis.has(chaveDoNome(nome));
    const escolhas = escolhasDoItemComGrupo(item, catalogo.grupos, {
      canal: pedido.canal,
      gruposDoProduto: catalogo.gruposDoItem?.(pedido.franchiseeId, item),
      ehPizza: produtoDePizza(nome, categoria),
    });

    if (escolhas.length === 0 && (ehCombo || desconhecido)) {
      // "4 Esfirras de Carne": o nome diz o que vem dentro.
      const n = unidadesNoNome(nome, vendaveis, catalogo.ativos);
      if (n) {
        // O item fica (oculto) para a ficha: o combo com ficha própria vale por ela.
        saida.push(peca(linha(nome, true, qtd), idDoItem, "item", false));
        saida.push(peca(linha(n.nome, false, n.vezes * qtd), n.id, "nome"));
        continue;
      }
      // "Esfiha do sabio 5x esfirra de carne 5x…": o conteúdo escrito no nome.
      const escrito = conteudoNoNome(item.menuProduct?.name || String(item.productName || ""));
      if (escrito.length >= 2) {
        saida.push(peca(linha(nome.split("|")[0].replace(/\s+\d+\s*x\s.*$/i, "").trim() || nome, true, qtd), idDoItem, "item"));
        for (const c of escrito) {
          const produto = produtoDaEscolha(c.nome, vendaveis, true, catalogo.ativos);
          saida.push(peca(linha(produto?.nome || c.nome, false, c.quantidade * qtd), produto?.id || null, "nome"));
        }
        continue;
      }
    }

    saida.push(peca(linha(nome, ehCombo, qtd), idDoItem, "item"));

    for (const e of escolhas) {
      const n = unidadesNoNome(e.nome, vendaveis, catalogo.ativos);
      if (n) {
        // {"name":"3x Esfirra de Frango","quantity":3}: o "3x" e a quantidade
        // são a mesma coisa. O prefixo só multiplica quando a quantidade é 1.
        const daOpcao = e.quantidadeInteira / qtd;
        saida.push(peca(linha(n.nome, false, daOpcao === 1 ? n.vezes * e.quantidade : e.quantidade), n.id, "escolha"));
        continue;
      }
      const produto = produtoDaEscolha(e.nome, vendaveis, ehCombo || desconhecido, catalogo.ativos);
      if (produto) { saida.push(peca(linha(produto.nome, false, e.quantidade), produto.id, "escolha")); continue; }
      // Borda, sabor de pizza, adicional do cadastro: não é lanche, mas tem
      // ficha (a meia pizza já vem como fração em `e.quantidade`).
      const complementos = complementosDaOpcao(e.nome, mapas.complementos).filter((c) => c.id);
      if (complementos.length) {
        for (const c of complementos) saida.push(peca(linha(c.nome, false, e.quantidade), c.id, "escolha", false));
        continue;
      }
      // Fora do combo, só conta a opção que é um produto. Dentro, o nome que
      // veio — menos observação.
      if (!ehCombo) continue;
      if (OBSERVACAO.test(chaveDoNome(e.nome))) continue;
      saida.push(peca(linha(e.nome, false, e.quantidade), null, "escolha"));
    }
  }
  return saida;
}

// ── A FICHA TÉCNICA ─────────────────────────────────────────────────────────
//
// A mesma regra da baixa do estoque (lib/stock.ts, deductStockForOrder): a
// ficha do item — a dele ou, no espelho do iFood/99, a do produto ATIVO de
// mesmo nome no cardápio — MAIS a ficha de cada opção escolhida, com a meia
// pizza em fração. Uma diferença, de propósito: a baixa não abre o combo do
// iFood (o espelho não tem grupos, e as escolhas ficam sem baixa); aqui ele
// abre pelos nomes, como na lista de lanches — senão a esfiha do combo do
// iFood, que é a maior parte do Hakim, não pediria insumo nenhum.

export type LinhaDaFicha = { stockItemId: string; nome: string; unidade: string; quantidade: number };

export type FichasDaLoja = {
  /** produto → ficha (só quem tem ficha). */
  porId: Map<string, LinhaDaFicha[]>;
  /** `${loja}::${chaveDoNome}` → ficha do produto ativo, de verdade (não espelho), com esse nome. */
  porNome: Map<string, LinhaDaFicha[]>;
};

/** Monta as fichas a partir dos produtos com `recipeItems` (o select da rota). */
export function montarFichas(produtos: {
  id: string; franchiseeId: string | null; name: string; active: boolean | null;
  recipeItems: { stockItemId: string; quantityConsumed: number; stockItem: { name: string; unit: string } }[];
}[]): FichasDaLoja {
  const porId = new Map<string, LinhaDaFicha[]>();
  const porNome = new Map<string, LinhaDaFicha[]>();
  for (const p of produtos) {
    if (!p.recipeItems?.length) continue;
    const ficha = p.recipeItems.map((r) => ({ stockItemId: r.stockItemId, nome: r.stockItem.name, unidade: r.stockItem.unit, quantidade: Number(r.quantityConsumed) || 0 }));
    porId.set(p.id, ficha);
    const chave = `${p.franchiseeId || ""}::${chaveDoNome(p.name)}`;
    if (p.active && !p.id.startsWith("ifood-") && !porNome.has(chave)) porNome.set(chave, ficha);
  }
  return { porId, porNome };
}

function fichaDaPeca(p: Peca, loja: string, fichas: FichasDaLoja): LinhaDaFicha[] | null {
  return (p.produtoId && fichas.porId.get(p.produtoId)) || fichas.porNome.get(`${loja}::${chaveDoNome(p.nome)}`) || null;
}

export type InsumosDoPedido = {
  insumos: Map<string, { nome: string; unidade: string; quantidade: number }>;
  /** Lanche (ou sabor/borda) sem ficha: entra à parte, pela quantidade. */
  semFicha: Map<string, { nome: string; quantidade: number }>;
};

/** Os insumos de UM pedido, pela ficha técnica. */
export function insumosDoPedido(pedido: PedidoDaAntecipacao, catalogo: CatalogoDaAntecipacao, fichas: FichasDaLoja): InsumosDoPedido {
  const saida: InsumosDoPedido = { insumos: new Map(), semFicha: new Map() };
  const somar = (ficha: LinhaDaFicha[], vezes: number) => {
    for (const f of ficha) {
      const q = f.quantidade * vezes;
      if (!(q > 0)) continue;
      const atual = saida.insumos.get(f.stockItemId) || { nome: f.nome, unidade: f.unidade, quantidade: 0 };
      atual.quantidade += q;
      saida.insumos.set(f.stockItemId, atual);
    }
  };
  const semFicha = (p: Peca) => {
    const atual = saida.semFicha.get(p.chave) || { nome: p.nome, quantidade: 0 };
    atual.quantidade += p.quantidade;
    saida.semFicha.set(p.chave, atual);
  };
  const pecas = pecasDoPedido(pedido, catalogo);
  for (const item of new Set(pecas.map((p) => p.item))) {
    const doItem = pecas.filter((p) => p.item === item);
    const principal = doItem.find((p) => p.origem === "item");
    const fichaDoItem = principal ? fichaDaPeca(principal, pedido.franchiseeId, fichas) : null;
    if (principal && fichaDoItem) somar(fichaDoItem, principal.quantidade);
    let conteudo = 0;
    for (const p of doItem) {
      if (p.origem === "item") continue;
      // "4 Esfirras de Carne" com ficha própria: vale a do combo, não a do conteúdo.
      if (p.origem === "nome" && fichaDoItem) continue;
      conteudo++;
      const ficha = fichaDaPeca(p, pedido.franchiseeId, fichas);
      if (ficha) somar(ficha, p.quantidade);
      else semFicha(p);
    }
    // O item sem ficha: o lanche avulso entra à parte; o combo só quando não
    // se sabe o que tem dentro (nenhuma escolha) — senão o conteúdo já disse.
    if (principal && !fichaDoItem && (!principal.combo || conteudo === 0)) semFicha(principal);
  }
  return saida;
}

// ── UM DIA DE VENDAS ────────────────────────────────────────────────────────

export type ContagemDoDia = {
  dia: string;
  /** Pedidos do dia inteiro (0 = loja fechada) e só os da faixa de horas. */
  pedidosNoDia: number;
  pedidosNaFaixa: number;
  linhas: Map<string, { nome: string; combo: boolean; quantidade: number; porHora: number[] }>;
  /** Pela ficha técnica (só quando as fichas vêm). */
  insumos: Map<string, { nome: string; unidade: string; quantidade: number }>;
  semFicha: Map<string, { nome: string; quantidade: number }>;
};

/** Conta os lanches de um dia operacional, só os pedidos dentro da faixa (vazia = dia inteiro). */
export function contarDia(
  dia: string,
  pedidos: PedidoDaAntecipacao[],
  catalogo: CatalogoDaAntecipacao,
  tz: string,
  horaDe: string,
  horaAte: string,
  fichas?: FichasDaLoja,
): ContagemDoDia {
  const linhas: ContagemDoDia["linhas"] = new Map();
  const insumos: ContagemDoDia["insumos"] = new Map();
  const semFicha: ContagemDoDia["semFicha"] = new Map();
  let pedidosNaFaixa = 0;
  for (const p of pedidos) {
    const { hora, minutos } = naLoja(p.createdAt instanceof Date ? p.createdAt : new Date(p.createdAt), tz);
    if (!dentroDaFaixa(minutos, horaDe, horaAte)) continue;
    pedidosNaFaixa++;
    for (const c of lanchesDoPedido(p, catalogo)) {
      const l = linhas.get(c.chave) || { nome: c.nome, combo: c.combo, quantidade: 0, porHora: Array(24).fill(0) };
      l.quantidade += c.quantidade;
      l.porHora[hora] += c.quantidade;
      linhas.set(c.chave, l);
    }
    if (!fichas) continue;
    const doPedido = insumosDoPedido(p, catalogo, fichas);
    for (const [k, v] of doPedido.insumos) {
      const a = insumos.get(k) || { ...v, quantidade: 0 };
      a.quantidade += v.quantidade;
      insumos.set(k, a);
    }
    for (const [k, v] of doPedido.semFicha) {
      const a = semFicha.get(k) || { ...v, quantidade: 0 };
      a.quantidade += v.quantidade;
      semFicha.set(k, a);
    }
  }
  return { dia, pedidosNoDia: pedidos.length, pedidosNaFaixa, linhas, insumos, semFicha };
}

/**
 * O nome curto que sobrou ("Calabresa", do iFood) vai para a ÚNICA linha do
 * período que termina com ele ("Esfirra de Calabresa") — o produto que o
 * cardápio já não tem com esse nome, mas que o iFood continua mandando. Junta
 * nos dias todos de uma vez, para a linha ser a mesma em cada dia.
 */
export function juntarNomesCurtos(dias: ContagemDoDia[]): void {
  const lanches = new Set(dias.flatMap((d) => [...d.linhas].filter(([, l]) => !l.combo).map(([k]) => k)));
  for (const curta of lanches) {
    const fim = ` ${curta.slice(2)}`;
    const destinos = [...lanches].filter((k) => k !== curta && k.endsWith(fim) && !/^p:\d/.test(k));
    if (destinos.length !== 1) continue;
    for (const d of dias) {
      const de = d.linhas.get(curta);
      if (!de) continue;
      const para = d.linhas.get(destinos[0]) || { ...de, nome: dias.map((x) => x.linhas.get(destinos[0])?.nome).find(Boolean)!, quantidade: 0, porHora: Array(24).fill(0) };
      para.quantidade += de.quantidade;
      de.porHora.forEach((q, h) => { para.porHora[h] += q; });
      d.linhas.set(destinos[0], para);
      d.linhas.delete(curta);
    }
    lanches.delete(curta);
  }
}

// ── A PREVISÃO ──────────────────────────────────────────────────────────────

/** Feriado: 20% a mais que o normal (Douglas, 18/10/2026). */
export const FATOR_DO_FERIADO = 1.2;

export type LinhaDaPrevisao = {
  chave: string;
  nome: string;
  combo: boolean;
  /** Quanto saiu em cada dia de referência, na ordem deles. */
  porDia: number[];
  media: number;
  /** O que deixar pronto: a média (× feriado), arredondada para cima. */
  sugerido: number;
  /** A média por hora do relógio (0–23), já com o feriado. */
  porHora: number[];
};

const r1 = (n: number) => Math.round(n * 10) / 10;

/** A média das referências, linha a linha, mais vendido primeiro. */
export function preverLinhas(dias: ContagemDoDia[], fator: number): LinhaDaPrevisao[] {
  const chaves = new Set(dias.flatMap((d) => [...d.linhas.keys()]));
  const n = Math.max(1, dias.length);
  return [...chaves].map((chave) => {
    const daqui = dias.map((d) => d.linhas.get(chave));
    const primeira = daqui.find(Boolean)!;
    const porDia = daqui.map((l) => r1(l?.quantidade || 0));
    const media = daqui.reduce((s, l) => s + (l?.quantidade || 0), 0) / n;
    const porHora = Array.from({ length: 24 }, (_, h) => r1((daqui.reduce((s, l) => s + (l?.porHora[h] || 0), 0) / n) * fator));
    return { chave, nome: primeira.nome, combo: primeira.combo, porDia, media: r1(media), sugerido: Math.ceil(r1(media * fator)), porHora };
  }).sort((a, b) => b.sugerido - a.sugerido || b.media - a.media || a.nome.localeCompare(b.nome, "pt-BR"));
}

/** Arredonda para cima no passo da unidade: inteiro em g/ml/unidade, centésimo em kg/l. */
export function arredondarInsumo(quantidade: number, unidade: string): number {
  const u = chaveDoNome(unidade);
  if (/^(kg|kgs|quilos?|l|lt|litros?)$/.test(u)) return Math.ceil(Math.round(quantidade * 1e6) / 1e4) / 100;
  return Math.ceil(Math.round(quantidade * 1e4) / 1e4);
}

export type PrevisaoDosInsumos = {
  insumos: { chave: string; nome: string; unidade: string; porDia: number[]; media: number; sugerido: number }[];
  /** Lanche, sabor ou borda que saiu sem ficha montada: a quantidade, para a equipe saber o que ficou de fora. */
  semFicha: { nome: string; media: number; sugerido: number }[];
};

/** A média dos insumos pela ficha técnica (× feriado), maior quantidade primeiro. */
export function preverInsumos(dias: ContagemDoDia[], fator: number): PrevisaoDosInsumos {
  const n = Math.max(1, dias.length);
  const insumos = new Map<string, { nome: string; unidade: string; porDia: number[] }>();
  const semFicha = new Map<string, { nome: string; soma: number }>();
  dias.forEach((d, i) => {
    for (const [k, v] of d.insumos) {
      const a = insumos.get(k) || { nome: v.nome, unidade: v.unidade, porDia: dias.map(() => 0) };
      a.porDia[i] += v.quantidade;
      insumos.set(k, a);
    }
    for (const [k, v] of d.semFicha) {
      const a = semFicha.get(k) || { nome: v.nome, soma: 0 };
      a.soma += v.quantidade;
      semFicha.set(k, a);
    }
  });
  const casas = (x: number) => Math.round(x * 1000) / 1000;
  return {
    insumos: [...insumos].map(([chave, a]) => {
      const media = a.porDia.reduce((s, q) => s + q, 0) / n;
      return { chave, nome: a.nome, unidade: a.unidade, porDia: a.porDia.map(casas), media: casas(media), sugerido: arredondarInsumo(media * fator, a.unidade) };
    }).sort((x, y) => x.nome.localeCompare(y.nome, "pt-BR")),
    semFicha: [...semFicha.values()]
      .map((x) => ({ nome: x.nome, media: r1(x.soma / n), sugerido: Math.ceil(r1((x.soma / n) * fator)) }))
      .sort((x, y) => y.media - x.media),
  };
}

export type PrevisaoDasBases = {
  bases: (LinhaDaPrevisao & { serve: string; lanches: { nome: string; media: number }[] })[];
  /** Esfihas doces na média (não usam base). */
  doces: number;
  /** O que não entrou em base nenhuma (bebida, acompanhamento, item sem sabor no pedido), para a equipe ver que nada sumiu. */
  foraDasBases: { nome: string; media: number }[];
};

/** As 4 bases do Hakim a partir das linhas de lanche (combos ficam fora: o que vem dentro já está nas linhas). */
export function preverBases(dias: ContagemDoDia[], fator: number): PrevisaoDasBases {
  const n = Math.max(1, dias.length);
  let doces = 0;
  const fora = new Map<string, { nome: string; soma: number }>();
  const bases = BASES_DO_HAKIM.map((b) => ({
    ...b,
    porDia: dias.map(() => 0),
    soma: 0,
    porHora: Array(24).fill(0) as number[],
    lanches: new Map<string, { nome: string; soma: number }>(),
  }));
  dias.forEach((d, i) => {
    for (const [chave, l] of d.linhas) {
      if (l.combo) continue;
      const base = baseDoHakim(l.nome);
      if (base === "doce") { doces += l.quantidade; continue; }
      const alvo = bases.find((b) => b.chave === base);
      if (!alvo) {
        const f = fora.get(chave) || { nome: l.nome, soma: 0 };
        f.soma += l.quantidade;
        fora.set(chave, f);
        continue;
      }
      alvo.porDia[i] += l.quantidade;
      alvo.soma += l.quantidade;
      l.porHora.forEach((q, h) => { alvo.porHora[h] += q; });
      const lanche = alvo.lanches.get(chave) || { nome: l.nome, soma: 0 };
      lanche.soma += l.quantidade;
      alvo.lanches.set(chave, lanche);
    }
  });
  return {
    bases: bases.map((b) => {
      const media = b.soma / n;
      return {
        chave: b.chave, nome: b.nome, serve: b.serve, combo: false,
        porDia: b.porDia.map(r1),
        media: r1(media),
        sugerido: Math.ceil(r1(media * fator)),
        porHora: b.porHora.map((q) => r1((q / n) * fator)),
        lanches: [...b.lanches.values()].map((x) => ({ nome: x.nome, media: r1(x.soma / n) })).sort((x, y) => y.media - x.media),
      };
    }),
    doces: r1(doces / n),
    foraDasBases: [...fora.values()].map((x) => ({ nome: x.nome, media: r1(x.soma / n) })).sort((x, y) => y.media - x.media),
  };
}
