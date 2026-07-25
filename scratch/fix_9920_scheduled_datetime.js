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
    where: { ifoodReference: '9920' }
  });

  if (order) {
    const deliveryTime = new Date('2026-07-25T22:54:50.368Z'); // 19:54 BRT
    await prisma.customerOrder.update({
      where: { id: order.id },
      data: { scheduledDatetime: deliveryTime }
    });
    console.log(`✅ Fixed order #9920 (Beatriz Jorge) scheduledDatetime -> ${deliveryTime.toISOString()} (19:54 BRT)!`);
  }

  await prisma.$disconnect();
}

run().catch(console.error);
