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
  const orderId = 'cms0y9ig60004l104xx5bs7l9';
  const order = await prisma.customerOrder.findUnique({ where: { id: orderId } });
  if (!order) {
    console.log('Order 52 not found!');
    return;
  }

  // Delete any empty items for order 52
  await prisma.customerOrderItem.deleteMany({ where: { orderId } });

  // 1. Carne Promoção do dia (30x)
  const prod1 = await prisma.menuProduct.upsert({
    where: { id: 'jotaja-1103213' },
    update: { name: 'Carne Promoção do dia ', price: 1.9 },
    create: {
      id: 'jotaja-1103213',
      franchiseeId: order.franchiseeId,
      name: 'Carne Promoção do dia ',
      description: '',
      price: 1.9,
      category: 'Jotajá',
      active: true
    }
  });

  await prisma.customerOrderItem.create({
    data: {
      orderId,
      menuProductId: prod1.id,
      quantity: 30,
      price: 1.9,
      comboSelections: null
    }
  });

  // 2. 20 Esfihas do Sábio (1x) with 4 options
  const prod2 = await prisma.menuProduct.upsert({
    where: { id: 'jotaja-1096537' },
    update: { name: '20 Esfihas do Sábio', price: 109.9 },
    create: {
      id: 'jotaja-1096537',
      franchiseeId: order.franchiseeId,
      name: '20 Esfihas do Sábio',
      description: '',
      price: 109.9,
      category: 'Jotajá',
      active: true
    }
  });

  const comboSels2 = [
    { name: 'Esfirra de Calabresa', quantity: 5, price: 0 },
    { name: 'Esfirra de Frango', quantity: 5, price: 1.48 },
    { name: 'Esfirra de Queijo', quantity: 5, price: 0 },
    { name: 'Esfirra de Bacon c/ Cheddar', quantity: 5, price: 0 }
  ];

  await prisma.customerOrderItem.create({
    data: {
      orderId,
      menuProductId: prod2.id,
      quantity: 1,
      price: 109.9,
      comboSelections: JSON.stringify(comboSels2)
    }
  });

  // 3. Monte seu Combo (10 itens Variados) (1x) with 2 options
  const prod3 = await prisma.menuProduct.upsert({
    where: { id: 'jotaja-1096536' },
    update: { name: 'Monte seu Combo (10 itens Variados)', price: 59.9 },
    create: {
      id: 'jotaja-1096536',
      franchiseeId: order.franchiseeId,
      name: 'Monte seu Combo (10 itens Variados)',
      description: '',
      price: 59.9,
      category: 'Jotajá',
      active: true
    }
  });

  const comboSels3 = [
    { name: 'Esfirra Peperoni c/ Catupiry', quantity: 5, price: 0 },
    { name: 'Esfirra de Queijo', quantity: 5, price: 0 }
  ];

  await prisma.customerOrderItem.create({
    data: {
      orderId,
      menuProductId: prod3.id,
      quantity: 1,
      price: 59.9,
      comboSelections: JSON.stringify(comboSels3)
    }
  });

  console.log('✅ Successfully populated ALL items and sub-item flavors for Order 52 (Caio)!');
  await prisma.$disconnect();
}

run().catch(console.error);
