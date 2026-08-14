const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  const vitor = await p.customerOrder.findFirst({ where: { ifoodReference: '8062' } });
  const adrianne = await p.customerOrder.findFirst({ where: { ifoodReference: '5109' } });
  
  if (!vitor || !adrianne) {
    console.log("Could not find base orders");
    return;
  }
  
  console.log("Vitor (#78):", vitor.createdAt);
  console.log("Adrianne (#79):", adrianne.createdAt);
  
  const ordersAfter = await p.customerOrder.findMany({
    where: { 
      createdAt: { gte: adrianne.createdAt },
      franchiseeId: vitor.franchiseeId
    },
    orderBy: { createdAt: 'asc' },
    take: 5,
    select: { id: true, customerName: true, status: true, ifoodReference: true, openDeliveryReference: true, createdAt: true, cancelledBy: true }
  });
  
  console.log("\nOrders immediately after Adrianne:");
  console.log(JSON.stringify(ordersAfter, null, 2));
}

main().catch(console.error).finally(() => p.$disconnect());
