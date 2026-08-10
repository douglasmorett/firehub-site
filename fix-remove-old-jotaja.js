/**
 * fix-remove-old-jotaja.js
 * Remove os 3 pedidos antigos que foram importados por engano.
 * NÃO toca em nenhum outro pedido.
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const ORDERS_TO_REMOVE = [
  { dbId: 'cmsmg31hb0001uj04knrx0mkf', name: 'Clara', ref: '32775858' },
  { dbId: 'cmsmg343i0004uj04e888avp0', name: 'Ivan', ref: '32776862' },
  { dbId: 'cmsmg364m0007uj04wug2pstv', name: 'Lara', ref: '32777566' },
];

async function main() {
  console.log('🔧 Removendo 3 pedidos antigos importados por engano...\n');

  for (const o of ORDERS_TO_REMOVE) {
    try {
      // 1. Remover itens do pedido
      const deletedItems = await prisma.customerOrderItem.deleteMany({
        where: { orderId: o.dbId },
      });
      console.log(`  🗑️ ${o.name} #${o.ref}: ${deletedItems.count} item(s) removido(s)`);

      // 2. Remover o pedido
      await prisma.customerOrder.delete({
        where: { id: o.dbId },
      });
      console.log(`  ✅ Pedido ${o.name} #${o.ref} REMOVIDO com sucesso`);
    } catch (err) {
      console.error(`  ❌ Erro ao remover ${o.name} #${o.ref}: ${err.message}`);
    }
  }

  // Verificar que os 9 pedidos corretos continuam no banco
  console.log('\n📋 Verificando pedidos de hoje que devem permanecer...');
  const remaining = await prisma.customerOrder.findMany({
    where: {
      openDeliveryChannel: 'JOTAJA',
      createdAt: { gte: new Date(Date.now() - 2 * 60 * 60 * 1000) }, // últimas 2h
    },
    select: {
      id: true,
      customerName: true,
      openDeliveryReference: true,
      totalAmount: true,
      status: true,
      kdsStage: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`\n✅ ${remaining.length} pedido(s) Jajá de hoje permanecem no sistema:`);
  for (const r of remaining) {
    console.log(`   • #${r.openDeliveryReference} - ${r.customerName} - R$ ${r.totalAmount.toFixed(2)} - ${r.status} - ${r.kdsStage}`);
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); prisma.$disconnect(); process.exit(1); });
