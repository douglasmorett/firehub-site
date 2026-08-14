const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  const o = await p.customerOrder.findUnique({ 
    where: { id: 'cmss6quf4000ikw04vdehys9y' },
    include: { items: true }
  });
  console.log("Order 80:", JSON.stringify(o, null, 2));

  // Check if any other order from today had "80" in the KDS?
  const today = new Date();
  today.setHours(0,0,0,0);
  
  const kdsOrders = await p.customerOrder.findMany({
    where: { 
      createdAt: { gte: today },
      status: { in: ["NOVO", "ACEITO", "PREPARANDO"] }
    },
    select: { id: true, dailyOrderNumber: true, customerName: true, ifoodReference: true, openDeliveryReference: true, createdAt: true }
  });
  console.log("\nCurrent KDS Orders (NOVO, ACEITO, PREPARANDO):");
  console.log(JSON.stringify(kdsOrders, null, 2));
}

main().catch(console.error).finally(() => p.$disconnect());
