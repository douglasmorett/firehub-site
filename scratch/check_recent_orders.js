const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const aWhileAgo = new Date(Date.now() - 4 * 60 * 60 * 1000); // last 4 hours

async function main() {
  const res = await p.customerOrder.findMany({ 
    where: { 
      createdAt: { gte: aWhileAgo }
    }, 
    orderBy: { createdAt: 'desc' },
    select: { id: true, status: true, customerName: true, dailyOrderNumber: true, openDeliveryChannel: true, openDeliveryReference: true, ifoodReference: true, createdAt: true, cancelledBy: true, notes: true } 
  });
  console.log(JSON.stringify(res, null, 2));
}

main().catch(console.error).finally(() => p.$disconnect());
