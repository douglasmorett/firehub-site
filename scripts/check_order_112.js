const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkOrder112() {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const orders = await prisma.customerOrder.findMany({
        where: {
          OR: [
            { ifoodReference: '112' },
            { ifoodReference: '#112' },
            { openDeliveryReference: '112' },
            { openDeliveryReference: '#112' },
            { id: { endsWith: '112' } }
          ]
        },
        orderBy: { createdAt: 'desc' },
        take: 5
      });

      if (orders.length > 0) {
        console.log(`Found ${orders.length} orders with sequenceId/dailyOrderNumber 112.`);
        for (const order of orders) {
          console.log(`Order ID: ${order.id}`);
          console.log(`Customer: ${order.customerName}`);
          console.log(`Status: ${order.status}`);
          console.log(`CreatedAt: ${order.createdAt}`);
          console.log(`Is Active: ${order.isActive}`);
          console.log(`Completed At: ${order.completedAt}`);
          console.log(`Source: ${order.source}`);
          console.log(`Ifood Ref: ${order.ifoodReference}`);
          console.log(`Daily Order Number: ${order.dailyOrderNumber}`);
          console.log('-----------------------------------');
        }
      } else {
        console.log('Order 112 not found at all.');
      }
      return; // Success, exit loop
    } catch (error) {
      console.error(`Attempt ${attempt} failed: ${error.message}`);
      if (attempt < 3) {
        console.log('Retrying in 5 seconds...');
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  }
}

checkOrder112().finally(() => prisma.$disconnect());
