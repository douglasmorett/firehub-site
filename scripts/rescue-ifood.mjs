import { config } from "dotenv";
config();

const IFOOD_BASE = "https://merchant-api.ifood.com.br";
const FIREHUB_BASE = "https://firehubfood.com.br";

async function getToken() {
  const res = await fetch(`${IFOOD_BASE}/authentication/v1.0/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grantType: "client_credentials",
      clientId: process.env.IFOOD_CLIENT_ID,
      clientSecret: process.env.IFOOD_CLIENT_SECRET,
    }),
  });
  const data = await res.json();
  if (!data.accessToken) throw new Error("Token failed: " + JSON.stringify(data));
  return data.accessToken;
}

async function pollAndRescue() {
  const token = await getToken();

  const evRes = await fetch(`${IFOOD_BASE}/events/v1.0/events:polling`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const evText = await evRes.text();
  const events = evText ? JSON.parse(evText) : [];

  if (events.length === 0) {
    process.stdout.write(".");
    return 0;
  }

  console.log(`\n📥 ${events.length} eventos`);

  const uniqueOrders = new Map();
  for (const e of events) {
    if (e.orderId && !uniqueOrders.has(e.orderId)) {
      uniqueOrders.set(e.orderId, e);
    }
  }

  let imported = 0;
  for (const [orderId, event] of uniqueOrders) {
    const oRes = await fetch(`${IFOOD_BASE}/order/v1.0/orders/${orderId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!oRes.ok) {
      console.log(`  ⚠️ ${orderId.slice(0,8)} -> ${oRes.status}`);
      continue;
    }
    const orderData = await oRes.json();

    const webhookPayload = {
      id: event.id || `rescue-${orderId}`,
      code: "PLC",
      fullCode: "PLACED",
      orderId,
      merchantId: event.merchantId || orderData.merchant?.id,
      createdAt: event.createdAt || orderData.createdAt,
      data: orderData,
    };

    const whRes = await fetch(`${FIREHUB_BASE}/api/ifood/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(webhookPayload),
    });
    console.log(`  ✅ ${orderData.customer?.name ?? "?"} (#${orderData.displayId}) R$${orderData.total?.orderAmount ?? "?"} -> ${whRes.status}`);
    imported++;
  }

  // Acknowledge
  const ackPayload = events.filter((e) => e.id).map((e) => ({ id: e.id }));
  if (ackPayload.length > 0) {
    await fetch(`${IFOOD_BASE}/events/v1.0/events/acknowledgment`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(ackPayload),
    });
  }

  return imported;
}

// Run continuously
console.log("🔄 iFood Rescue Agent — polling a cada 10s (Ctrl+C para parar)\n");

async function loop() {
  try {
    await pollAndRescue();
  } catch (err) {
    console.error(`\n❌ ${err.message}`);
  }
  setTimeout(loop, 10000);
}
loop();
