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
  const orderId = 'cms0xp9rg0004hz0bx1zlm1kl';
  const order = await prisma.customerOrder.findUnique({ where: { id: orderId } });
  if (!order) {
    console.log('Order 7341 not found!');
    return;
  }

  // Create or upsert the MenuProduct for Esfirra de Calabresa
  const prod = await prisma.menuProduct.upsert({
    where: { id: 'ifood-esfirra-calabresa-7341' },
    update: { name: 'Esfirra de Calabresa', price: 2.9 },
    create: {
      id: 'ifood-esfirra-calabresa-7341',
      franchiseeId: order.franchiseeId,
      name: 'Esfirra de Calabresa',
      description: '',
      price: 2.9,
      category: 'iFood',
      active: true,
    }
  });

  // Link item to this MenuProduct
  await prisma.customerOrderItem.updateMany({
    where: { orderId },
    data: { menuProductId: prod.id }
  });

  console.log('Successfully linked order 7341 items to MenuProduct: Esfirra de Calabresa!');
  await prisma.$disconnect();
}

run().catch(console.error);
