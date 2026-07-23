const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  const users = await p.user.findMany({
    select: { id: true, email: true, name: true, jotajaMerchantId: true, jotajaConnected: true }
  });
  console.log('=== USERS ===');
  users.forEach(u => console.log(u.email, '| jotajaMerchantId:', u.jotajaMerchantId || 'NULL', '| connected:', u.jotajaConnected));

  const orders = await p.customerOrder.findMany({
    where: { source: 'JOTAJA' },
    take: 3,
    orderBy: { createdAt: 'desc' },
    select: { id: true, openDeliveryOrderId: true, status: true }
  });
  console.log('\n=== JOTAJA ORDERS ===');
  console.log('Count:', orders.length);
  orders.forEach(o => console.log(o));

  await p.$disconnect();
}
main().catch(e => { console.error(e.message); p.$disconnect(); });
