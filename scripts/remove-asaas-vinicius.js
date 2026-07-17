require("dotenv").config({ path: ".env.local" });
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const https = require("https");

function deletePayment(url, key) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: "DELETE",
      headers: {
        "access_token": key,
        "Content-Type": "application/json"
      }
    }, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, data: parsed });
        } catch (e) {
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, data: data });
        }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

async function run() {
  const asaasKey = process.env.ASAAS_API_KEY;
  if (!asaasKey) {
    console.error("Missing ASAAS_API_KEY");
    return;
  }
  
  const ASAAS_URL = asaasKey.startsWith("$aact_prod")
    ? "https://api.asaas.com/v3"
    : "https://sandbox.asaas.com/v3";
    
  const email = "viniciusmenezes.ofc@gmail.com";
  
  const user = await prisma.user.findUnique({
    where: { email }
  });
  
  if (!user) {
    console.error("User not found:", email);
    return;
  }
  
  console.log(`Found user ${user.name} (${user.id})`);
  
  const orders = await prisma.order.findMany({
    where: {
      userId: user.id,
      asaasPaymentId: { not: null }
    }
  });
  
  console.log(`Found ${orders.length} orders with Asaas payment for this user.`);
  
  for (const order of orders) {
    console.log(`Canceling Asaas payment ${order.asaasPaymentId} for order ${order.id}...`);
    try {
      const res = await deletePayment(`${ASAAS_URL}/payments/${order.asaasPaymentId}`, asaasKey);
      
      if (res.ok) {
        console.log(`Successfully canceled ${order.asaasPaymentId}`);
      } else {
        console.error(`Failed to cancel ${order.asaasPaymentId}:`, res.data);
      }
      
      // Update the DB regardless to unblock them
      await prisma.order.update({
        where: { id: order.id },
        data: {
          asaasPaymentId: null,
          boletoUrl: null
        }
      });
      console.log(`Removed Asaas payment from order ${order.id} in database.`);
      
    } catch (e) {
      console.error(`Error deleting ${order.asaasPaymentId}:`, e.message);
    }
  }
  
  console.log("Done.");
}

run().catch(console.error).finally(() => prisma.$disconnect());
