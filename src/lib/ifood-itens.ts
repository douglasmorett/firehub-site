/**
 * src/lib/ifood-itens.ts
 *
 * Tradução dos itens de um pedido do iFood para o `create` aninhado do Prisma.
 *
 * ── Por que este arquivo existe ─────────────────────────────────────────────
 *
 * A mesma regra estava escrita SETE vezes (webhook, sync-orders, import-order,
 * rescue-orders, auth, poll e os dois blocos de ifood-eventos), e todas as sete
 * cópias tinham o mesmo defeito: o nome do item era jogado fora.
 *
 * O item chegava assim:
 *
 *     menuProduct: { connectOrCreate: { where: { id: `ifood-${i.id}` },
 *                                       create: { name: i.name, ... } } }
 *
 * `connectOrCreate` só usa o `create` quando o produto NÃO existe. Como o
 * `i.id` do iFood é o id do item no catálogo — estável entre pedidos —, o
 * espelho era criado no primeiro pedido daquele item e nunca mais tocado. O
 * nome impresso na comanda passava a ser o do banco, congelado na data da
 * criação, e não o que o iFood mandou naquele pedido.
 *
 * Foi assim que a Hakim Centro tirou as bebidas do combo no iFood, o iFood
 * passou a mandar "Combo 10 Esfirras Simples" — e a comanda continuou saindo
 * "Combo 10 Esfirras Simples + 2 Bebidas", o nome gravado em 22/08. As opções
 * do combo saíam certas (essas vêm do payload, em `comboSelections`); só o
 * nome do item pai vinha do cadastro velho. Pior: o nome velho tem a palavra
 * "Bebidas", que é o gatilho do aviso automático de bebida na comanda.
 *
 * ── O que mudou ─────────────────────────────────────────────────────────────
 *
 * 1. `productName` passa a guardar o nome que veio no payload. É o campo que já
 *    existia para isso ("preserva histórico") e que JotaJá e Brendi sempre
 *    preencheram; só o iFood não preenchia. Com ele, o pedido guarda o nome do
 *    dia em que foi feito — renomear o item amanhã não reescreve a comanda de
 *    ontem.
 *
 * 2. O espelho do catálogo é sincronizado: se o nome mudou no iFood, o
 *    MenuProduct `ifood-*` é atualizado. Só o nome — preço do espelho não é
 *    cobrança (a linha do pedido tem o seu próprio), e pedido com promoção
 *    gravaria preço promocional no cadastro. É o que faz o painel e a
 *    reimpressão de um pedido antigo pararem de mostrar o nome velho.
 *
 * O update é condicionado ao franqueado dono do produto: sem isso, um id de
 * catálogo repetido entre duas lojas deixaria uma renomear o produto da outra.
 */

import { prisma } from "./prisma";

/** Uma opção/complemento do item, como a comanda e o KDS leem. */
type OpcaoDoItem = { name: string; quantity: number; price: number };

/**
 * Opções do item no payload do iFood. O nome do campo muda conforme a versão da
 * API e o caminho de importação, por isso a lista de tentativas.
 */
function opcoesDoItem(i: any): OpcaoDoItem[] {
  const lista = i?.options || i?.subItems || i?.garnishItems || i?.items || [];
  if (!Array.isArray(lista) || lista.length === 0) return [];
  return lista
    .map((s: any) => ({
      name: s?.name || s?.label || s?.productName || "",
      quantity: s?.quantity || 1,
      price: s?.price || s?.unitPrice || s?.addition || 0,
    }))
    .filter((s: OpcaoDoItem) => s.name);
}

/** Nome do item como o iFood mandou. Nunca vem do nosso banco. */
export function nomeDoItemIfood(i: any): string {
  const nome = i?.name || i?.productName || i?.displayName || i?.title || i?.label || i?.description;
  return String(nome || "Item iFood").trim();
}

export type OpcoesDeMontagem = {
  /** Dono do pedido. Também é quem pode ter o nome do espelho atualizado. */
  franchiseeId: string;
  /**
   * ⚠️ `active` FOI REMOVIDO de propósito.
   *
   * O espelho nunca deve aparecer no cardápio — ele existe só para satisfazer
   * a relação obrigatória do item do pedido. Enquanto isso era escolha de quem
   * chamava, cinco caminhos criavam o espelho ativo e o cardápio da loja
   * enchia de itens vindos do iFood. Agora nasce sempre inativo e fora dos
   * quatro canais, e não há como um caminho novo errar de novo.
   */
  /** Prefixo do id do espelho. `auth` e `poll` aceitam externalCode como id. */
  idDoItem?: (i: any, idx: number) => string;
};

/**
 * Itens do iFood no formato de `create` aninhado do Prisma.
 *
 * É `async` porque, antes de montar a lista, corrige o nome do espelho de cada
 * item que já existe no catálogo. Criar o espelho continua sendo trabalho do
 * `connectOrCreate`, junto com o pedido.
 */
export async function montarItensDoPedidoIfood(
  rawItems: any[],
  { franchiseeId, idDoItem }: OpcoesDeMontagem
) {
  const { getIfoodItemUnitPrice } = await import("./ifood-api");
  const lista = Array.isArray(rawItems) ? rawItems : [];
  const itens: any[] = [];

  for (let idx = 0; idx < lista.length; idx++) {
    const i = lista[idx];
    const idBruto = idDoItem ? idDoItem(i, idx) : (i?.id ?? `sem-id-${idx}`);
    const produtoId = `ifood-${idBruto}`;
    const nome = nomeDoItemIfood(i);
    const precoUnitario = getIfoodItemUnitPrice(i);
    const opcoes = opcoesDoItem(i);

    await corrigirNomeDoEspelho(produtoId, nome, franchiseeId);

    itens.push({
      price: precoUnitario,
      quantity: i?.quantity ?? 1,
      // O nome do dia do pedido. É ele que a comanda, o KDS e o painel leem
      // primeiro — ver `nomeDoItem` em src/lib/nome-do-item.ts.
      productName: nome,
      // "sem cebola", "bem passado". O iFood manda por item e o campo existe
      // desde sempre no nosso item — só que nenhum caminho do iFood o
      // preenchia: a observação do cliente sobre O PRATO era descartada, e a
      // cozinha recebia a comanda sem ela. `delivery.observations`, que os
      // caminhos já liam, é outra coisa: é o recado do ENTREGADOR.
      notes: i?.observations || i?.specialInstructions || i?.notes || null,
      comboSelections: opcoes.length > 0 ? JSON.stringify(opcoes) : null,
      // Continua `connectOrCreate`, e não `connect`: assim o espelho nasce
      // dentro da mesma transação do pedido. Com `connect`, um espelho que
      // faltasse derrubaria a criação do pedido inteiro — e pedido do iFood que
      // não grava é pedido perdido. O que mudou é que o nome não depende mais
      // deste bloco: quando o produto já existe, quem cuida do nome é o
      // `corrigirNomeDoEspelho` acima.
      menuProduct: {
        connectOrCreate: {
          where: { id: produtoId },
          // ⚠️ REGRA MÁXIMA: pedido de integração NÃO POLUI O CARDÁPIO.
          //
          // Este produto é um ESPELHO — existe só porque `CustomerOrderItem`
          // exige um `menuProductId`, e sem ele o pedido do iFood não grava.
          // Ele nunca foi cardápio da loja: é o item como o iFood mandou.
          //
          // Nascia ATIVO em cinco dos oito caminhos de importação
          // (import-order, rescue-orders, sync-orders, webhook e o de
          // cancelamento), e o resultado era uma categoria "iFood" enchendo o
          // cardápio de itens que o lojista nunca cadastrou — 16 deles só na
          // Ragnar. O parâmetro `active` saiu de propósito: não existe caminho
          // em que um espelho deva aparecer para o cliente, então isso deixou
          // de ser escolha de quem chama.
          create: {
            id: produtoId,
            franchiseeId,
            name: nome,
            description: "",
            price: precoUnitario,
            category: "iFood",
            active: false,
            activePDV: false,
            activeDelivery: false,
            activeTotem: false,
            activeGarcom: false,
          },
        },
      },
    });
  }

  return itens;
}

/**
 * Corrige o nome do espelho quando o item foi renomeado no iFood.
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
async function corrigirNomeDoEspelho(produtoId: string, nome: string, franchiseeId: string) {
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
    console.warn("[iFood] Nao consegui atualizar o nome do espelho", produtoId, err?.message);
  }
}
