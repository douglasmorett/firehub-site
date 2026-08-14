const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  const res = await p.customerOrder.findMany({ 
    where: { dailyOrderNumber: 80 }, 
    orderBy: { createdAt: 'desc' }, 
    take: 5, 
    select: { id: true, status: true, customerName: true, createdAt: true, dailyOrderNumber: true } 
  });
  console.log(JSON.stringify(res, null, 2));
}

main().catch(console.error).finally(() => p.$disconnect());
