import { config } from "dotenv";
config();

const IFOOD_BASE = "https://merchant-api.ifood.com.br";

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

async function main() {
  const token = await getToken();
  console.log("✅ Token obtido");
  console.log(`MERCHANT_UUID env: ${process.env.IFOOD_MERCHANT_UUID}`);

  // Poll events
  const evRes = await fetch(`${IFOOD_BASE}/events/v1.0/events:polling`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const evText = await evRes.text();
  const events = evText ? JSON.parse(evText) : [];
  console.log(`📥 Events: ${events.length}`);

  if (events.length > 0) {
    // Test fetching each unique order
    const seen = new Set();
    for (const e of events) {
      if (e.orderId && !seen.has(e.orderId)) {
        seen.add(e.orderId);
        const oRes = await fetch(`${IFOOD_BASE}/order/v1.0/orders/${e.orderId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (oRes.ok) {
          const od = await oRes.json();
          console.log(`✅ ${e.orderId.slice(0,8)} -> ${od.customer?.name} (merchant: ${od.merchant?.id?.slice(0,8)})`);
        } else {
          const errText = await oRes.text();
          console.log(`❌ ${e.orderId.slice(0,8)} -> ${oRes.status}: ${errText.slice(0,200)}`);
        }
      }
    }
  } else {
    // No events - try a direct fetch of a known recent order
    console.log("No events. Testing direct order fetch...");
    
    // Try to list merchants first
    const mRes = await fetch(`${IFOOD_BASE}/merchant/v1.0/merchants`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    console.log(`Merchants list: ${mRes.status}`);
    if (mRes.ok) {
      const merchants = await mRes.json();
      console.log(`Merchants:`, JSON.stringify(merchants).slice(0, 500));
    } else {
      console.log(`Merchants error:`, await mRes.text());
    }
  }
}

main().catch(console.error);
