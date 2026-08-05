const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const startOfDay = new Date('2026-08-01T00:00:00-03:00');
  const canceledOrders = await prisma.customerOrder.findMany({
    where: {
      createdAt: { gte: startOfDay },
      status: { in: ['CANCELADO', 'CANCELED'] }
    },
    include: { motoboy: true, franchisee: true },
    orderBy: { createdAt: 'desc' }
  });

  console.log(`=== PEDIDOS CANCELADOS HOJE (${canceledOrders.length}) ===`);
  canceledOrders.forEach(o => {
    console.log({
      id: o.id,
      store: o.franchisee ? o.franchisee.storeName : o.franchiseeId,
      customerName: o.customerName,
      status: o.status,
      ifoodReference: o.ifoodReference,
      openDeliveryReference: o.openDeliveryReference,
      motoboyId: o.motoboyId,
      motoboyName: o.motoboy ? o.motoboy.name : 'SEM MOTOBOY',
      createdAt: o.createdAt
    });
  });
}

main().finally(() => prisma.$disconnect());
