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
  const customerId = "cus_000168659722"; // HAKIM FRANQUIA SHOPPING RO
  
  console.log("Gerando cobrança para pedido #G65EYO...");
  
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 10);
  
  const payRes = await fetch(`${BASE}/payments`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      customer: customerId,
      billingType: "UNDEFINED",
      value: 973.70,
      dueDate: dueDate.toISOString().split("T")[0],
      description: "Pedido #G65EYO — Icebox Congelados",
      externalReference: "G65EYO"
    })
  });
  
  const payData = await payRes.json();
  
  if (payRes.ok) {
    console.log(`✅ Pagamento criado com sucesso!`);
    console.log(`   ID: ${payData.id}`);
    console.log(`   Link de pagamento: ${payData.invoiceUrl}`);
    console.log(`   Status: ${payData.status}`);
    console.log(`   Vencimento: ${payData.dueDate}`);
    
    // Save info
    fs.writeFileSync('.g65eyo-payment.json', JSON.stringify({
      paymentId: payData.id,
      invoiceUrl: payData.invoiceUrl,
    }, null, 2));
    console.log("\n   Dados salvos em .g65eyo-payment.json");
    console.log("\n   ⚠️  Agora precisa atualizar o pedido no banco com esse paymentId e invoiceUrl");
  } else {
    console.log(`❌ Erro: ${JSON.stringify(payData, null, 2)}`);
  }
}

main();
