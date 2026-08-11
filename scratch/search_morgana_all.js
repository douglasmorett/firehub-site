const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const orders = await prisma.customerOrder.findMany({
    where: {
      OR: [
        { customerName: { contains: 'Morgana', mode: 'insensitive' } },
        { customerName: { contains: 'Morgan', mode: 'insensitive' } },
        { notes: { contains: 'Morgana', mode: 'insensitive' } }
      ]
    },
    include: { motoboy: true, franchisee: true },
    orderBy: { createdAt: 'desc' }
  });

  console.log('=== BUSCA GERAL MORGANA ===');
  console.log(`Encontrados: ${orders.length} pedidos`);
  orders.forEach(o => {
    console.log({
      id: o.id,
      store: o.franchisee ? o.franchisee.storeName : o.franchiseeId,
      customerName: o.customerName,
      status: o.status,
      dailyOrderNumber: o.dailyOrderNumber,
      ifoodReference: o.ifoodReference,
      openDeliveryReference: o.openDeliveryReference,
      motoboyId: o.motoboyId,
      motoboyName: o.motoboy ? o.motoboy.name : 'SEM MOTOBOY',
      createdAt: o.createdAt
    });
  });
}

main().finally(() => prisma.$disconnect());
