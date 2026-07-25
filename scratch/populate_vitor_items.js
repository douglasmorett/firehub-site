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
  const orderId = 'cms0xsb8b0007hz0b51y3wkcc';
  const order = await prisma.customerOrder.findUnique({ where: { id: orderId } });
  if (!order) {
    console.log('Order not found!');
    return;
  }

  // Delete any empty/orphaned items
  await prisma.customerOrderItem.deleteMany({ where: { orderId } });

  // 1. Carne Promoção do dia
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
      active: true,
    }
  });

  await prisma.customerOrderItem.create({
    data: {
      orderId,
      menuProductId: prod1.id,
      quantity: 13,
      price: 1.9,
      comboSelections: null
    }
  });

  // 2. Água c/ Gás
  const prod2 = await prisma.menuProduct.upsert({
    where: { id: 'jotaja-1096572' },
    update: { name: 'Água c/ Gás', price: 5.9, isBeverage: true },
    create: {
      id: 'jotaja-1096572',
      franchiseeId: order.franchiseeId,
      name: 'Água c/ Gás',
      description: '',
      price: 5.9,
      category: 'Jotajá',
      isBeverage: true,
      active: true,
    }
  });

  await prisma.customerOrderItem.create({
    data: {
      orderId,
      menuProductId: prod2.id,
      quantity: 1,
      price: 5.9,
      comboSelections: null
    }
  });

  console.log('Successfully populated items for Vitor order cms0xsb8b0007hz0b51y3wkcc!');
  await prisma.$disconnect();
}

run().catch(console.error);
