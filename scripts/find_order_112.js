const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function findOrder112() {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const orders = await prisma.customerOrder.findMany({
        where: {
          createdAt: { gte: twoHoursAgo }
        },
        orderBy: { createdAt: 'desc' }
      });

      console.log(`Searching among ${orders.length} orders created in the last 2 hours...`);
      
      let found = false;
      for (const order of orders) {
        const ref = String(order.ifoodReference || '');
        const odRef = String(order.openDeliveryReference || '');
        const idStr = String(order.id);
        
        if (ref.includes('112') || odRef.includes('112') || idStr.includes('112')) {
          console.log(`\nMATCH FOUND:`);
          console.log(`ID: ${order.id}`);
          console.log(`Customer: ${order.customerName}`);
          console.log(`Source: ${order.source}`);
          console.log(`Ifood Ref: ${order.ifoodReference}`);
          console.log(`Open Del Ref: ${order.openDeliveryReference}`);
          console.log(`KDS Stage: ${order.kdsStage}`);
          console.log(`Status: ${order.status}`);
          console.log(`CreatedAt: ${order.createdAt}`);
          found = true;
        }
      }
      
      if (!found) console.log('No order containing "112" found in the last 2 hours.');
      return;
    } catch (error) {
      console.error(`Attempt ${attempt} failed: ${error.message}`);
      if (attempt < 3) await new Promise(r => setTimeout(r, 5000));
    }
  }
}

findOrder112().finally(() => prisma.$disconnect());
