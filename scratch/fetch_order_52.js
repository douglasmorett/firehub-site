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
    where: {
      OR: [
        { openDeliveryReference: '32527178' },
        { openDeliveryOrderId: { contains: '32527178' } },
        { customerName: { contains: 'Caio' } }
      ]
    },
    include: { items: { include: { menuProduct: true } } }
  });

  console.log('Order 52 in DB:', JSON.stringify(order, null, 2));

  if (order?.openDeliveryOrderId) {
    const clientId = '92c66502-57ce-4563-a9e3-0df07dda5a38';
    const clientSecret = 'bf6798ba-5abe-43b8-a5d7-adca54643492';

    const authRes = await fetch('https://api.jotaja.com/openDelivery/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret })
    });
    const authData = await authRes.json();
    const token = authData.access_token || authData.accessToken;

    const res = await fetch(`https://api.jotaja.com/openDelivery/v1/orders/${order.openDeliveryOrderId}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
    });

    console.log('Fetch status:', res.status);
    const data = await res.json();
    console.log('JOTAJA API RAW JSON FOR ORDER 52:', JSON.stringify(data, null, 2));
  }

  await prisma.$disconnect();
}

run().catch(console.error);
