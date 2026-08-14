const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  const today = new Date();
  today.setHours(0,0,0,0);
  
  const orders = await p.customerOrder.findMany({
    where: { 
      createdAt: { gte: today },
      dailyOrderNumber: 80
    }
  });
  console.log("Orders with dailyOrderNumber = 80:");
  console.log(JSON.stringify(orders, null, 2));

  // Also check if any order has ifoodReference or openDeliveryReference ending in 80
  const orders80 = await p.customerOrder.findMany({
    where: { 
      createdAt: { gte: today },
      OR: [
        { ifoodReference: { endsWith: '80' } },
        { openDeliveryReference: { endsWith: '80' } }
      ]
    }
  });
  console.log("\nOrders ending with 80 in reference:");
  console.log(JSON.stringify(orders80.map(o => ({ id: o.id, ref: o.ifoodReference || o.openDeliveryReference, name: o.customerName })), null, 2));
}

main().catch(console.error).finally(() => p.$disconnect());
