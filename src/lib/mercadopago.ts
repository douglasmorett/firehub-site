/**
 * FireHub — Mercado Pago Marketplace Integration
 */
import { MercadoPagoConfig, Payment } from "mercadopago";

const ACCESS_TOKEN =
  process.env.MP_ACCESS_TOKEN ||
  process.env.MERCADO_PAGO_ACCESS_TOKEN ||
  process.env.MERCADOPAGO_ACCESS_TOKEN ||
  "";
const FIREHUB_CARD_FEE_PCT = 1.0; // 1% de margem

export interface MpPaymentResult {
  paymentId:    string;
  status:       "approved" | "pending" | "rejected" | "in_process";
  statusDetail: string;
}

export async function createMpCardPayment(params: {
  amount:          number;
  orderId:         string;
  cardToken:       string;
  paymentMethodId?: string;
  installments:    number;
  payerEmail:      string;
  payerCpf?:       string;
  mpSellerId?:     string;
  description:     string;
}): Promise<MpPaymentResult> {
  const client = new MercadoPagoConfig({ accessToken: ACCESS_TOKEN });
  const payment = new Payment(client);

  const firehubFee = parseFloat((params.amount * (FIREHUB_CARD_FEE_PCT / 100)).toFixed(2));

  const paymentData: any = {
    transaction_amount: params.amount,
    token:              params.cardToken,
    description:        params.description,
    installments:       params.installments,
    payment_method_id:  params.paymentMethodId || "master",
    payer: {
      email:        params.payerEmail,
      identification: params.payerCpf
        ? { type: "CPF", number: params.payerCpf.replace(/\D/g, "") }
        : undefined,
    },
    external_reference: params.orderId,
    money_release_days: 2, // D+2
  };

  if (params.mpSellerId) {
    paymentData.marketplace_fee = firehubFee;
  }

  const result = await payment.create({ body: paymentData });

  return {
    paymentId:    String(result.id),
    status:       (result.status || "pending") as MpPaymentResult["status"],
    statusDetail: result.status_detail || "",
  };
}

export async function checkMpPaymentStatus(paymentId: string): Promise<{
  paid: boolean; failed: boolean; status: string;
}> {
  const client = new MercadoPagoConfig({ accessToken: ACCESS_TOKEN });
  const payment = new Payment(client);

  const result = await payment.get({ id: paymentId });
  const status = result.status || "pending";

  return {
    paid:   status === "approved",
    failed: status === "rejected" || status === "cancelled",
    status,
  };
}

export async function refundMpPayment(paymentId: string, customToken?: string): Promise<{ success: boolean; error?: string }> {
  try {
    const token = customToken || ACCESS_TOKEN;
    const res = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}/refunds`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
    const data = await res.json();
    if (!res.ok) {
      console.error("[MP Refund] Error:", data);
      return { success: false, error: data.message || "Falha ao estornar via MP" };
    }
    return { success: true };
  } catch (err: any) {
    console.error("[MP Refund] Exception:", err.message);
    return { success: false, error: err.message };
  }
}

export function getMpOnboardingUrl(restaurantId: string): string {
  const mpAppId = process.env.MP_APP_ID || "";
  const redirectUri = encodeURIComponent(`${process.env.NEXTAUTH_URL}/api/mp-connect/callback`);
  return `https://auth.mercadopago.com.br/authorization?client_id=${mpAppId}&response_type=code&platform_id=mp&state=${restaurantId}&redirect_uri=${redirectUri}`;
}

export async function exchangeMpOAuthCode(code: string): Promise<{
  accessToken: string; refreshToken: string; mpUserId: string;
}> {
  const res = await fetch("https://api.mercadopago.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id:     process.env.MP_APP_ID,
      client_secret: process.env.MP_APP_SECRET,
      code,
      grant_type:    "authorization_code",
      redirect_uri:  `${process.env.NEXTAUTH_URL}/api/mp-connect/callback`,
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`MP OAuth error: ${JSON.stringify(data)}`);

  return {
    accessToken:  data.access_token,
    refreshToken: data.refresh_token,
    mpUserId:     String(data.user_id),
  };
}
