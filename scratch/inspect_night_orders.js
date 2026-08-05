const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const startOfNight = new Date('2026-08-01T20:00:00-03:00');
  const orders = await prisma.customerOrder.findMany({
    where: { createdAt: { gte: startOfNight } },
    include: { motoboy: true },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`=== PEDIDOS DA NOITE (${orders.length}) ===`);
  orders.forEach((o, idx) => {
    const localTime = o.createdAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    console.log({
      seq: idx + 1,
      id: o.id,
      customerName: o.customerName,
      status: o.status,
      createdAtLocal: localTime,
      ifoodRef: o.ifoodReference,
      openDeliveryRef: o.openDeliveryReference,
    });
  });
}

main().finally(() => prisma.$disconnect());
