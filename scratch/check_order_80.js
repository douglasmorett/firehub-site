const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const yesterday = new Date();
yesterday.setDate(yesterday.getDate() - 2); // Check last 48 hours

async function main() {
  const res = await p.customerOrder.findMany({ 
    where: { 
      createdAt: { gte: yesterday }, 
      OR: [
        { dailyOrderNumber: 80 }, 
        { ifoodReference: { contains: '80' } }, 
        { openDeliveryReference: { contains: '80' } },
        { id: { contains: '80' } }
      ] 
    }, 
    select: { 
      id: true, 
      status: true, 
      customerName: true, 
      dailyOrderNumber: true, 
      openDeliveryChannel: true, 
      ifoodReference: true, 
      openDeliveryReference: true, 
      createdAt: true, 
      cancelledBy: true, 
      notes: true 
    } 
  });
  console.log(JSON.stringify(res, null, 2));
}

main().catch(console.error).finally(() => p.$disconnect());
