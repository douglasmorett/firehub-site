const clientId = "f003da60-a255-4a6f-a1fb-f94819c6f286";
const clientSecret = "107a0sf9as7pyuq2fuxahnlvurw8fngt2pkm049j10otj10pgme8874hf0u8ayxcjv9pkndicdposictjzv4708jtmy3p0q6mx51";

async function run() {
  const authRes = await fetch("https://merchant-api.ifood.com.br/authentication/v1.0/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grantType: "client_credentials", clientId, clientSecret })
  });
  const data = await authRes.json();
  const token = data.accessToken;
  console.log("Token obtido! (primeiros 30 chars):", token ? token.slice(0, 30) : "SEM TOKEN");

  // Endpoint 1: /order/v1.0/events:polling
  const p1 = await fetch("https://merchant-api.ifood.com.br/order/v1.0/events:polling", {
    headers: { Authorization: `Bearer ${token}` }
  });
  console.log("Endpoint 1 (/order/v1.0/events:polling):", p1.status, await p1.text());

  // Endpoint 2: /events/v1.0/events:polling
  const p2 = await fetch("https://merchant-api.ifood.com.br/events/v1.0/events:polling", {
    headers: { Authorization: `Bearer ${token}` }
  });
  console.log("Endpoint 2 (/events/v1.0/events:polling):", p2.status, await p2.text());
}

run().catch(console.error);
