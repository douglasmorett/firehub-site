const fs = require('fs');
const path = require('path');

// Read key from .env.local
const envContent = fs.readFileSync(path.resolve(__dirname, '.env.local'), 'utf8');
const match = envContent.match(/ASAAS_API_KEY=["']?(.+?)["']?\s*$/m);
const key = match[1].trim();

const BASE = "https://api.asaas.com/v3";
const headers = {
  "access_token": key,
  "User-Agent": "hakim-portal/1.0",
  "Content-Type": "application/json"
};

async function findAndCancel() {
  // Search for payments by description containing our test IDs
  const targets = ["HWRGC6", "ZCXOX8", "RMUEB0"];
  
  // Get all pending payments for HAKIM FRANQUIA SHOPPING RO
  console.log("Buscando pagamentos pendentes...\n");
  
  const res = await fetch(`${BASE}/payments?status=PENDING&limit=100`, { headers });
  const data = await res.json();
  
  if (!res.ok) {
    console.error("Erro ao buscar pagamentos:", JSON.stringify(data));
    return;
  }
  
  console.log(`Total de pagamentos pendentes: ${data.totalCount}\n`);
  
  const toCancel = [];
  
  for (const payment of data.data) {
    const desc = payment.description || "";
    const extRef = payment.externalReference || "";
    
    for (const target of targets) {
      if (desc.includes(target) || extRef.includes(target.toLowerCase())) {
        toCancel.push(payment);
        console.log(`Encontrado: ${payment.id} | ${desc} | R$ ${payment.value} | Venc: ${payment.dueDate}`);
        break;
      }
    }
  }
  
  if (toCancel.length === 0) {
    // Try searching by description text
    console.log("\nNão encontrado por ID, buscando por texto 'SIMULACAO' e 'RMUEB'...");
    for (const payment of data.data) {
      const desc = (payment.description || "").toUpperCase();
      if (desc.includes("SIMULACAO") || desc.includes("RMUEB")) {
        toCancel.push(payment);
        console.log(`Encontrado: ${payment.id} | ${payment.description} | R$ ${payment.value} | Venc: ${payment.dueDate}`);
      }
    }
  }
  
  console.log(`\n${toCancel.length} pagamento(s) para cancelar.\n`);
  
  for (const payment of toCancel) {
    console.log(`Cancelando ${payment.id} (${payment.description})...`);
    try {
      const delRes = await fetch(`${BASE}/payments/${payment.id}`, {
        method: "DELETE",
        headers
      });
      const delData = await delRes.json();
      if (delRes.ok || delData.deleted) {
        console.log(`  ✅ Cancelado com sucesso!`);
      } else {
        console.log(`  ❌ Erro: ${JSON.stringify(delData)}`);
      }
    } catch (err) {
      console.error(`  ❌ Erro de rede:`, err.message);
    }
  }
  
  console.log("\nFinalizado!");
}

findAndCancel();
