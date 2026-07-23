require('dotenv').config({ path: '.env.local' });
const clientId = process.env.IFOOD_CLIENT_ID;
const clientSecret = process.env.IFOOD_CLIENT_SECRET;

async function main() {
  const authRes = await fetch("https://merchant-api.ifood.com.br/authentication/v1.0/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grantType: "client_credentials", clientId, clientSecret })
  });
  const authData = await authRes.json();
  const token = authData.accessToken;

  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();

  const recentOrders = await prisma.customerOrder.findMany({
    where: { ifoodOrderId: { not: null } },
    take: 5,
    orderBy: { createdAt: 'desc' }
  });

  for (const o of recentOrders) {
    const orderRes = await fetch(`https://merchant-api.ifood.com.br/order/v1.0/orders/${o.ifoodOrderId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (orderRes.ok) {
      const data = await orderRes.json();
      console.log(`\n=== PEDIDO: ${data.displayId || data.id} | Cliente: ${data.customer?.name} ===`);
      console.log("Customer Phone Obj:", JSON.stringify(data.customer?.phone));
      console.log("Items:", JSON.stringify(data.items, null, 2));
    }
  }
  await prisma.$disconnect();
}

main().catch(console.error);
