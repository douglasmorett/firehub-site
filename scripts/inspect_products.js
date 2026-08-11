const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const products = await prisma.menuProduct.groupBy({
    by: ['franchiseeId'],
    _count: { id: true }
  });
  console.log("Products per franchisee:", products);
}

main().catch(console.error).finally(() => prisma.$disconnect());
