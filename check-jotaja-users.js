const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const users = await p.user.findMany({
    where: { NOT: { jotajaClientId: null } },
    select: { id: true, email: true, name: true, jotajaClientId: true, jotajaClientSecret: true, jotajaConnected: true, jotajaMerchantId: true }
  });
  console.log('Usuários com jotajaClientId preenchido:', users.length);
  for (const u of users) {
    console.log(`  ${u.email} | clientId: ${u.jotajaClientId} | secret: ${u.jotajaClientSecret?.slice(0,8)}... | connected: ${u.jotajaConnected} | merchantId: ${u.jotajaMerchantId}`);
  }
  await p.$disconnect();
})();
