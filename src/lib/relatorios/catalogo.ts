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
import type { GrupoDoCadastro } from "@/lib/relatorios/itens-vendidos";

export type ProdutoDoFiltro = { id: string; nome: string; categoria: string };

export type CatalogoDoRelatorio = {
  mapasDe: (lojaId: string) => MapasDaLoja;
  grupos: Map<string, GrupoDoCadastro>;
  vendaveisDe: (lojaId: string) => Map<string, { id: string; nome: string; categoria: string }>;
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
          id: true, title: true, priceRule: true,
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

  const mapasDe = montarMapasDoRelatorio(produtos as any);

  // Grupo de opção por id. Com `priceRule` (mais caro, média…) é grupo de
  // SABOR de pizza: cada sabor vale a fração da pizza.
  const grupos = new Map<string, GrupoDoCadastro>();
  for (const p of produtos) for (const g of p.comboGroups || []) {
    grupos.set(g.id, { id: g.id, titulo: g.title, fracionado: Boolean(g.priceRule) });
  }

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
    categorias: categoriasDoFiltro(serializados, []),
    produtos: produtosDoFiltro,
    custoDe,
  };
}
