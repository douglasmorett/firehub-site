const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function run() {
  const JOTAJA_BASE = "https://api.jotaja.com/openDelivery";
  const clientId = "92c66502-57ce-4563-a9e3-0df07dda5a38";
  const clientSecret = "bf6798ba-5abe-43b8-a5d7-adca54643492";

  console.log("1. Autenticando com JotaJá Open Delivery...");
  const authRes = await fetch(`${JOTAJA_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  const tokenData = await authRes.json();
  const token = tokenData.access_token || tokenData.accessToken;

  const endpoints = [
    "/v1/events:polling",
    "/v1/orders",
    "/v1/merchants/22238/orders",
    "/v1/orders/32516601",
    "/v1/merchants/22238/events:polling",
    "/v1/merchants/22238"
  ];

  for (const path of endpoints) {
    try {
      const res = await fetch(`${JOTAJA_BASE}${path}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const text = await res.text().catch(() => "");
      console.log(`[${path}] -> Status ${res.status}:`, text.slice(0, 300));
    } catch (e) {
      console.error(`[${path}] -> Erro:`, e.message);
    }
  }
}

run().catch(console.error).finally(() => prisma.$disconnect());
