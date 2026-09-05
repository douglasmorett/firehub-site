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
  priceSalao: true, priceDelivery: true, priceTotem: true,
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
  return aplicarPrecoNoCardapio(produtos as any[], canal);
}
