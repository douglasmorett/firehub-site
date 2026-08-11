const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: "postgresql://neondb_owner:npg_6q8vJnVD3IHvP2FA4OpfFg@ep-soft-water-amzwjl9k-pooler.c-5.us-east-1.aws.neon.tech/firehub_db?sslmode=require"
    }
  }
});

async function main() {
  console.log("=== INSPEÇÃO DA FILA DE PEDIDOS DO HAKIM CONTATO ===");

  const mainStoreId = "cmpx96phr0000ujf0sb0qk5vr";

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const todayOrders = await prisma.customerOrder.findMany({
    where: {
      franchiseeId: mainStoreId,
      createdAt: { gte: startOfDay }
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      customerName: true,
      createdAt: true,
      status: true,
      source: true,
      openDeliveryReference: true,
      ifoodReference: true,
    }
  });

  console.log(`Total de pedidos hoje no Hakim Contato: ${todayOrders.length}`);
  
  todayOrders.forEach((o, index) => {
    const seq = index + 1;
    const isKelly = o.id === "cmsb27p780007kv04xmpl3non" || o.customerName.includes("Kelly");
    if (isKelly || index >= todayOrders.length - 5) {
      console.log(`[#${seq}] ID: ${o.id} | Cliente: ${o.customerName} | Origem: ${o.source} | Ref: ${o.openDeliveryReference || o.ifoodReference || '—'} | CriadoEm: ${o.createdAt.toISOString()} ${isKelly ? '👈 KELLY VENTURA (FIM DA FILA)' : ''}`);
    }
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());
