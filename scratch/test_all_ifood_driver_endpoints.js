const IFOOD_BASE = "https://merchant-api.ifood.com.br";

async function getIfoodToken() {
  const clientId     = process.env.IFOOD_CLIENT_ID || "f003da60-a255-4a6f-a1fb-f94819c6f286";
  const clientSecret = process.env.IFOOD_CLIENT_SECRET || "107a0sf9as7pyuq2fuxahnlvurw8fngt2pkm049j10otj10pgme8874hf0u8ayxcjv9pkndicdposictjzv4708jtmy3p0q6mx51";

  const res = await fetch(`${IFOOD_BASE}/authentication/v1.0/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grantType: "client_credentials", clientId, clientSecret }),
  });

  const data = await res.json();
  return data.accessToken;
}

async function main() {
  const token = await getIfoodToken();
  const merchantId = "6a5fb96d-68bd-46af-ada4-456a9a160787";
  const ifoodOrderId = "50dd0ad7-1e11-4e0f-a03f-bf8dbf933cb3";

  const endpoints = [
    { method: "GET", path: `/shipping/v1.0/orders/${ifoodOrderId}/deliveryAvailabilities` },
    { method: "POST", path: `/shipping/v1.0/orders/${ifoodOrderId}/deliveryAvailabilities` },
    { method: "GET", path: `/shipping/v1.0/merchants/${merchantId}/orders/${ifoodOrderId}/deliveryAvailabilities` },
    { method: "POST", path: `/shipping/v1.0/merchants/${merchantId}/deliveryAvailabilities`, body: { orderId: ifoodOrderId } },
    { method: "GET", path: `/order/v1.0/orders/${ifoodOrderId}/deliveryAvailabilities` },
    { method: "POST", path: `/shipping/v1.0/orders/${ifoodOrderId}/requestDriver` },
    { method: "POST", path: `/order/v1.0/orders/${ifoodOrderId}/requestDriver` },
  ];

  for (const ep of endpoints) {
    try {
      const options = {
        method: ep.method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json"
        }
      };
      if (ep.body) options.body = JSON.stringify(ep.body);

      const res = await fetch(`${IFOOD_BASE}${ep.path}`, options);
      const text = await res.text();
      console.log(`[${ep.method}] ${ep.path} => Status ${res.status}: ${text.slice(0, 150)}`);
    } catch (e) {
      console.log(`[${ep.method}] ${ep.path} => Error: ${e.message}`);
    }
  }
}

main().catch(console.error);
