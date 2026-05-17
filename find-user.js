const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  const users = await p.user.findMany({
    where: { role: 'FRANCHISEE' },
    select: { id: true, name: true, email: true, storeName: true, isFranqueadoHakim: true },
    orderBy: { name: 'asc' }
  });
  console.log('Total FRANCHISEE:', users.length);
  users.forEach(u => {
    console.log(`- ${u.name || '(sem nome)'} | ${u.storeName || '(sem loja)'} | ${u.email} | Hakim: ${u.isFranqueadoHakim}`);
  });
  await p.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
