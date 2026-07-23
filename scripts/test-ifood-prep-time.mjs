import { config } from "dotenv";
config();

async function getToken() {
  const res = await fetch("https://merchant-api.ifood.com.br/authentication/v1.0/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grantType: "client_credentials",
      clientId: process.env.IFOOD_CLIENT_ID,
      clientSecret: process.env.IFOOD_CLIENT_SECRET,
    }),
  });
  const data = await res.json();
  return data.accessToken;
}

async function main() {
  const token = await getToken();
  console.log("Fetching merchants list...");

  const res = await fetch("https://merchant-api.ifood.com.br/merchant/v1.0/merchants", {
    headers: { Authorization: `Bearer ${token}` }
  });
  console.log("Status:", res.status);
  console.log("Body:", await res.text());
}

main().catch(console.error);
