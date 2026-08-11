/**
 * Script de emergência: drena TODOS os eventos pendentes do iFood
 * e tenta reabrir a loja via API.
 */

async function main() {
  // Import dynamically to use the project's ifood-api module
  const { getIfoodToken } = await import("../lib/ifood-api");
  
  const merchantId = process.env.IFOOD_MERCHANT_UUID || "5bfb7d90-b184-4b95-a2bc-ae61db896cb0";
  
  console.log("🔑 Obtendo token iFood...");
  const token = await getIfoodToken();
  console.log("✅ Token obtido");

  // 1. Drain ALL pending events (loop until empty)
  let totalDrained = 0;
  let round = 0;

  while (true) {
    round++;
    console.log(`\n--- Rodada ${round} de drenagem ---`);

    const res = await fetch("https://merchant-api.ifood.com.br/events/v1.0/events:polling", {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      console.log(`❌ Polling falhou: ${res.status} ${res.statusText}`);
      break;
    }

    const text = await res.text();
    const events = text ? JSON.parse(text) : [];
    console.log(`📥 ${events.length} evento(s) recebido(s)`);

    if (!events || events.length === 0) {
      console.log("✅ Fila de eventos VAZIA — tudo limpo!");
      break;
    }

    // Log each event
    for (const ev of events) {
      console.log(`  📋 ${ev.code || ev.fullCode} | orderId=${ev.orderId} | id=${ev.id}`);
    }

    // Acknowledge ALL events immediately
    const ackPayload = events
      .filter((e: any) => e.id)
      .map((e: any) => ({
        id: e.id,
        orderId: e.orderId || "",
        eventType: e.fullCode || e.code || "",
      }));

    if (ackPayload.length > 0) {
      const ackRes = await fetch("https://merchant-api.ifood.com.br/events/v1.0/events/acknowledgment", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(ackPayload),
      });
      console.log(`✅ ${ackPayload.length} eventos acknowledged (status: ${ackRes.status})`);
      totalDrained += ackPayload.length;
    }

    // Safety: max 20 rounds
    if (round >= 20) {
      console.log("⚠️ Limite de rodadas atingido");
      break;
    }
  }

  console.log(`\n📊 Total de eventos drenados: ${totalDrained}`);

  // 2. Try to check merchant status
  console.log("\n🏪 Verificando status da loja...");
  try {
    const statusRes = await fetch(
      `https://merchant-api.ifood.com.br/merchant/v1.0/merchants/${merchantId}/status`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const statusData = await statusRes.json().catch(() => statusRes.text());
    console.log("Status da loja:", JSON.stringify(statusData, null, 2));
  } catch (err: any) {
    console.log("⚠️ Não foi possível verificar status:", err.message);
  }

  // 3. Try to reopen via interruptions API
  console.log("\n🔓 Tentando remover interrupções...");
  try {
    const intRes = await fetch(
      `https://merchant-api.ifood.com.br/merchant/v1.0/merchants/${merchantId}/interruptions`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const interruptions = await intRes.json().catch(() => []);
    console.log("Interrupções ativas:", JSON.stringify(interruptions, null, 2));

    // Try to delete each interruption
    if (Array.isArray(interruptions)) {
      for (const intr of interruptions) {
        if (intr.id) {
          const delRes = await fetch(
            `https://merchant-api.ifood.com.br/merchant/v1.0/merchants/${merchantId}/interruptions/${intr.id}`,
            { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }
          );
          console.log(`  🗑️ Interrupção ${intr.id} removida: ${delRes.status}`);
        }
      }
    }
  } catch (err: any) {
    console.log("⚠️ Erro ao verificar interrupções:", err.message);
  }

  console.log("\n🏁 Script finalizado. Tente reabrir a loja no Portal de Redes agora.");
}

main().catch(console.error);
