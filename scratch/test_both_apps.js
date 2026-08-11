const IFOOD_BASE = "https://merchant-api.ifood.com.br";

async function getTokenForApp(clientId, clientSecret) {
  const res = await fetch(`${IFOOD_BASE}/authentication/v1.0/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grantType: "client_credentials", clientId, clientSecret }),
  });
  const data = await res.json();
  return data.accessToken;
}

async function main() {
  const app1Token = await getTokenForApp(
    "f003da60-a255-4a6f-a1fb-f94819c6f286",
    "107a0sf9as7pyuq2fuxahnlvurw8fngt2pkm049j10otj10pgme8874hf0u8ayxcjv9pkndicdposictjzv4708jtmy3p0q6mx51"
  );
  const app2Token = await getTokenForApp(
    "cabc4064-8d01-4bb0-bb5b-ed93963f9a7a",
    "2k28s9uil03gobzo6p3gkojim4ffsw9ttu3031veoxm1irbiz53vbzrd50n8wqnywrbvfsurzalevhv4ank4jrrm9wr4xhfcahv"
  );

  const orderId = "7df2cc3d-2104-496a-ab7f-512e897fcc90";

  console.log("=== Testing App 1 (Centralized) ===");
  let res = await fetch(`${IFOOD_BASE}/shipping/v1.0/orders/${orderId}/deliveryAvailabilities`, {
    headers: { Authorization: `Bearer ${app1Token}`, Accept: "application/json" }
  });
  console.log("App 1 Status:", res.status, await res.text());

  console.log("=== Testing App 2 (Distributed) ===");
  res = await fetch(`${IFOOD_BASE}/shipping/v1.0/orders/${orderId}/deliveryAvailabilities`, {
    headers: { Authorization: `Bearer ${app2Token}`, Accept: "application/json" }
  });
  console.log("App 2 Status:", res.status, await res.text());
}

main().catch(console.error);
