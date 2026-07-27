async function main() {
  try {
    const res = await fetch("https://five-houses-sit.loca.lt/instance/connect/test_store", {
      headers: { "Bypass-Tunnel-Remainder": "true", "User-Agent": "FireHub" }
    });
    const data = await res.json();
    console.log("Status HTTP:", res.status);
    console.log("Resposta do Tunnel WhatsApp Gateway:", JSON.stringify(data).slice(0, 150));
  } catch (err) {
    console.error("Erro tunnel:", err.message);
  }
}
main();
