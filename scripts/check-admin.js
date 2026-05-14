const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  const admins = await p.user.findMany({
    where: { role: 'ADMIN' },
    select: { name: true, email: true, role: true, createdAt: true }
  });
  console.log('\n=== ADMINS DO FIREHUB ===');
  console.log(JSON.stringify(admins, null, 2));

  const lojistas = await p.user.findMany({
    where: { role: 'FRANCHISEE' },
    select: { name: true, email: true, slug: true, storeName: true, createdAt: true, isFranqueadoHakim: true, mpSellerId: true, celcoinAccountId: true, mpAccessToken: true },
    orderBy: { createdAt: 'desc' },
    take: 10
  });
  console.log('\n=== ÚLTIMOS 10 LOJISTAS ===');
  lojistas.forEach(l => {
    console.log(`Nome: ${l.name} | Email: ${l.email} | Loja: ${l.storeName} | Criado: ${l.createdAt?.toLocaleDateString('pt-BR')} | Hakim: ${l.isFranqueadoHakim} | MP: ${l.mpSellerId ? 'SIM' : 'NÃO'} | Celcoin: ${l.celcoinAccountId ? 'SIM' : 'NÃO'}`);
  });

  await p.$disconnect();
}
main().catch(e => { console.error(e.message); p.$disconnect(); });
