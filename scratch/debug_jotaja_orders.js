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
  // Find orders 32528840 and 32528882
  const orders = await prisma.customerOrder.findMany({
    where: {
      OR: [
        { openDeliveryReference: '32528840' },
        { openDeliveryReference: '32528882' },
        { customerName: { contains: 'Suellen' } },
        { customerName: { contains: 'Hewller' } }
      ]
    },
    include: { items: { include: { menuProduct: true } } }
  });

  console.log('Orders found in DB:', orders.length);
  for (const o of orders) {
    console.log(`--- Order #${o.openDeliveryReference} (${o.customerName}) ---`);
    console.log('ID:', o.id);
    console.log('openDeliveryOrderId:', o.openDeliveryOrderId);
    console.log('items in DB:', JSON.stringify(o.items, null, 2));
  }

  // Authenticate JotaJa API and fetch raw payloads
  const clientId = '92c66502-57ce-4563-a9e3-0df07dda5a38';
  const clientSecret = 'bf6798ba-5abe-43b8-a5d7-adca54643492';

  const authRes = await fetch('https://api.jotaja.com/openDelivery/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret })
  });

  if (authRes.ok) {
    const authData = await authRes.json();
    const token = authData.access_token || authData.accessToken;

    for (const o of orders) {
      if (o.openDeliveryOrderId) {
        console.log(`\n=== FETCHING RAW JOTAJA JSON FOR ORDER ${o.openDeliveryReference} (${o.openDeliveryOrderId}) ===`);
        const res = await fetch(`https://api.jotaja.com/openDelivery/v1/orders/${o.openDeliveryOrderId}`, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
        });
        if (res.ok) {
          const raw = await res.json();
          console.log('RAW JOTAJA JSON:', JSON.stringify(raw, null, 2));
        } else {
          console.log('Failed to fetch from JotaJa API status:', res.status);
        }
      }
    }
  }

  await prisma.$disconnect();
}

run().catch(console.error);
