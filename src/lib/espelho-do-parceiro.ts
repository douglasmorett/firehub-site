/**
 * src/lib/espelho-do-parceiro.ts
 *
 * O produto-ESPELHO de um item de parceiro (iFood, Brendi, JotaJá): existe só
 * porque `CustomerOrderItem` exige um `menuProductId`. Nasce inativo, fora do
 * cardápio, com o id do item no catálogo do parceiro (`ifood-<id>`,
 * `brendi-<id>`, `jotaja-<id>`) — estável entre pedidos.
 *
 * Duas regras, as mesmas para todo parceiro:
 *
 *   1. O nome do espelho é o nome BASE do item ("Box de Frango P + molho"),
 *      nunca o nome com as opções daquele pedido. Foi assim que a Frangoso viu
 *      a comanda "trocada" (27/09/2026): o espelho da Brendi nascia com
 *      "Box de Frango P + molho | Peito de frango | Maionese de Bacon" — as
 *      opções do PRIMEIRO pedido — e os 71 pedidos seguintes do mesmo produto
 *      conectavam nele. O Assistente imprime `menuProduct.name` no cabeçalho
 *      do item e as opções deste pedido embaixo: saía mandioquinha no
 *      cabeçalho e batata frita nas linhas (ou o contrário).
 *
 *   2. `connectOrCreate` só cria; quando o espelho já existe, quem cuida do
 *      nome é `corrigirNomeDoEspelho` — o item renomeado no parceiro passa a
 *      valer aqui também. O nome do dia de cada pedido mora em `productName`.
 */
import { prisma } from "./prisma";

/**
 * Corrige o nome do espelho quando o item foi renomeado no parceiro (ou nasceu
 * com as opções no nome, antes desta regra).
 *
 * Só toca em produto que JÁ existe — quem cria é o `connectOrCreate` do item,
 * dentro da transação do pedido. Lê antes de escrever de propósito: o caso
 * comum é o nome não ter mudado, e aí não há escrita nenhuma.
 *
 * O update é condicionado ao franqueado dono do produto. Sem isso, um id de
 * catálogo repetido entre duas lojas deixaria uma renomear o produto da outra.
 *
 * Falhar aqui não pode custar o pedido: o nome do pedido já está garantido em
 * `productName`, e este espelho é só o cadastro que as telas de catálogo leem.
 */
export async function corrigirNomeDoEspelho(produtoId: string, nome: string, franchiseeId: string, rotulo = "Parceiro") {
  try {
    const existente = await (prisma.menuProduct as any).findUnique({
      where: { id: produtoId },
      select: { name: true, franchiseeId: true },
    });
    if (!existente) return;
    if (existente.name === nome) return;
    if (existente.franchiseeId !== franchiseeId) return;

    await (prisma.menuProduct as any).update({
      where: { id: produtoId },
      data: { name: nome },
    });
  } catch (err: any) {
    console.warn(`[${rotulo}] Nao consegui atualizar o nome do espelho`, produtoId, err?.message);
  }
}
