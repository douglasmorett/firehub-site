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
    select: { ifoodAccessToken: true }
  });

  const orderId = "7df2cc3d-2104-496a-ab7f-512e897fcc90";
  console.log("Testing POST /order/v1.0/orders/" + orderId + "/dispatch with user token...");

  const res = await fetch(`https://merchant-api.ifood.com.br/order/v1.0/orders/${orderId}/dispatch`, {
    method: "POST",
    headers: { Authorization: `Bearer ${user.ifoodAccessToken}`, "Content-Type": "application/json" }
  });

  console.log("Status:", res.status);
  const text = await res.text();
  console.log("Response text:", text);
}

main().catch(console.error).finally(() => prisma.$disconnect());
