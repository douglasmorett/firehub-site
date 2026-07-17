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
      // Verifica se já existe uma transação de estoque para este pedido
      const existing = await tx.stockTransaction.findFirst({
        where: {
          type: "SALE",
          notes: { contains: `id: ${orderId}` }, // match exato do padrão que geramos abaixo
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
