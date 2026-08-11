const IFOOD_BASE = "https://merchant-api.ifood.com.br";

async function getIfoodToken() {
  const clientId     = process.env.IFOOD_CLIENT_ID || "f003da60-a255-4a6f-a1fb-f94819c6f286";
  const clientSecret = process.env.IFOOD_CLIENT_SECRET || "107a0sf9as7pyuq2fuxahnlvurw8fngt2pkm049j10otj10pgme8874hf0u8ayxcjv9pkndicdposictjzv4708jtmy3p0q6mx51";

  const res = await fetch(`${IFOOD_BASE}/authentication/v1.0/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grantType: "client_credentials", clientId, clientSecret }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`iFood auth falhou: ${res.status} — ${err.slice(0, 300)}`);
  }

  const data = await res.json();
  return data.accessToken;
}

async function main() {
  const token = await getIfoodToken();
  console.log("Token obtained length:", token.length);

  const orderId = "50dd0ad7-1e11-4e0f-a03f-bf8dbf933cb3";
  const url = `https://merchant-api.ifood.com.br/shipping/v1.0/orders/${orderId}/deliveryAvailabilities`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
  });

  console.log("Status with getIfoodToken():", res.status);
  const text = await res.text();
  console.log("Response:", text);
}

main().catch(console.error);
