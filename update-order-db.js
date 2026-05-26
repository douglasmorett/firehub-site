const { PrismaClient } = require('@prisma/client');

async function main() {
  const prisma = new PrismaClient();
  
  try {
    // Find the order that ends with G65EYO
    const orders = await prisma.order.findMany({
      where: {
        id: { endsWith: 'g65eyo' }
      },
      select: { id: true, status: true, boletoUrl: true, asaasPaymentId: true, totalAmount: true }
    });
    
    // Also try uppercase
    const orders2 = await prisma.order.findMany({
      where: {
        id: { contains: 'g65eyo' }
      },
      select: { id: true, status: true, boletoUrl: true, asaasPaymentId: true, totalAmount: true }
    });
    
    const allOrders = [...orders, ...orders2];
    
    if (allOrders.length === 0) {
      // Try case insensitive with raw SQL
      console.log("Buscando com ILIKE...");
      const rawOrders = await prisma.$queryRaw`SELECT id, status, "boletoUrl", "asaasPaymentId", "totalAmount" FROM "Order" WHERE UPPER(id) LIKE '%G65EYO%'`;
      console.log("Raw results:", rawOrders);
      
      if (rawOrders.length > 0) {
        const order = rawOrders[0];
        console.log(`Pedido encontrado: ${order.id} | Status: ${order.status} | Total: ${order.totalAmount}`);
        
        await prisma.order.update({
          where: { id: order.id },
          data: {
            boletoUrl: "https://www.asaas.com/i/c5wj5psec02uzabf",
            asaasPaymentId: "pay_c5wj5psec02uzabf"
          }
        });
        console.log("✅ Pedido atualizado com link de pagamento!");
      }
    } else {
      const order = allOrders[0];
      console.log(`Pedido encontrado: ${order.id} | Status: ${order.status} | Total: ${order.totalAmount}`);
      
      await prisma.order.update({
        where: { id: order.id },
        data: {
          boletoUrl: "https://www.asaas.com/i/c5wj5psec02uzabf",
          asaasPaymentId: "pay_c5wj5psec02uzabf"
        }
      });
      console.log("✅ Pedido atualizado com link de pagamento!");
    }
  } catch (error) {
    console.error("Erro:", error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
