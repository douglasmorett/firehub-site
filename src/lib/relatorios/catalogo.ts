/**
 * O cardápio das lojas do relatório, lido UMA vez e servido do jeito que cada
 * relatório de item precisa: a categoria de verdade do item de plataforma, os
 * complementos (borda, sabor), o preço da opção no grupo, os grupos de opção e
 * os produtos vendáveis. Só servidor.
 */
import { prisma } from "@/lib/prisma";
import { chaveDoNome } from "@/lib/categoria-do-item";
import { idsSoDeOpcaoDeCombo } from "@/lib/cardapio-interno";
import {
  categoriaDoProduto, categoriasDoFiltro, ehProdutoEspelho, montarMapasDoRelatorio, type MapasDaLoja,
} from "@/lib/itens-do-relatorio";
import { grupoDeSaborDePizza, nomeDoProduto, type GrupoDoCadastro, type ItemParaRelatorio } from "@/lib/relatorios/itens-vendidos";

export type ProdutoDoFiltro = { id: string; nome: string; categoria: string };

export type CatalogoDoRelatorio = {
  mapasDe: (lojaId: string) => MapasDaLoja;
  grupos: Map<string, GrupoDoCadastro>;
  vendaveisDe: (lojaId: string) => Map<string, { id: string; nome: string; categoria: string }>;
  /** Os grupos de opção do produto do item (ou, no espelho, do produto do cardápio de mesmo nome). */
  gruposDoItem: (lojaId: string, item: ItemParaRelatorio) => GrupoDoCadastro[];
  /** As categorias do cardápio de verdade (sem "iFood"/"99Food"). */
  categorias: string[];
  /** Os produtos de verdade, para o filtro "Produto". */
  produtos: ProdutoDoFiltro[];
  /** Custo cadastrado por produto (id → custo). */
  custoDe: Map<string, number>;
};

export async function catalogoDoRelatorio(lojaIds: string[]): Promise<CatalogoDoRelatorio> {
  const produtos = await prisma.menuProduct.findMany({
    where: { franchiseeId: { in: lojaIds } },
    select: {
      id: true, franchiseeId: true, name: true, category: true, price: true, cost: true, active: true,
      // O que `idsSoDeOpcaoDeCombo` lê para dizer quem é complemento, e o preço
      // da opção em cada grupo (lib/itens-do-relatorio.ts).
      apenasEmCombo: true, priceSalao: true, priceDelivery: true, priceTotem: true,
      comboGroups: {
        select: {
          id: true, title: true, priceRule: true, maxQty: true,
          items: {
            select: {
              menuProductId: true, additionalPrice: true, additionalPriceSalao: true,
              additionalPriceDelivery: true, additionalPriceTotem: true,
            },
          },
        },
      },
    },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });
  return montarCatalogo(produtos);
}

/** Um produto como o catálogo o lê (o `select` de `catalogoDoRelatorio`). */
export type ProdutoDoCatalogo = {
  id: string;
  franchiseeId: string | null;
  name: string;
  category: string | null;
  price?: number | null;
  cost?: number | null;
  active: boolean | null;
  apenasEmCombo?: boolean | null;
  priceSalao?: number | null;
  priceDelivery?: number | null;
  priceTotem?: number | null;
  comboGroups?: {
    id: string;
    title: string;
    priceRule?: string | null;
    maxQty?: number | null;
    items: {
      menuProductId: string;
      additionalPrice?: number | null;
      additionalPriceSalao?: number | null;
      additionalPriceDelivery?: number | null;
      additionalPriceTotem?: number | null;
    }[];
  }[];
};

/** A parte pura do catálogo: tudo o que sai dos produtos já lidos (testada em scripts/teste-itens-vendidos.ts). */
export function montarCatalogo(produtos: ProdutoDoCatalogo[]): CatalogoDoRelatorio {
  const mapasDe = montarMapasDoRelatorio(produtos as any);

  // Grupo de opção por id, com as opções pelo nome. É de SABOR de pizza
  // (fracionado: cada sabor vale a fração da pizza) com `priceRule` ou pelo
  // critério de `grupoDeSaborDePizza` — título de sabor em produto de pizza,
  // nunca rodízio nem mini.
  const nomeDe = new Map(produtos.map((p) => [p.id, p.name]));
  const grupos = new Map<string, GrupoDoCadastro>();
  const gruposPorProduto = new Map<string, GrupoDoCadastro[]>();
  for (const p of produtos) for (const g of p.comboGroups || []) {
    const grupo: GrupoDoCadastro = {
      id: g.id,
      titulo: g.title,
      fracionado: grupoDeSaborDePizza({ titulo: g.title, priceRule: g.priceRule, maxQty: g.maxQty }, { nome: p.name, categoria: p.category }),
      opcoes: [...new Set((g.items || []).map((i) => chaveDoNome(String(nomeDe.get(i.menuProductId) || ""))).filter(Boolean))],
    };
    grupos.set(g.id, grupo);
    if (!gruposPorProduto.has(p.id)) gruposPorProduto.set(p.id, []);
    gruposPorProduto.get(p.id)!.push(grupo);
  }

  // O espelho do marketplace não tem grupos: os do produto do cardápio de
  // MESMO NOME (ativo, de verdade, com grupos) servem para achar o grupo do
  // sabor que o iFood/99/Brendi mandam sem "1/2".
  const comGruposPorNome = new Map<string, Map<string, string>>();
  for (const p of produtos) {
    if (!p.active || ehProdutoEspelho(p as any) || !gruposPorProduto.has(p.id)) continue;
    const loja = String(p.franchiseeId || "");
    const chave = chaveDoNome(p.name);
    if (!chave) continue;
    if (!comGruposPorNome.has(loja)) comGruposPorNome.set(loja, new Map());
    if (!comGruposPorNome.get(loja)!.has(chave)) comGruposPorNome.get(loja)!.set(chave, p.id);
  }
  const gruposDoItem = (lojaId: string, item: ItemParaRelatorio): GrupoDoCadastro[] => {
    const id = item.menuProductId || item.menuProduct?.id || "";
    const proprios = id ? gruposPorProduto.get(id) : undefined;
    if (proprios?.length) return proprios;
    const real = comGruposPorNome.get(lojaId)?.get(chaveDoNome(nomeDoProduto(item)));
    return real ? gruposPorProduto.get(real) || [] : [];
  };

  // Vendável = produto de verdade que não é só opção de combo.
  const soOpcao = idsSoDeOpcaoDeCombo(produtos as any);
  const vendaveisPorLoja = new Map<string, Map<string, { id: string; nome: string; categoria: string }>>();
  const produtosDoFiltro: ProdutoDoFiltro[] = [];
  const serializados: { category: string; espelho: boolean }[] = [];
  const custoDe = new Map<string, number>();
  for (const p of produtos) {
    custoDe.set(p.id, Number(p.cost) || 0);
    const { categoria, espelho } = categoriaDoProduto(p as any, mapasDe(p.franchiseeId || ""));
    serializados.push({ category: categoria, espelho });
    if (espelho || ehProdutoEspelho(p as any) || soOpcao.has(p.id)) continue;
    produtosDoFiltro.push({ id: p.id, nome: p.name, categoria });
    const loja = String(p.franchiseeId || "");
    if (!vendaveisPorLoja.has(loja)) vendaveisPorLoja.set(loja, new Map());
    const chave = chaveDoNome(p.name);
    if (chave && !vendaveisPorLoja.get(loja)!.has(chave)) vendaveisPorLoja.get(loja)!.set(chave, { id: p.id, nome: p.name, categoria });
  }

  const vazio = new Map<string, { id: string; nome: string; categoria: string }>();
  return {
    mapasDe: (lojaId) => mapasDe(lojaId),
    grupos,
    vendaveisDe: (lojaId) => vendaveisPorLoja.get(lojaId) || vazio,
    gruposDoItem,
    categorias: categoriasDoFiltro(serializados, []),
    produtos: produtosDoFiltro,
    custoDe,
  };
}
