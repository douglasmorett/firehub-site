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
  mpAccessToken?:  string;
  description:     string;
}): Promise<MpPaymentResult> {
  const token = params.mpAccessToken || ACCESS_TOKEN;
  if (!token) {
    throw new Error("Credencial do Mercado Pago não configurada.");
  }
  const client = new MercadoPagoConfig({ accessToken: token });
  const payment = new Payment(client);

  const cleanEmail = params.payerEmail?.includes("@") ? params.payerEmail.trim() : "cliente@firehub.com.br";
  const cleanCpf = params.payerCpf ? params.payerCpf.replace(/\D/g, "") : undefined;

  const paymentData: any = {
    transaction_amount: Number(params.amount),
    token:              params.cardToken,
    description:        params.description,
    installments:       Number(params.installments) || 1,
    payment_method_id:  params.paymentMethodId || undefined,
    payer: {
      email: cleanEmail,
      identification: cleanCpf ? { type: "CPF", number: cleanCpf } : undefined,
    },
    external_reference: params.orderId,
  };

  const result = await payment.create({ body: paymentData });

  return {
    paymentId:    String(result.id),
    status:       (result.status || "pending") as MpPaymentResult["status"],
    statusDetail: result.status_detail || "",
  };
}

export async function checkMpPaymentStatus(paymentId: string, customToken?: string): Promise<{
  paid: boolean; failed: boolean; status: string;
}> {
  const token = customToken || ACCESS_TOKEN;
  if (!token) {
    return { paid: false, failed: false, status: "pending" };
  }
  const client = new MercadoPagoConfig({ accessToken: token });
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

/**
 * URL de conexão da conta Mercado Pago da loja.
 *
 * O `state` vai ASSINADO (mesmo esquema do OAuth do Meta). Antes era o id da
 * loja em texto puro e o callback nem olhava para ele: bastava induzir um
 * lojista logado a abrir `/api/mp-connect/callback?code=<code do atacante>`
 * para a conta de RECEBIMENTO dele ser trocada pela do atacante — todo
 * pagamento da loja passava a cair na conta de outra pessoa.
 */
export function getMpOnboardingUrl(restaurantId: string): string {
  const mpAppId = process.env.MP_APP_ID || "";
  const redirectUri = encodeURIComponent(`${process.env.NEXTAUTH_URL}/api/mp-connect/callback`);
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { criarState } = require("./meta-oauth-state") as typeof import("./meta-oauth-state");
  const state = encodeURIComponent(criarState(restaurantId));
  return `https://auth.mercadopago.com.br/authorization?client_id=${mpAppId}&response_type=code&platform_id=mp&state=${state}&redirect_uri=${redirectUri}`;
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
