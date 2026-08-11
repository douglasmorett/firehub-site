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

  const ifoodOrderId = "7df2cc3d-2104-496a-ab7f-512e897fcc90";
  const url = `https://merchant-api.ifood.com.br/shipping/v1.0/orders/${ifoodOrderId}/deliveryAvailabilities`;

  console.log("Testing order 9239 with user.ifoodAccessToken...");
  let res = await fetch(url, {
    headers: { Authorization: `Bearer ${user.ifoodAccessToken}`, Accept: "application/json" }
  });
  console.log("User Token Status:", res.status);
  let text = await res.text();
  console.log("User Token Response:", text);

  // Also test requestDriver endpoint directly
  const reqUrl = `https://merchant-api.ifood.com.br/shipping/v1.0/orders/${ifoodOrderId}/requestDriver`;
  console.log("Testing POST requestDriver with user.ifoodAccessToken...");
  res = await fetch(reqUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${user.ifoodAccessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({})
  });
  console.log("requestDriver Status:", res.status);
  text = await res.text();
  console.log("requestDriver Response:", text);
}

main().catch(console.error).finally(() => prisma.$disconnect());
