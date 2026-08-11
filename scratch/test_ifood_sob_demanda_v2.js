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
  const merchantId = user.ifoodMerchantId;
  const orderId = "7df2cc3d-2104-496a-ab7f-512e897fcc90";

  const endpoints = [
    { method: "POST", path: `/shipping/v1.0/orders/${orderId}/availabilities` },
    { method: "POST", path: `/shipping/v1.0/orders/${orderId}/deliveryAvailabilities` },
    { method: "POST", path: `/shipping/v1.0/orders/${orderId}/requestDriver`, body: { type: "ON_DEMAND" } },
    { method: "POST", path: `/shipping/v1.0/orders/${orderId}/requestDriver`, body: { mode: "INDIVIDUAL" } },
    { method: "POST", path: `/shipping/v1.0/orders/${orderId}/requestDriver`, body: {} },
    { method: "POST", path: `/delivery/v1.0/orders/${orderId}/requestDriver` },
    { method: "POST", path: `/delivery/v1.0/deliveries`, body: { merchantId, orderId } },
    { method: "POST", path: `/shipping/v1.0/deliveries`, body: { merchantId, orderId } },
    { method: "GET", path: `/shipping/v1.0/orders/${orderId}/requestDriverStatus` },
  ];

  for (const ep of endpoints) {
    try {
      const opts = {
        method: ep.method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        }
      };
      if (ep.body) opts.body = JSON.stringify(ep.body);

      const res = await fetch(`https://merchant-api.ifood.com.br${ep.path}`, opts);
      const text = await res.text();
      console.log(`[${ep.method}] ${ep.path} -> Status ${res.status}: ${text.slice(0, 200)}`);
    } catch (e) {
      console.log(`[${ep.method}] ${ep.path} -> Error: ${e.message}`);
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
