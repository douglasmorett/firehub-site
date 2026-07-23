require('dotenv').config({ path: '.env.local' });

async function main() {
  const clientId = process.env.IFOOD_CLIENT_ID;
  const clientSecret = process.env.IFOOD_CLIENT_SECRET;
  
  const authRes = await fetch("https://merchant-api.ifood.com.br/authentication/v1.0/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grantType: "client_credentials", clientId, clientSecret })
  });
  const authData = await authRes.json();
  const token = authData.accessToken;

  console.log("🔑 Token iFood obtido!");

  const merchantId = "6a5fb96d-68bd-46af-ada4-456a9a160787";

  const endpointsToTest = [
    "https://merchant-api.ifood.com.br/order/v1.0/orders",
    "https://merchant-api.ifood.com.br/order/v1.0/orders?status=PLACED",
    `https://merchant-api.ifood.com.br/order/v1.0/merchants/${merchantId}/orders`,
    `https://merchant-api.ifood.com.br/merchant/v1.0/merchants/${merchantId}/orders`,
    "https://merchant-api.ifood.com.br/events/v1.0/events:polling",
  ];

  for (const url of endpointsToTest) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    console.log(`📡 URL: ${url}`);
    console.log(`   Status: ${res.status} ${res.statusText}`);
    if (res.ok) {
      const text = await res.text();
      console.log(`   Body: ${text.slice(0, 300)}`);
    }
  }
}

main().catch(console.error);
