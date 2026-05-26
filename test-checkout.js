const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const ASAAS_HEADERS = (key) => ({
  "access_token": key,
  "User-Agent": "hakim-portal/1.0",
  "Content-Type": "application/json"
});

async function checkAsaasOverdue(cpfCnpj) {
  if (!cpfCnpj) return { blocked: false, payments: [] };
  
  const asaasKey = process.env.ASAAS_API_KEY;
  if (!asaasKey) {
    console.log("No ASAAS_API_KEY found in process.env!");
    return { blocked: false, payments: [] };
  }

  // Notice: checkAsaasOverdue in the original code is hardcoded to use production URL
  const url = `https://api.asaas.com/v3/customers?cpfCnpj=${cpfCnpj}`;
  console.log(`[checkAsaasOverdue] Fetching customer from url: ${url}`);
  const customerRes = await fetch(url, {
    headers: ASAAS_HEADERS(asaasKey)
  });
  const customerData = await customerRes.json();

  if (!customerRes.ok || !customerData.data || customerData.data.length === 0) {
    console.log(`[checkAsaasOverdue] Customer not found or error. status: ${customerRes.status}`, customerData);
    return { blocked: false, payments: [] };
  }

  const asaasCustomerId = customerData.data[0].id;
  console.log(`[checkAsaasOverdue] Found customer ID in Asaas: ${asaasCustomerId}`);

  const paymentsUrl = `https://api.asaas.com/v3/payments?customer=${asaasCustomerId}&status=OVERDUE`;
  console.log(`[checkAsaasOverdue] Fetching overdue payments from url: ${paymentsUrl}`);
  const paymentsRes = await fetch(paymentsUrl, {
    headers: ASAAS_HEADERS(asaasKey)
  });
  
  const paymentsData = await paymentsRes.json();

  if (paymentsRes.ok && paymentsData.data && paymentsData.data.length > 0) {
    return {
      blocked: true,
      payments: paymentsData.data.map((p) => ({
        id: p.id,
        value: p.value,
        dueDate: p.dueDate,
        invoiceUrl: p.invoiceUrl || p.bankSlipUrl || null,
        description: p.description || `Cobrança ${p.id}`,
      }))
    };
  }

  console.log("[checkAsaasOverdue] No overdue payments found!");
  return { blocked: false, payments: [] };
}

async function createAsaasPayment(opts) {
  const asaasKey = process.env.ASAAS_API_KEY;
  if (!asaasKey) {
    console.warn("ASAAS_API_KEY não configurada — cobrança não gerada.");
    return null;
  }

  const BASE = asaasKey.startsWith("$aact_prod")
    ? "https://api.asaas.com/v3"
    : "https://sandbox.asaas.com/v3";

  console.log(`[createAsaasPayment] Using BASE URL: ${BASE}`);

  // 1. Busca ou cria cliente
  let customerId = null;
  const cleanCpfCnpj = opts.cpfCnpj ? opts.cpfCnpj.replace(/\D/g, "") : "";

  if (cleanCpfCnpj) {
    try {
      const searchRes = await fetch(
        `${BASE}/customers?cpfCnpj=${encodeURIComponent(cleanCpfCnpj)}`,
        { headers: ASAAS_HEADERS(asaasKey) }
      );
      const data = await searchRes.json();
      console.log(`[createAsaasPayment] Customer search status: ${searchRes.status}`, data);
      if (searchRes.ok && data.data?.length > 0) {
        customerId = data.data[0].id;
      }
    } catch (err) {
      console.error("Erro ao buscar cliente por CPF/CNPJ no Asaas:", err);
    }
  }

  if (!customerId) {
    const payload = {
      name: opts.userName || opts.userEmail,
      email: opts.userEmail,
    };
    if (cleanCpfCnpj) {
      payload.cpfCnpj = cleanCpfCnpj;
    }

    console.log(`[createAsaasPayment] Creating new customer with payload:`, payload);
    let createRes = await fetch(`${BASE}/customers`, {
      method: "POST",
      headers: ASAAS_HEADERS(asaasKey),
      body: JSON.stringify(payload)
    });
    let createData = await createRes.json();
    console.log(`[createAsaasPayment] Customer creation response: ${createRes.status}`, createData);

    if (!createRes.ok) {
      if (payload.cpfCnpj) {
        console.warn("Tentando criar cliente Asaas sem CPF/CNPJ...");
        delete payload.cpfCnpj;
        createRes = await fetch(`${BASE}/customers`, {
          method: "POST",
          headers: ASAAS_HEADERS(asaasKey),
          body: JSON.stringify(payload)
        });
        createData = await createRes.json();
        console.log(`[createAsaasPayment] Customer creation fallback response: ${createRes.status}`, createData);
      }
    }

    if (createRes.ok) {
      customerId = createData.id;
    }
  }

  if (!customerId) {
    console.error("[createAsaasPayment] Could not find or create customer!");
    return null;
  }
  console.log(`[createAsaasPayment] Target Customer ID: ${customerId}`);

  // 2. Cria cobrança (boleto) com vencimento em 10 dias
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 10);

  const shortId = opts.orderId.slice(-6).toUpperCase();
  const paymentPayload = {
    customer: customerId,
    billingType: "UNDEFINED",
    value: opts.totalAmount,
    dueDate: dueDate.toISOString().split("T")[0],
    description: opts.description || `Pedido #${shortId} — Hakim Congelados`,
    externalReference: opts.orderId
  };
  console.log(`[createAsaasPayment] Creating payment with payload:`, paymentPayload);

  const payRes = await fetch(`${BASE}/payments`, {
    method: "POST",
    headers: ASAAS_HEADERS(asaasKey),
    body: JSON.stringify(paymentPayload)
  });

  const payData = await payRes.json();
  console.log(`[createAsaasPayment] Payment creation response: ${payRes.status}`, payData);
  if (!payRes.ok) {
    console.error("Erro Asaas payment:", JSON.stringify(payData));
    return null;
  }

  return {
    paymentId: payData.id,
    boletoUrl: payData.invoiceUrl || payData.bankSlipUrl || null
  };
}

async function main() {
  const email = 'paulocoutinhocastilho@gmail.com';
  const user = await prisma.user.findUnique({
    where: { email }
  });
  if (!user) {
    console.error("User not found!");
    return;
  }
  console.log("Simulating Checkout for User:", { id: user.id, name: user.name, cpfCnpj: user.cpfCnpj });

  // Get active products
  const products = await prisma.product.findMany({
    where: { active: true },
    take: 2
  });
  if (products.length < 2) {
    console.error("Not enough active products in database!");
    return;
  }

  console.log("Products:");
  products.forEach(p => console.log(`- ${p.name} (R$ ${p.price})`));

  const items = [
    { id: products[0].id, quantity: 3, name: products[0].name, price: products[0].price },
    { id: products[1].id, quantity: 2, name: products[1].name, price: products[1].price }
  ];

  let calculatedTotal = 0;
  const itemsWithPrice = items.map(item => {
    const product = products.find(p => p.id === item.id);
    calculatedTotal += product.price * item.quantity;
    return { productId: product.id, quantity: item.quantity, price: product.price };
  });

  console.log("Calculated Total:", calculatedTotal);

  if (user.cpfCnpj) {
    console.log("\n--- SIMULATING CHECK OVERDUE ---");
    const overdueInfo = await checkAsaasOverdue(user.cpfCnpj);
    console.log("Overdue Info result:", overdueInfo);
    if (overdueInfo.blocked) {
      console.error("BLOCKED! Checkout cannot proceed.");
      return;
    }
  }

  console.log("\n--- SIMULATING ORDER CREATION ---");
  const order = await prisma.order.create({
    data: {
      userId: user.id,
      totalAmount: calculatedTotal,
      status: "PENDING_PAYMENT",
      items: { create: itemsWithPrice }
    }
  });
  console.log("Temporary Order created. ID:", order.id);

  console.log("\n--- SIMULATING ASAAS PAYMENT CREATION ---");
  const shortId = order.id.slice(-6).toUpperCase();
  const paymentOpts = {
    userName: user.name || user.email || "",
    userEmail: user.email || "",
    cpfCnpj: user.cpfCnpj || "",
    totalAmount: calculatedTotal,
    orderId: order.id,
    description: `TESTE SIMULACAO #${shortId} — Icebox Congelados`
  };

  try {
    const asaasResult = await createAsaasPayment(paymentOpts);
    console.log("Asaas Payment Result:", asaasResult);
    if (asaasResult) {
      console.log("Asaas generated payment successfully!");
    } else {
      console.error("Asaas payment failed!");
    }
  } catch (err) {
    console.error("Asaas payment generated exception:", err);
  }

  console.log("\nCleaning up simulated order...");
  await prisma.orderItem.deleteMany({ where: { orderId: order.id } });
  await prisma.order.delete({ where: { id: order.id } });
  console.log("Cleanup complete!");
}

main().catch(console.error).finally(() => prisma.$disconnect());
