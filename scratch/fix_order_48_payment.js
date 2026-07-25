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
        { openDeliveryReference: '32526414' },
        { customerName: { contains: 'Vitor' } }
      ]
    }
  });

  console.log(`Found ${orders.length} orders for Vitor.`);
  for (const order of orders) {
    console.log(`Updating order #${order.openDeliveryReference} (${order.customerName}) paymentMethod -> Crédito (Cobrar na Entrega)`);
    await prisma.customerOrder.update({
      where: { id: order.id },
      data: { paymentMethod: 'Crédito (Cobrar na Entrega)' }
    });
  }

  console.log('✅ Updated order #48 paymentMethod successfully!');
  await prisma.$disconnect();
}

run().catch(console.error);
