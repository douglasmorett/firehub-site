import { prisma } from "./prisma";

/**
 * Realiza a baixa automática do estoque com base nas fichas técnicas (receitas)
 * dos produtos vinculados a um pedido.
 * 
 * @param orderId ID do pedido finalizado/aceito
 */
export async function deductStockForOrder(orderId: string) {
  try {
    // 1. Verificar idempotência (não dar baixa duas vezes no mesmo pedido)
    const alreadyDeducted = await prisma.stockTransaction.findFirst({
      where: {
        type: "SALE",
        notes: { contains: orderId }
      }
    });

    if (alreadyDeducted) {
      console.log(`[Stock] Baixa de estoque já processada anteriormente para o pedido: ${orderId}`);
      return;
    }

    // 2. Buscar o pedido e seus itens com a ficha técnica (recipeItems) e ingredientes (stockItem)
    const order = await prisma.customerOrder.findUnique({
      where: { id: orderId },
      include: {
        items: {
          include: {
            menuProduct: {
              include: {
                recipeItems: {
                  include: {
                    stockItem: true
                  }
                }
              }
            }
          }
        }
      }
    });

    if (!order) {
      console.error(`[Stock] Pedido não encontrado para baixa de estoque: ${orderId}`);
      return;
    }

    console.log(`[Stock] Processando baixa do pedido #${order.id.slice(-6)} (${order.customerName})`);

    // 3. Loop pelos itens do pedido
    for (const item of order.items) {
      const menuProduct = item.menuProduct;
      if (!menuProduct) continue;

      const recipeItems = menuProduct.recipeItems;
      if (!recipeItems || recipeItems.length === 0) {
        console.log(`[Stock] Produto "${menuProduct.name}" não possui ficha técnica vinculada.`);
        continue;
      }

      // 4. Deduzir a quantidade de cada ingrediente
      for (const recipeItem of recipeItems) {
        const amountToDeduct = recipeItem.quantityConsumed * item.quantity;
        
        console.log(
          `[Stock] Deduzindo ${amountToDeduct}${recipeItem.stockItem.unit} de "${recipeItem.stockItem.name}" para ${item.quantity}x "${menuProduct.name}"`
        );

        // Criar transação de estoque
        await prisma.stockTransaction.create({
          data: {
            stockItemId: recipeItem.stockItemId,
            quantity: -amountToDeduct,
            type: "SALE",
            notes: `Baixa automática - Pedido #${order.id.slice(-6)} (id: ${order.id})`
          }
        });

        // Atualizar saldo do ingrediente
        await prisma.stockItem.update({
          where: { id: recipeItem.stockItemId },
          data: {
            quantity: {
              decrement: amountToDeduct
            }
          }
        });
      }
    }
  } catch (error) {
    console.error(`[Stock] Erro ao realizar baixa de estoque para pedido ${orderId}:`, error);
  }
}
