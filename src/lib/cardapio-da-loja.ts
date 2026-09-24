/**
 * /src/lib/cardapio-da-loja.ts
 *
 * A consulta ÚNICA do cardápio próprio da loja, com os combos aninhados.
 *
 * Nasceu porque o garçom pelo link (/garcom/<slug>/mesas) precisa do mesmo
 * cardápio que a tela de mesa do painel — e a rota do painel
 * (/api/admin/menu-products) exige sessão do NextAuth no middleware. Em vez de
 * copiar a consulta para a rota do garçom e deixar as duas divergirem na
 * próxima coluna nova, as duas chamam daqui.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { orderByCardapio } from "./menu-order";
import { SEM_PRODUTO_DE_INTEGRACAO } from "./cardapio-interno";
import { aplicarPrecoNoCardapio, type CanalDePreco } from "./preco-por-canal";
import { estoqueDaLojaOuVazio, comEstoqueAnotado } from "./estoque-restante";

/**
 * Colunas que as telas de venda e de cadastro usam.
 *
 * Os preços por canal vêm CRUS: a tela de CADASTRO precisa deles para editar.
 * As telas de VENDA passam por `aplicarPrecoNoCardapio` e recebem o `price`
 * já resolvido, sem estas colunas.
 *
 * `imageUrl` NÃO entra nos itens de combo de propósito. A tela de combo mostra
 * só o NOME da opção ("6 Nuggets"), nunca a foto. Como o mesmo produto aparece
 * em vários combos, a imagem vinha DUPLICADA a cada combo: uma foto de 1,8 MB
 * usada em 6 combos virava 10,6 MB no JSON. Medido em produção: payload de
 * 14,63 MB, sendo 10,59 MB só de cópias aninhadas. 38 segundos para abrir o
 * balcão.
 */
export const SELECT_DO_CARDAPIO = {
  id: true, name: true, price: true, category: true,
  priceSalao: true, priceDelivery: true, priceTotem: true, promoPrice: true,
  imageUrl: true, active: true, isCombo: true, isBeverage: true,
  activePDV: true, activeDelivery: true, activeTotem: true, activeGarcom: true,
  // Opcao que so existe dentro de combo: a tela de cadastro precisa do campo
  // para marcar, e o cardapio de venda para esconder do avulso.
  apenasEmCombo: true,
  cost: true, tags: true, availableDays: true, description: true,
  comboConfig: true,
  comboGroups: {
    orderBy: { sortOrder: "asc" },
    include: {
      items: {
        // A ordem que o lojista arrumou na tela. Sem ela a lista sai na ordem
        // física do Postgres — foi assim que os seis sabores doces subiram
        // para o topo da pergunta de 42 sabores na Pizzaria do Digão.
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        include: {
          menuProduct: { select: { id: true, name: true, active: true } },
        },
      },
    },
  },
} satisfies Prisma.MenuProductSelect;

/**
 * Cardápio da loja para um canal de venda, já sem o espelho das integrações
 * e com o preço do canal aplicado.
 */
export async function cardapioDaLoja(franchiseeId: string, canal: CanalDePreco) {
  const produtos = await prisma.menuProduct.findMany({
    where: { franchiseeId, ...SEM_PRODUTO_DE_INTEGRACAO },
    orderBy: await orderByCardapio(),
    select: SELECT_DO_CARDAPIO,
  });
  // Estoque disponível (lib/estoque-do-cardapio.ts): quem controla leva o
  // restante e a marca `esgotado`. Esta lista serve o balcão, a mesa, o garçom
  // e a edição de pedido — cada tela decide esconder; o servidor recusa de
  // qualquer jeito ao gravar.
  const estoque = await estoqueDaLojaOuVazio(franchiseeId);
  const comEstoque = estoque.size === 0 ? produtos : produtos.map((p) => comEstoqueAnotado(p, estoque));
  return ordenarComoALoja(aplicarPrecoNoCardapio(comEstoque as any[], canal), await ordemDasCategorias(franchiseeId));
}

/**
 * A ORDEM DAS CATEGORIAS que a loja escolheu em "Reordenar Cardápio"
 * (MenuCategory.sortOrder), como posição por nome.
 *
 * O `orderBy` do banco ordena por NOME da categoria (o produto guarda a
 * categoria como texto), e as telas de venda ainda passavam um `.sort()`
 * alfabético por cima. Na Ragnar Burger, "Adicionais Burger" — a última na
 * ordem da loja — abria o balcão, com Bacon e as bordas no topo.
 */
export async function ordemDasCategorias(franchiseeId: string | null | undefined): Promise<Map<string, number>> {
  if (!franchiseeId) return new Map();
  const categorias = await prisma.menuCategory
    .findMany({
      where: { franchiseeId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { name: true },
    })
    .catch(() => [] as { name: string }[]);
  return new Map(categorias.map((c, i) => [chaveDaCategoria(c.name), i]));
}

const chaveDaCategoria = (nome: unknown) => String(nome ?? "").trim().toLowerCase();

/**
 * Reordena pela posição da categoria e anota `categoriaOrdem` em cada produto.
 * A ordem DENTRO da categoria é a que veio do banco (sortOrder, nome): o sort
 * do JavaScript é estável e só compara a categoria. Categoria sem cadastro vai
 * para o fim, em ordem alfabética entre si.
 */
export function ordenarComoALoja<T extends { category?: string | null }>(
  produtos: T[],
  ordem: Map<string, number>
): (T & { categoriaOrdem: number })[] {
  const FIM = 100000;
  const posicao = (p: T) => ordem.get(chaveDaCategoria(p.category)) ?? FIM;
  return produtos
    .map((p) => ({ ...p, categoriaOrdem: posicao(p) }))
    .sort(
      (a, b) =>
        a.categoriaOrdem - b.categoriaOrdem ||
        (a.categoriaOrdem === FIM ? String(a.category ?? "").localeCompare(String(b.category ?? ""), "pt-BR") : 0)
    );
}
