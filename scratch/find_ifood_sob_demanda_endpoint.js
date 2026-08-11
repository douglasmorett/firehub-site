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
  const merchantId = user.ifoodMerchantId; // 6a5fb96d-68bd-46af-ada4-456a9a160787
  const ifoodOrderId = "7df2cc3d-2104-496a-ab7f-512e897fcc90";

  console.log("Merchant ID:", merchantId);
  console.log("Order ID:", ifoodOrderId);

  const tests = [
    { method: "GET", path: `/shipping/v1.0/orders/${ifoodOrderId}/deliveryAvailabilities` },
    { method: "GET", path: `/shipping/v1.0/merchants/${merchantId}/orders/${ifoodOrderId}/deliveryAvailabilities` },
    { method: "POST", path: `/shipping/v1.0/orders/${ifoodOrderId}/requestDriver` },
    { method: "POST", path: `/shipping/v1.0/merchants/${merchantId}/orders/${ifoodOrderId}/requestDriver` },
    { method: "GET", path: `/delivery/v1.0/orders/${ifoodOrderId}/availabilities` },
    { method: "POST", path: `/delivery/v1.0/deliveries/quote`, body: { merchantId, externalOrderId: ifoodOrderId } },
    { method: "POST", path: `/shipping/v1.0/deliveries/quote`, body: { merchantId, orderId: ifoodOrderId } },
    { method: "POST", path: `/order/v1.0/orders/${ifoodOrderId}/dispatch` },
    { method: "POST", path: `/shipping/v1.0/orders/${ifoodOrderId}/dispatch` },
    { method: "GET", path: `/merchant/v1.0/merchants/${merchantId}/orders/${ifoodOrderId}` },
  ];

  for (const t of tests) {
    try {
      const opts = {
        method: t.method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-iFood-Merchant-ID": merchantId,
        }
      };
      if (t.body) opts.body = JSON.stringify(t.body);

      const res = await fetch(`https://merchant-api.ifood.com.br${t.path}`, opts);
      const text = await res.text();
      console.log(`[${t.method}] ${t.path} => Status ${res.status}: ${text.slice(0, 200)}`);
    } catch (err) {
      console.log(`[${t.method}] ${t.path} => Error: ${err.message}`);
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
