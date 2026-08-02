const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    select: { id: true, storeName: true, slug: true }
  });
  console.log("USERS:", users);

  const products = await prisma.menuProduct.findMany({
    where: { active: true },
    select: { id: true, name: true, price: true, category: true, availableDays: true, isCombo: true, franchiseeId: true }
  });

  console.log("\nPRODUCTS COUNT:", products.length);
  products.forEach(p => {
    console.log(`- [${p.franchiseeId}] ${p.name} (${p.category}): R$ ${p.price} | availableDays: ${JSON.stringify(p.availableDays)}`);
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());
