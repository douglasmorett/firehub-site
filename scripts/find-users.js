const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

prisma.user.findMany({
  where: { role: 'FRANCHISEE' },
  select: { name: true, email: true, slug: true, storeName: true },
  take: 5
}).then(users => {
  console.log('\n=== USUÁRIOS FRANCHISEE ===');
  users.forEach(u => {
    console.log('Email:', u.email);
    console.log('Loja:', u.storeName || u.slug);
    console.log('---');
  });
  return prisma.$disconnect();
}).catch(e => {
  console.error(e.message);
  return prisma.$disconnect();
});
