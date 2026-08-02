async function run() {
  const instanceName = "firehub_f0sb0qk5vr";
  const baseUrl = "https://firehub-whatsapp-gateway-production.up.railway.app";
  const apiKey = "firehub_secret_key_2026";

  console.log(`Checking connection for instance: ${instanceName} at ${baseUrl}...`);

  try {
    const stateRes = await fetch(`${baseUrl}/instance/connectionState/${instanceName}`, {
      headers: { apikey: apiKey, "Bypass-Tunnel-Remainder": "true" }
    });
    const stateData = await stateRes.json();
    console.log("Railway Connection State Response:", stateRes.status, JSON.stringify(stateData, null, 2));
  } catch (err) {
    console.error("Railway Connection check error:", err);
  }
}

run().catch(console.error);
