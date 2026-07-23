require('dotenv').config({ path: '.env.local' });
const clientId = process.env.IFOOD_CLIENT_ID;
const clientSecret = process.env.IFOOD_CLIENT_SECRET;

async function main() {
  const authRes = await fetch("https://merchant-api.ifood.com.br/authentication/v1.0/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grantType: "client_credentials", clientId, clientSecret })
  });
  const authData = await authRes.json();
  const token = authData.accessToken;

  // inspect order e5507d2b-361e-4395-a7ec-a58faba376fa
  const orderRes = await fetch("https://merchant-api.ifood.com.br/order/v1.0/orders/e5507d2b-361e-4395-a7ec-a58faba376fa", {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await orderRes.json();
  console.log("Order JSON keys:", Object.keys(data));
  console.log("Order status/timing fields:", {
    status: data.status,
    orderStatus: data.orderStatus,
    orderTiming: data.orderTiming,
    displayId: data.displayId,
    orderType: data.orderType,
    salesChannel: data.salesChannel,
    fullData: JSON.stringify(data, null, 2).slice(0, 1000)
  });
}

main().catch(console.error);
