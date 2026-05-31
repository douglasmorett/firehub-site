const fs = require('fs');
const path = require('path');

const envContent = fs.readFileSync(path.resolve(__dirname, '.env.local'), 'utf8');
const match = envContent.match(/ASAAS_API_KEY=["']?(.+?)["']?\s*$/m);
const key = match[1].trim();

const BASE = "https://api.asaas.com/v3";
const headers = {
  "access_token": key,
  "User-Agent": "hakim-portal/1.0",
  "Content-Type": "application/json"
};

async function main() {
  // 1. Find and cancel RMUEB0
  console.log("=== Buscando RMUEB0 em todos os status ===");
  for (const status of ["PENDING", "CONFIRMED", "RECEIVED", "OVERDUE"]) {
    const res = await fetch(`${BASE}/payments?status=${status}&limit=100`, { headers });
    const data = await res.json();
    if (data.data) {
      for (const p of data.data) {
        if ((p.description || "").includes("RMUEB") || (p.externalReference || "").toLowerCase().includes("rmueb")) {
          console.log(`Encontrado em ${status}: ${p.id} | ${p.description} | R$ ${p.value}`);
          console.log(`Cancelando ${p.id}...`);
          const delRes = await fetch(`${BASE}/payments/${p.id}`, { method: "DELETE", headers });
          const delData = await delRes.json();
          console.log(delRes.ok ? "  ✅ Cancelado!" : `  ❌ ${JSON.stringify(delData)}`);
        }
      }
    }
  }

  // 2. Generate payment for order #G65EYO
  console.log("\n=== Gerando boleto para pedido #G65EYO ===");
  
  // First, find the order in the database
  // We'll search by the suffix G65EYO
  // Need to use prisma - let's do it via the Asaas API directly instead
  // The customer is "HAKIM FRANQUIA SHOPPING RO" / Rio das Ostras
  
  // Search for customer
  const custRes = await fetch(`${BASE}/customers?name=HAKIM FRANQUIA SHOPPING`, { headers });
  const custData = await custRes.json();
  
  if (custData.data && custData.data.length > 0) {
    const customer = custData.data[0];
    console.log(`Cliente encontrado: ${customer.id} | ${customer.name} | ${customer.email}`);
    
    // Create payment
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 10);
    
    const payRes = await fetch(`${BASE}/payments`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        customer: customer.id,
        billingType: "BOLETO",
        value: 973.70,
        dueDate: dueDate.toISOString().split("T")[0],
        description: "Pedido #G65EYO — Icebox Congelados",
        externalReference: "G65EYO"
      })
    });
    const payData = await payRes.json();
    
    if (payRes.ok) {
      console.log(`✅ Pagamento criado: ${payData.id}`);
      console.log(`   Link: ${payData.invoiceUrl}`);
      console.log(`   Boleto: ${payData.bankSlipUrl || "N/A"}`);
      
      // Save these for updating the database
      fs.writeFileSync('.g65eyo-payment.json', JSON.stringify({
        paymentId: payData.id,
        invoiceUrl: payData.invoiceUrl,
        bankSlipUrl: payData.bankSlipUrl
      }, null, 2));
    } else {
      console.log(`❌ Erro: ${JSON.stringify(payData)}`);
    }
  } else {
    console.log("Cliente não encontrado, listando todos...");
    const allRes = await fetch(`${BASE}/customers?limit=30`, { headers });
    const allData = await allRes.json();
    allData.data?.forEach(c => console.log(`  ${c.id} | ${c.name} | ${c.email}`));
  }
}

main();
