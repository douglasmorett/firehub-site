const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function listLatestOrders() {
  try {
    const orders = await prisma.customerOrder.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10
    });

    console.log(`Found ${orders.length} recent orders.`);
    for (const order of orders) {
      console.log(`ID: ${order.id} | Source: ${order.source} | Ref: ${order.ifoodReference} | OpenDelRef: ${order.openDeliveryReference} | KDS Stage: ${order.kdsStage} | Status: ${order.status}`);
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

listLatestOrders();
