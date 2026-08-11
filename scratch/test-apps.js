const IFOOD_BASE = "https://merchant-api.ifood.com.br";

const apps = [
  {
    name: "App 1 (f003da60...)",
    clientId: "f003da60-a255-4a6f-a1fb-f94819c6f286",
    clientSecret: "107a0sf9as7pyuq2fuxahnlvurw8fngt2pkm049j10otj10pgme8874hf0u8ayxcjv9pkndicdposictjzv4708jtmy3p0q6mx51"
  },
  {
    name: "App 2 (92c66502...)",
    clientId: "92c66502-57ce-4563-a9e3-0df07dda5a38",
    clientSecret: "bf6798ba-5abe-43b8-a5d7-adca54643492"
  }
];

const merchants = [
  "6a5fb96d-68bd-46af-ada4-456a9a160787",
  "f2170891-3073-47ea-9e32-947a2336bc8c"
];

async function testApps() {
  for (const app of apps) {
    console.log(`\n--- Testando ${app.name} ---`);
    try {
      const res = await fetch(`${IFOOD_BASE}/authentication/v1.0/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grantType: "client_credentials",
          clientId: app.clientId,
          clientSecret: app.clientSecret
        })
      });
      if (!res.ok) {
        console.log(`   Token Auth FALHOU: ${res.status} ${await res.text()}`);
        continue;
      }
      const data = await res.json();
      const token = data.accessToken;
      console.log(`   Token OK (primeiros 20 chars): ${token.slice(0, 20)}...`);

      const headers = { Authorization: `Bearer ${token}` };

      // Polling
      const pollRes = await fetch(`${IFOOD_BASE}/order/v1.0/events:polling`, { headers });
      console.log(`   Polling Status: ${pollRes.status}`);

      for (const m of merchants) {
        const mRes = await fetch(`${IFOOD_BASE}/merchant/v1.0/merchants/${m}`, { headers });
        console.log(`   Merchant ${m}: ${mRes.status} ${mRes.statusText}`);
      }

    } catch (e) {
      console.log(`   Erro: ${e.message}`);
    }
  }
}

testApps().catch(console.error);
