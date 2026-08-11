const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const startOfDay = new Date('2026-08-01T00:00:00-03:00');
  
  const orders = await prisma.customerOrder.findMany({
    where: {
      createdAt: { gte: startOfDay },
      OR: [
        { ifoodReference: '176' },
        { openDeliveryReference: '176' },
        { id: { contains: '176' } },
        { customerName: { contains: 'Morgan', mode: 'insensitive' } }
      ]
    },
    include: { motoboy: true, franchisee: true },
    orderBy: { createdAt: 'desc' },
  });

  console.log('=== PEDIDO 176 OU MORGANA ===');
  orders.forEach((o, idx) => {
    console.log({
      id: o.id,
      store: o.franchisee ? o.franchisee.storeName : o.franchiseeId,
      customerName: o.customerName,
      status: o.status,
      dailyOrderNumber: o.dailyOrderNumber,
      ifoodReference: o.ifoodReference,
      openDeliveryReference: o.openDeliveryReference,
      motoboyId: o.motoboyId,
      motoboyName: o.motoboy ? o.motoboy.name : null,
      createdAt: o.createdAt
    });
  });

  if (orders.length === 0) {
    console.log("Buscando últimos 20 pedidos criados hoje...");
    const recentToday = await prisma.customerOrder.findMany({
      where: { createdAt: { gte: startOfDay } },
      include: { motoboy: true },
      orderBy: { createdAt: 'desc' },
      take: 20
    });
    recentToday.forEach(o => console.log(`#${o.dailyOrderNumber || o.ifoodReference || o.openDeliveryReference} - ${o.customerName} (Status: ${o.status}, Motoboy: ${o.motoboy ? o.motoboy.name : 'Nenhum'})`));
  }
}

main().finally(() => prisma.$disconnect());
