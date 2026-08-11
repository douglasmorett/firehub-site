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

  console.log("Testing POST /delivery/v1.0/deliveries/quote for merchant:", merchantId);

  const payload = {
    merchantId,
    externalOrderId: "cmsotx5z50002la04qop3pfqf",
    orderValue: 35.95,
    customer: {
      name: "Kezia Macedo Arruda",
      phone: "22999999999"
    },
    deliveryAddress: {
      rawAddress: "R. Cachoeira de Macacu, 350 - Comp: Casa 01 - Recreio - Rio das Ostras"
    }
  };

  const res = await fetch(`${IFOOD_BASE}/delivery/v1.0/deliveries/quote`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify(payload)
  });

  console.log("Status:", res.status);
  const text = await res.text();
  console.log("Response body:", text);
}

main().catch(console.error);
