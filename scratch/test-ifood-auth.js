const clientId = "f003da60-a255-4a6f-a1fb-f94819c6f286";
const clientSecret = "107a0sf9as7pyuq2fuxahnlvurw8fngt2pkm049j10otj10pgme8874hf0u8ayxcjv9pkndicdposictjzv4708jtmy3p0q6mx51";

async function testAuth() {
  console.log("--- TEST 1: client_credentials ---");
  const res1 = await fetch("https://merchant-api.ifood.com.br/authentication/v1.0/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grantType: "client_credentials", clientId, clientSecret })
  });
  console.log("Status 1:", res1.status, await res1.text());

  console.log("--- TEST 2: client_credentials with camelCase grant_type ---");
  const res2 = await fetch("https://merchant-api.ifood.com.br/authentication/v1.0/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret })
  });
  console.log("Status 2:", res2.status, await res2.text());
}

testAuth().catch(console.error);
