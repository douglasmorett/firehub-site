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

  const orderId = "50dd0ad7-1e11-4e0f-a03f-bf8dbf933cb3";
  const url = `https://merchant-api.ifood.com.br/shipping/v1.0/orders/${orderId}/deliveryAvailabilities`;

  console.log("Testing with user.ifoodAccessToken...");

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${user.ifoodAccessToken}`, Accept: "application/json" }
  });

  console.log("Status:", res.status);
  const text = await res.text();
  console.log("Response:", text);
}

main().catch(console.error).finally(() => prisma.$disconnect());
