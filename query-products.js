const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  const products = await p.product.findMany({
    where: { active: true },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, description: true, price: true, category: true, franchiseOnly: true }
  });
  console.log(JSON.stringify(products, null, 2));
  await p.$disconnect();
}

main().catch(e => { console.error(e); p.$disconnect(); });
