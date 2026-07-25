const fs = require('fs');
const path = require('path');

// Load .env.local manually if present
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
        { openDeliveryReference: '32526414' },
        { openDeliveryOrderId: { contains: '32526414' } },
        { customerName: { contains: 'Vitor' } }
      ]
    },
    include: { items: { include: { menuProduct: true } } }
  });

  console.log('Orders found count:', orders.length);
  for (const o of orders) {
    console.log('--- ORDER ---');
    console.log('ID:', o.id);
    console.log('openDeliveryOrderId:', o.openDeliveryOrderId);
    console.log('openDeliveryReference:', o.openDeliveryReference);
    console.log('customerName:', o.customerName);
    console.log('items count:', o.items.length);
    console.log('items:', JSON.stringify(o.items, null, 2));
    console.log('notes:', o.notes);
  }

  await prisma.$disconnect();
}

run().catch(console.error);
