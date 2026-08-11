/**
 * EMERGENCY-CLEANUP.js — Remove TODOS os duplicados e mantém apenas 1 de cada pedido
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('🚨 LIMPEZA DE EMERGÊNCIA — Removendo duplicatas\n');

  // Get all JOTAJA orders from last 3 hours
  const allOrders = await prisma.customerOrder.findMany({
    where: { openDeliveryChannel: 'JOTAJA', createdAt: { gte: new Date(Date.now() - 4 * 60 * 60 * 1000) } },
    select: { id: true, customerName: true, openDeliveryReference: true, openDeliveryOrderId: true, kdsStage: true, createdAt: true, status: true },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`Total de pedidos Jajá recentes: ${allOrders.length}\n`);

  // Group by openDeliveryReference
  const groups = new Map();
  for (const o of allOrders) {
    const ref = o.openDeliveryReference || 'unknown';
    if (!groups.has(ref)) groups.set(ref, []);
    groups.get(ref).push(o);
  }

  // Known OLD references that should be COMPLETELY removed
  const OLD_REFS_TO_NUKE = new Set();
  for (const [ref, orders] of groups) {
    const refNum = parseInt(ref);
    if (refNum > 0 && refNum < 32790000) {
      OLD_REFS_TO_NUKE.add(ref);
    }
  }

  let kept = 0, removed = 0;

  for (const [ref, orders] of groups) {
    if (OLD_REFS_TO_NUKE.has(ref)) {
      // NUKE all copies of old orders
      console.log(`🗑️ OLD #${ref} (${orders[0].customerName}): removendo TODAS as ${orders.length} cópias`);
      for (const o of orders) {
        await prisma.customerOrderItem.deleteMany({ where: { orderId: o.id } });
        await prisma.customerOrder.delete({ where: { id: o.id } });
        removed++;
      }
      continue;
    }

    if (orders.length === 1) {
      console.log(`✅ #${ref} (${orders[0].customerName}): 1 cópia — OK`);
      kept++;
      continue;
    }

    // Multiple copies — keep the FIRST one with kdsStage=PRODUCTION, delete the rest
    console.log(`⚠️ #${ref} (${orders[0].customerName}): ${orders.length} cópias — limpando duplicatas`);
    
    // Prefer the one with kdsStage = PRODUCTION
    const primary = orders.find(o => o.kdsStage === 'PRODUCTION') || orders[0];
    
    for (const o of orders) {
      if (o.id === primary.id) {
        console.log(`   ✅ MANTÉM: ${o.id} (kds: ${o.kdsStage}, status: ${o.status})`);
        kept++;
      } else {
        await prisma.customerOrderItem.deleteMany({ where: { orderId: o.id } });
        await prisma.customerOrder.delete({ where: { id: o.id } });
        console.log(`   🗑️ REMOVE: ${o.id} (kds: ${o.kdsStage})`);
        removed++;
      }
    }
  }

  // Final verification
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`📊 RESULTADO:`);
  console.log(`   ✅ Mantidos: ${kept}`);
  console.log(`   🗑️ Removidos: ${removed}`);
  
  const finalOrders = await prisma.customerOrder.findMany({
    where: { openDeliveryChannel: 'JOTAJA', createdAt: { gte: new Date(Date.now() - 4 * 60 * 60 * 1000) } },
    select: { id: true, customerName: true, openDeliveryReference: true, totalAmount: true, status: true, kdsStage: true },
    orderBy: { createdAt: 'asc' },
  });
  
  console.log(`\n📋 PEDIDOS FINAIS (${finalOrders.length}):`);
  for (const o of finalOrders) {
    console.log(`   • #${o.openDeliveryReference} - ${o.customerName} - R$ ${o.totalAmount.toFixed(2)} - ${o.status} - ${o.kdsStage}`);
  }
  console.log(`${'═'.repeat(60)}\n`);

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); prisma.$disconnect(); process.exit(1); });
