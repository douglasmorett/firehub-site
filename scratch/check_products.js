require('dotenv').config({ path: '.env' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  const users = await prisma.user.findMany({
    select: { id: true, storeName: true, slug: true, chatbotConfig: true }
  });
  console.log('USERS:', JSON.stringify(users, null, 2));

  const products = await prisma.menuProduct.findMany({
    select: { id: true, name: true, price: true, category: true, availableDays: true, tags: true, franchiseeId: true }
  });
  console.log('TOTAL PRODUCTS:', products.length);
  
  const cheapProducts = products.filter(p => p.price <= 4 || (p.name && p.name.includes('1,90')) || (p.tags && JSON.stringify(p.tags).includes('1,90')));
  console.log('PRODUCTS <= R$ 4,00 or tagged 1.90:', JSON.stringify(cheapProducts, null, 2));

  await prisma.$disconnect();
}

run().catch(console.error);
