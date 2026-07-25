const fs = require('fs');
const path = require('path');

const envLocalPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envLocalPath)) {
  const envConfig = fs.readFileSync(envLocalPath, 'utf8');
  for (const line of envConfig.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const idx = trimmed.indexOf('=');
      if (idx > 0) {
        const key = trimmed.slice(0, idx).trim();
        let val = trimmed.slice(idx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        process.env[key] = val;
      }
    }
  }
}

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  const orders = await prisma.customerOrder.findMany({
    where: {
      OR: [
        { openDeliveryReference: { contains: '32527178' } },
        { openDeliveryOrderId: { contains: '32527178' } },
        { notes: { contains: '32527178' } }
      ]
    },
    include: { items: { include: { menuProduct: true } } }
  });

  console.log('Orders matching 32527178:', JSON.stringify(orders, null, 2));

  // Also check recent Jotaja orders created today
  const recentJotaja = await prisma.customerOrder.findMany({
    where: {
      openDeliveryOrderId: { not: null },
      createdAt: { gte: new Date(Date.now() - 4 * 60 * 60 * 1000) }
    },
    include: { items: { include: { menuProduct: true } } },
    orderBy: { createdAt: 'desc' }
  });

  console.log('Recent Jotaja orders today:', JSON.stringify(recentJotaja, null, 2));

  await prisma.$disconnect();
}

run().catch(console.error);
