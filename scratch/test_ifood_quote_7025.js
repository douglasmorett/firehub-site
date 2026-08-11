const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: "postgresql://neondb_owner:npg_6q8vJnVD3IHvP2FA4OpfFg@ep-soft-water-amzwjl9k.c-5.us-east-1.aws.neon.tech/firehub_db?sslmode=require"
    }
  }
});

async function main() {
  const orderId = "cmsotx5z50002la04qop3pfqf";
  const order = await prisma.customerOrder.findUnique({
    where: { id: orderId },
    include: { franchisee: true }
  });

  const token = order.franchisee.ifoodAccessToken;
  console.log("Testing iFood API deliveryAvailabilities for order:", order.ifoodOrderId);

  const url = `https://merchant-api.ifood.com.br/shipping/v1.0/orders/${order.ifoodOrderId}/deliveryAvailabilities`;
  console.log("URL:", url);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
  });

  console.log("Status:", res.status);
  const text = await res.text();
  console.log("Response body:", text);
}

main().catch(console.error).finally(() => prisma.$disconnect());
