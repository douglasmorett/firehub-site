/**
 * FireHub — Pagar.me API Client
 * Documentação: https://docs.pagar.me/reference
 * 
 * VARIÁVEIS DE AMBIENTE NECESSÁRIAS (.env.local):
 *   PAGARME_SECRET_KEY=sk_live_xxxx   (produção) ou sk_test_xxxx (sandbox)
 *   PAGARME_RECIPIENT_ID=re_xxxx       (sua conta FireHub como master)
 *   NEXT_PUBLIC_PAGARME_PUBLIC_KEY=pk_live_xxxx
 * 
 * PARA COMEÇAR:
 * 1. Acesse https://dashboard.pagar.me
 * 2. Crie conta como Marketplace
 * 3. Ative o programa de parceiros (Partner Program)
 * 4. Copie as chaves de API
 */

const PAGARME_BASE = "https://api.pagar.me/core/v5";
const SECRET_KEY = process.env.PAGARME_SECRET_KEY || "";
const FIREHUB_RECIPIENT_ID = process.env.PAGARME_RECIPIENT_ID || "";

// Taxa FireHub: 3% de cada pedido (Pay as You Grow — concorrência cobra 4%)
// Min R$60/mês | Teto R$300/mês
const FIREHUB_SPLIT_PERCENTAGE = 3;

function authHeader() {
  const encoded = Buffer.from(`${SECRET_KEY}:`).toString("base64");
  return { "Authorization": `Basic ${encoded}`, "Content-Type": "application/json" };
}

async function pagarmeRequest(method: string, path: string, body?: any) {
  const res = await fetch(`${PAGARME_BASE}${path}`, {
    method,
    headers: authHeader(),
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) {
    console.error("[Pagar.me] Error:", JSON.stringify(data));
    throw new Error(data.message || "Erro Pagar.me");
  }
  return data;
}

// ===== RECIPIENT (subconta por restaurante) =====

export async function createRecipient({
  name, email, document, bankCode, agency, account, accountType
}: {
  name: string; email: string; document: string;
  bankCode: string; agency: string; account: string; accountType: string;
}) {
  return pagarmeRequest("POST", "/recipients", {
    name, email, document,
    type: "individual",
    default_bank_account: {
      holder_name: name,
      holder_type: "individual",
      holder_document: document,
      bank: bankCode,
      branch_number: agency,
      account_number: account,
      type: accountType, // checking | savings
    },
    transfer_settings: {
      transfer_enabled: true,
      transfer_interval: "daily",
      transfer_day: 0,
    }
  });
}

// ===== PIX =====

export async function createPixOrder({
  orderId, amount, customerName, customerEmail, customerDocument,
  recipientId, description
}: {
  orderId: string; amount: number; customerName: string;
  customerEmail: string; customerDocument?: string;
  recipientId?: string; description: string;
}) {
  const amountCents = Math.round(amount * 100);
  const firehubAmount = Math.round(amountCents * (FIREHUB_SPLIT_PERCENTAGE / 100));
  const restaurantAmount = amountCents - firehubAmount;

  const payload: any = {
    code: `ORDER-${orderId}`,
    customer: {
      name: customerName,
      email: customerEmail || "cliente@firehub.com.br",
      type: "individual",
      document: customerDocument || "00000000000",
      document_type: "CPF",
      phones: { mobile_phone: { country_code: "55", area_code: "11", number: "999999999" } }
    },
    items: [{ amount: amountCents, description, quantity: 1, code: orderId }],
    payments: [{
      payment_method: "pix",
      pix: { expires_in: 1800 } // 30 min
    }],
  };

  // Split apenas se o restaurante já tem recipientId cadastrado
  if (recipientId && FIREHUB_RECIPIENT_ID) {
    payload.payments[0].split = [
      { recipient_id: FIREHUB_RECIPIENT_ID, amount: firehubAmount, type: "flat", options: { charge_processing_fee: true, liable: true } },
      { recipient_id: recipientId, amount: restaurantAmount, type: "flat", options: { charge_processing_fee: false, liable: false } }
    ];
  }

  return pagarmeRequest("POST", "/orders", payload);
}

// ===== CARTÃO DE CRÉDITO/DÉBITO/VOUCHER =====

export async function createCardOrder({
  orderId, amount, customerName, customerEmail, customerDocument,
  cardToken, paymentMethod, recipientId, description, installments = 1
}: {
  orderId: string; amount: number; customerName: string;
  customerEmail: string; customerDocument?: string;
  cardToken: string; paymentMethod: "credit_card" | "debit_card" | "voucher";
  recipientId?: string; description: string; installments?: number;
}) {
  const amountCents = Math.round(amount * 100);
  const firehubAmount = Math.round(amountCents * (FIREHUB_SPLIT_PERCENTAGE / 100));
  const restaurantAmount = amountCents - firehubAmount;

  const paymentConfig: any = {
    payment_method: paymentMethod,
    [paymentMethod === "credit_card" ? "credit_card" :
     paymentMethod === "debit_card" ? "debit_card" : "voucher"]: {
      installments: paymentMethod === "credit_card" ? installments : 1,
      statement_descriptor: "FIREHUB",
      card_token: cardToken,
    }
  };

  if (recipientId && FIREHUB_RECIPIENT_ID) {
    paymentConfig.split = [
      { recipient_id: FIREHUB_RECIPIENT_ID, amount: firehubAmount, type: "flat", options: { charge_processing_fee: true, liable: true } },
      { recipient_id: recipientId, amount: restaurantAmount, type: "flat", options: { charge_processing_fee: false, liable: false } }
    ];
  }

  return pagarmeRequest("POST", "/orders", {
    code: `ORDER-${orderId}`,
    customer: {
      name: customerName,
      email: customerEmail || "cliente@firehub.com.br",
      type: "individual",
      document: customerDocument || "00000000000",
      document_type: "CPF",
    },
    items: [{ amount: amountCents, description, quantity: 1, code: orderId }],
    payments: [paymentConfig],
  });
}

// ===== CONSULTAR PEDIDO =====

export async function getOrder(pagarmeOrderId: string) {
  return pagarmeRequest("GET", `/orders/${pagarmeOrderId}`);
}

// ===== ANTECIPAR RECEBÍVEIS =====

export async function getAnticipationLimits(recipientId: string) {
  return pagarmeRequest("GET", `/recipients/${recipientId}/anticipations/limits`);
}

export async function createAnticipation(recipientId: string, amount: number) {
  return pagarmeRequest("POST", `/recipients/${recipientId}/anticipations`, {
    amount: Math.round(amount * 100),
    timeframe: "start",
    payment_date: new Date().toISOString(),
  });
}

// ===== VERIFICAR STATUS WEBHOOK =====

export function parseWebhookEvent(body: any): {
  type: "payment_paid" | "payment_failed" | "payment_pending" | "other";
  orderId: string;
  pagarmeOrderId: string;
  status: string;
} {
  const type = body.type as string;
  const order = body.data;
  const code = order?.code || "";
  const orderId = code.replace("ORDER-", "");

  if (type === "order.paid" || type === "charge.paid") {
    return { type: "payment_paid", orderId, pagarmeOrderId: order?.id || "", status: "paid" };
  }
  if (type === "order.payment_failed" || type === "charge.payment_failed") {
    return { type: "payment_failed", orderId, pagarmeOrderId: order?.id || "", status: "failed" };
  }
  return { type: "other", orderId, pagarmeOrderId: order?.id || "", status: type };
}
