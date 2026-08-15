const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const order = await prisma.order.findUnique({
    where: { id: 'IHLRX7' }
  });
  console.log(order);
}
main().catch(console.error).finally(() => prisma.$disconnect());
