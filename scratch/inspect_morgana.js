const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const orders = await prisma.customerOrder.findMany({
    where: {
      customerName: { contains: 'Morgana', mode: 'insensitive' }
    },
    include: { motoboy: true },
    orderBy: { createdAt: 'desc' },
    take: 5
  });

  console.log('=== PEDIDOS DA MORGANA ===');
  orders.forEach(o => {
    console.log({
      id: o.id,
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
}

main().finally(() => prisma.$disconnect());
