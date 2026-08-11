const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const alexandre = await prisma.motoboy.findFirst({
    where: { name: { contains: 'Alexandre', mode: 'insensitive' } }
  });

  if (!alexandre) {
    console.log('Motoboy Alexandre não encontrado!');
    return;
  }

  console.log(`=== MOTOBOY: ${alexandre.name} (ID: ${alexandre.id}) ===`);

  const orders = await prisma.customerOrder.findMany({
    where: { motoboyId: alexandre.id },
    orderBy: { createdAt: 'desc' },
    take: 20
  });

  console.log(`Encontrados ${orders.length} pedidos para o Alexandre:`);
  orders.forEach(o => {
    console.log({
      id: o.id,
      customerName: o.customerName,
      status: o.status,
      createdAtISO: o.createdAt.toISOString(),
      createdAtLocal: o.createdAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
      ifoodRef: o.ifoodReference,
      openDeliveryRef: o.openDeliveryReference,
    });
  });
}

main().finally(() => prisma.$disconnect());
