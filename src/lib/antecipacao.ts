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
const NAO_E_ESFIHA = /\b(batatas?|nuggets?|doguinhos?|pastel|pasteis|refri\w*|coca|guarana|guaravita|fanta|sprite|agua|aguas|sucos?|cervejas?|maionese|molhos?|limao|ketchup|mostarda|sache\w*|brindes?|panda)\b/;
const DOCE = /\b(chocolates?|nutella|doces?|brigadeiro|ninho|banana|romeu|julieta|morango|beijinho|ovomaltine|sensacao|kit ?kat|m m|duo|prestigio|confete|goiabada|pacoca|oreo|churros|leite condensado)\b/;
/** Recheio salgado que vai por cima da base de mussarela. */
const SALGADO = /\b(esfi\w*|queijos?|mussarela|mucarela|muzzarela|frango|bacon|pepperoni|peperoni|catupiry|cheddar|requeijao|presunto|palmito|milho|atum|escarola|lombo|provolone|parmesao|brocolis|portuguesa|marguerita|margherita|napolitana|tomate)\b/;

/** A base do Hakim de um lanche pelo nome; "doce" ou null quando não usa base. */
export function baseDoHakim(nome: string): BaseDoHakim | "doce" | null {
  const n = chaveDoNome(nome);
  if (!n || NAO_E_ESFIHA.test(n)) return null;
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

const linha = (nome: string, combo: boolean, quantidade: number): Contado =>
  ({ chave: `${combo ? "c" : "p"}:${chaveDoNome(nome) || nome.toLowerCase()}`, nome, combo, quantidade });

/** Os lanches de UM pedido. */
export function lanchesDoPedido(pedido: PedidoDaAntecipacao, catalogo: CatalogoDaAntecipacao): Contado[] {
  const saida: Contado[] = [];
  const mapas = catalogo.mapasDe(pedido.franchiseeId);
  const vendaveis = catalogo.vendaveisDe(pedido.franchiseeId);
  for (const item of pedido.items) {
    const qtd = Number(item.quantity) || 0;
    if (qtd <= 0) continue;
    const nome = nomeDoProduto(item);
    const categoria = categoriaDoItem(item as any, mapas);
    const ehCombo = item.menuProduct?.isCombo === true
      || FALA_DE_COMBO.test(chaveDoNome(categoria))
      || FALA_DE_COMBO.test(chaveDoNome(item.menuProduct?.category))
      || FALA_DE_COMBO.test(chaveDoNome(nome));
    const escolhas = escolhasDoItemComGrupo(item, catalogo.grupos, {
      canal: pedido.canal,
      gruposDoProduto: catalogo.gruposDoItem?.(pedido.franchiseeId, item),
      ehPizza: produtoDePizza(nome, categoria),
    });

    if (ehCombo && escolhas.length === 0) {
      // "4 Esfirras de Carne": o nome diz o que vem dentro.
      const m = /^(\d+)\s+([^+]+)$/.exec(nome.trim());
      if (m && Number(m[1]) > 0) {
        const texto = singular(chaveDoNome(m[2]));
        const produto = produtoDaEscolha(texto, vendaveis, true, catalogo.ativos);
        const nomeDoLanche = produto?.nome || texto.replace(/^\w/, (l) => l.toUpperCase());
        saida.push(linha(nomeDoLanche, false, Number(m[1]) * qtd));
        continue;
      }
    }

    saida.push(linha(nome, ehCombo, qtd));

    for (const e of escolhas) {
      const produto = produtoDaEscolha(e.nome, vendaveis, ehCombo, catalogo.ativos);
      if (produto) { saida.push(linha(produto.nome, false, e.quantidade)); continue; }
      // Fora do combo, só conta a opção que é um produto. Dentro, o nome que
      // veio — menos borda/adicional do cadastro e observação.
      if (!ehCombo) continue;
      if (complementosDaOpcao(e.nome, mapas.complementos).length) continue;
      if (OBSERVACAO.test(chaveDoNome(e.nome))) continue;
      saida.push(linha(e.nome, false, e.quantidade));
    }
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
};

/** Conta os lanches de um dia operacional, só os pedidos dentro da faixa (vazia = dia inteiro). */
export function contarDia(
  dia: string,
  pedidos: PedidoDaAntecipacao[],
  catalogo: CatalogoDaAntecipacao,
  tz: string,
  horaDe: string,
  horaAte: string,
): ContagemDoDia {
  const linhas: ContagemDoDia["linhas"] = new Map();
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
  }
  return { dia, pedidosNoDia: pedidos.length, pedidosNaFaixa, linhas };
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

export type PrevisaoDasBases = {
  bases: (LinhaDaPrevisao & { serve: string; lanches: { nome: string; media: number }[] })[];
  /** Esfihas doces na média (não usam base). */
  doces: number;
};

/** As 4 bases do Hakim a partir das linhas de lanche (combos ficam fora: o que vem dentro já está nas linhas). */
export function preverBases(dias: ContagemDoDia[], fator: number): PrevisaoDasBases {
  const n = Math.max(1, dias.length);
  let doces = 0;
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
      if (!alvo) continue;
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
  };
}
