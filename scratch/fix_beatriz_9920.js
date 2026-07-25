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
  const order = await prisma.customerOrder.findFirst({
    where: { ifoodReference: '9920' },
    include: { items: { include: { menuProduct: true } } }
  });

  if (!order) {
    console.log('Order 9920 not found');
    return;
  }

  console.log('Order 9920 items count:', order.items.length);
  for (let i = 0; i < order.items.length; i++) {
    const item = order.items[i];
    console.log(`Item [${i}]: price=${item.price}, qty=${item.quantity}, menuProduct=${item.menuProduct?.name}`);
  }

  // Find item with price 2.9 (2x 2.9 = 5.80) or second item
  const secondItem = order.items.find(it => it.price === 2.9 || (it.menuProduct && it.menuProduct.name.includes('Monte') && it.quantity === 2)) || order.items[1];

  if (secondItem) {
    const prod = await prisma.menuProduct.upsert({
      where: { id: 'ifood-esfirra-calabresa-9920' },
      update: { name: 'Esfirra de Calabresa', price: 2.9 },
      create: {
        id: 'ifood-esfirra-calabresa-9920',
        franchiseeId: order.franchiseeId,
        name: 'Esfirra de Calabresa',
        description: '',
        price: 2.9,
        category: 'iFood',
        active: true
      }
    });

    await prisma.customerOrderItem.update({
      where: { id: secondItem.id },
      data: { menuProductId: prod.id }
    });

    console.log(`✅ Fixed second item ${secondItem.id} for Order #9920 -> "Esfirra de Calabresa"!`);
  }

  await prisma.$disconnect();
}

run().catch(console.error);
