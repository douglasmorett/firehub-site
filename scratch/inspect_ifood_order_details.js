const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: "postgresql://neondb_owner:npg_6q8vJnVD3IHvP2FA4OpfFg@ep-soft-water-amzwjl9k.c-5.us-east-1.aws.neon.tech/firehub_db?sslmode=require"
    }
  }
});

async function main() {
  const user = await prisma.user.findUnique({
    where: { email: "contatohakim@gmail.com" },
    select: { ifoodAccessToken: true, ifoodMerchantId: true }
  });

  const token = user.ifoodAccessToken;
  const ifoodOrderId = "7df2cc3d-2104-496a-ab7f-512e897fcc90";

  const res = await fetch(`https://merchant-api.ifood.com.br/order/v1.0/orders/${ifoodOrderId}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
  });

  console.log("Order details status:", res.status);
  const data = await res.json();
  console.log("Order details JSON:", JSON.stringify(data, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
