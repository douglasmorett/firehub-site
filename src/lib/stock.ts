import { prisma } from "./prisma";

/**
 * Realiza a baixa automática do estoque com base nas fichas técnicas (receitas)
 * dos produtos vinculados a um pedido.
 *
 * Idempotente: verifica campo `stockDeductedForOrderId` na CustomerOrder
 * para garantir que o estoque só seja debitado uma vez por pedido,
 * mesmo com chamadas concorrentes.
 *
 * @param orderId ID do pedido aceito
 */
export async function deductStockForOrder(orderId: string) {
  try {
    // Checar e marcar atomicamente usando updateMany com condição.
    // Se `stockDeductedForOrderId` já estiver preenchido, o count será 0 e paramos.
    // Nota: usamos o campo `cancelReason` como flag temporária se o schema
    // ainda não tiver o campo dedicado — preferimos adicionar campo ao schema.
    // Por ora, usamos a abordagem de transaction com findFirst + create único.

    // Verificar idempotência com transação atômica
    const result = await prisma.$transaction(async (tx) => {
      // A devolução por cancelamento desfaz a baixa, então a venda antiga
      // sozinha não prova mais que o insumo está fora do saldo: o pedido
      // cancelado e depois reaceito (a tela de pedidos deixa voltar de
      // CANCELADO para ACEITO) já teve o insumo devolvido, e se pularmos a
      // baixa aqui ele fica no estoque para sempre. Só conta como já baixado
      // quem tem venda posterior à última devolução deste pedido.
      const ultimaDevolucao = await tx.stockTransaction.findFirst({
        where: {
          type: "INPUT",
          notes: { contains: `cancel id: ${orderId}` },
        },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });

      // Verifica se já existe uma transação de estoque para este pedido
      const existing = await tx.stockTransaction.findFirst({
        where: {
          type: "SALE",
          notes: { contains: `id: ${orderId}` }, // match exato do padrão que geramos abaixo
          ...(ultimaDevolucao ? { createdAt: { gt: ultimaDevolucao.createdAt } } : {}),
        },
        select: { id: true },
      });

      if (existing) {
        return { skipped: true };
      }

      // Buscar o pedido e seus itens com receitas
      const order = await tx.customerOrder.findUnique({
        where: { id: orderId },
        include: {
          items: {
            include: {
              menuProduct: {
                include: {
                  recipeItems: {
                    include: { stockItem: true },
                  },
                },
              },
            },
          },
        },
      });

      if (!order) {
        console.error(`[Stock] Pedido não encontrado: ${orderId}`);
        return { skipped: true };
      }

      let deducted = false;

      for (const item of order.items) {
        const menuProduct = item.menuProduct;
        if (!menuProduct) continue;

        const recipeItems = menuProduct.recipeItems;
        if (!recipeItems || recipeItems.length === 0) {
          console.log(`[Stock] Produto "${menuProduct.name}" sem ficha técnica.`);
          continue;
        }

        for (const recipeItem of recipeItems) {
          const amountToDeduct = recipeItem.quantityConsumed * item.quantity;

          console.log(
            `[Stock] Deduzindo ${amountToDeduct}${recipeItem.stockItem.unit} de "${recipeItem.stockItem.name}" para ${item.quantity}x "${menuProduct.name}"`
          );

          await tx.stockTransaction.create({
            data: {
              stockItemId: recipeItem.stockItemId,
              quantity: -amountToDeduct,
              type: "SALE",
              notes: `Baixa automática - Pedido #${order.id.slice(-6)} (id: ${order.id})`,
            },
          });

          await tx.stockItem.update({
            where: { id: recipeItem.stockItemId },
            data: { quantity: { decrement: amountToDeduct } },
          });

          deducted = true;
        }
      }

      return { skipped: false, deducted };
    });

    if (result.skipped) {
      console.log(`[Stock] Baixa já processada para pedido: ${orderId}`);
    } else {
      console.log(`[Stock] Baixa concluída para pedido #${orderId.slice(-6)}`);
    }
  } catch (error) {
    console.error(`[Stock] Erro ao realizar baixa de estoque para pedido ${orderId}:`, error);
  }
}

/**
 * Devolve ao estoque os insumos que a baixa automática consumiu, quando o
 * pedido acaba cancelado. Sem isso o saldo fica furado: o insumo saiu do
 * sistema mas voltou para a prateleira, e o lojista só descobre no inventário.
 *
 * Idempotente por conta própria (não depende da guarda da baixa): a devolução
 * grava a marca `cancel id: {orderId}` nas notas e só devolve as baixas
 * gravadas depois da última marca dessas — o mesmo pedido pode ser cancelado
 * pelo painel e pelo marketplace com segundos de diferença, e cada chamada
 * cai aqui.
 *
 * O `type` gravado é "INPUT" e não "RETURN": StockTransaction.type é texto
 * livre no schema, mas o vocabulário documentado lá (e o único que a tela de
 * Estoque traduz em badge) é INPUT/OUTPUT/SALE/WASTE — um "RETURN" apareceria
 * cru em inglês no histórico do lojista. Quem identifica a devolução é a nota.
 *
 * @param orderId ID do pedido cancelado
 */
export async function restoreStockForOrder(orderId: string) {
  try {
    const result = await prisma.$transaction(async (tx) => {
      // Quando foi a última devolução deste pedido, se é que houve alguma.
      const ultimaDevolucao = await tx.stockTransaction.findFirst({
        where: {
          type: "INPUT",
          notes: { contains: `cancel id: ${orderId}` }, // match exato do padrão que geramos abaixo
        },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });

      // As baixas do pedido são a fonte da verdade do que devolver: usar de novo
      // a ficha técnica do produto devolveria a receita de hoje, que pode ter
      // mudado depois que o pedido entrou.
      //
      // Entram só as baixas posteriores à última devolução. Isso resolve os dois
      // lados de uma vez: o cancelamento que chega em duplicidade (painel e
      // marketplace mandam os dois com segundos de diferença) não acha baixa
      // nova e devolve zero, e o pedido que foi cancelado, reaceito e cancelado
      // de novo baixou duas vezes e precisa ser devolvido nas duas.
      const sales = await tx.stockTransaction.findMany({
        where: {
          type: "SALE",
          notes: { contains: `id: ${orderId}` },
          ...(ultimaDevolucao ? { createdAt: { gt: ultimaDevolucao.createdAt } } : {}),
        },
        select: { stockItemId: true, quantity: true },
      });

      // Pedido cancelado antes do ACEITO nunca baixou nada — não é erro.
      if (sales.length === 0) {
        return { skipped: Boolean(ultimaDevolucao), restored: 0 };
      }

      let restored = 0;

      for (const sale of sales) {
        // A baixa grava quantidade negativa; o módulo protege contra registro
        // que alguém tenha gravado positivo na mão.
        const amountToRestore = Math.abs(sale.quantity);
        if (amountToRestore === 0) continue;

        await tx.stockTransaction.create({
          data: {
            stockItemId: sale.stockItemId,
            quantity: amountToRestore,
            type: "INPUT",
            notes: `Devolução por cancelamento - Pedido #${orderId.slice(-6)} (cancel id: ${orderId})`,
          },
        });

        await tx.stockItem.update({
          where: { id: sale.stockItemId },
          data: { quantity: { increment: amountToRestore } },
        });

        restored++;
      }

      return { skipped: false, restored };
    });

    if (result.skipped) {
      console.log(`[Stock] Devolução já processada para pedido: ${orderId}`);
    } else if (result.restored === 0) {
      console.log(`[Stock] Nada a devolver no pedido #${orderId.slice(-6)} (sem baixa registrada)`);
    } else {
      console.log(`[Stock] Devolução concluída para pedido #${orderId.slice(-6)} (${result.restored} insumo(s))`);
    }
  } catch (error) {
    console.error(`[Stock] Erro ao devolver estoque do pedido ${orderId}:`, error);
  }
}
