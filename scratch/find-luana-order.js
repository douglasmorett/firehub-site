const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { email: { contains: 'hakim', mode: 'insensitive' } },
        { jotajaConnected: true },
        { role: { in: ['FRANQUEADO', 'ADMIN', 'LOJA', 'FRANCHISEE', 'STAFF'] } }
      ]
    },
    select: { id: true, email: true, role: true, ownerId: true }
  });
  console.log('USERS:', JSON.stringify(users, null, 2));

  const luana = await prisma.customerOrder.findMany({
    where: {
      OR: [
        { openDeliveryOrderId: '32516601' },
        { openDeliveryReference: '2316' },
        { customerPhone: '22992536804' }
      ]
    },
    select: { id: true, franchiseeId: true, customerName: true, status: true, createdAt: true }
  });
  console.log('LUANA ORDERS IN DB:', JSON.stringify(luana, null, 2));
}

main().finally(() => prisma.$disconnect());
