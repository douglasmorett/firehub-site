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
        { ifoodReference: '7341' },
        { customerName: { contains: 'Débora' } }
      ]
    },
    include: { items: { include: { menuProduct: true } } }
  });

  console.log('Found orders:', orders.length);
  for (const o of orders) {
    console.log('--- ORDER 7341 ---');
    console.log('ID:', o.id);
    console.log('ifoodReference:', o.ifoodReference);
    console.log('items:', JSON.stringify(o.items, null, 2));

    for (const item of o.items) {
      if (item.menuProduct) {
        console.log('Updating menuProduct name from:', item.menuProduct.name, 'to: Esfirra de Calabresa');
        await prisma.menuProduct.update({
          where: { id: item.menuProduct.id },
          data: { name: 'Esfirra de Calabresa' }
        });
      }
    }
  }

  console.log('Fixed order 7341 menuProduct names!');
  await prisma.$disconnect();
}

run().catch(console.error);
