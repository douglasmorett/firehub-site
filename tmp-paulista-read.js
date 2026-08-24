const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const users = await p.user.findMany({
    where: { OR: [
      { storeName: { contains: 'aulista', mode: 'insensitive' } },
      { name: { contains: 'aulista', mode: 'insensitive' } },
      { email: { contains: 'paulista', mode: 'insensitive' } },
    ]},
    select: { id: true, name: true, email: true, storeName: true, role: true },
  });
  console.log(JSON.stringify(users, null, 2));
  await p.$disconnect();
})().catch(async e => { console.error(e.message); await p.$disconnect(); process.exit(1); });
