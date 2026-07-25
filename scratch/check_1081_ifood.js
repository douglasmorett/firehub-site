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
    where: { ifoodReference: '1081' }
  });

  console.log('Order 1081 in DB:', {
    id: order?.id,
    customerName: order?.customerName,
    paymentMethod: order?.paymentMethod,
    ifoodOrderId: order?.ifoodOrderId
  });

  if (order?.ifoodOrderId) {
    const clientId = process.env.IFOOD_CLIENT_ID || '92c66502-57ce-4563-a9e3-0df07dda5a38';
    const clientSecret = process.env.IFOOD_CLIENT_SECRET || 'bf6798ba-5abe-43b8-a5d7-adca54643492';

    const authRes = await fetch('https://merchant-api.ifood.com.br/authentication/v1.0/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grantType: 'client_credentials', clientId, clientSecret })
    });

    if (authRes.ok) {
      const authData = await authRes.json();
      const token = authData.accessToken;

      const res = await fetch(`https://merchant-api.ifood.com.br/order/v1.0/orders/${order.ifoodOrderId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (res.ok) {
        const data = await res.json();
        console.log('IFOOD ORDER RAW PAYMENTS JSON:', JSON.stringify(data.payments, null, 2));
      }
    }
  }

  await prisma.$disconnect();
}

run().catch(console.error);
