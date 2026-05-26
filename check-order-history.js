const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  const orderId = 'cmpd0ng0e0001uj8o8hrmuebo';
  const order = await p.order.findUnique({
    where: { id: orderId },
    include: {
      history: true
    }
  });
  console.log("ORDER:", JSON.stringify(order, null, 2));
}

main().catch(console.error).finally(() => p.$disconnect());
