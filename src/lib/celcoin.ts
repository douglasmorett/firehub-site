/**
 * FireHub — Celcoin PIX Integration
 * Docs: https://developers.celcoin.com.br
 * 
 * Fluxo:
 *  1. OAuth2 client_credentials → access_token
 *  2. POST /v5/transactions/px/charge/dynamic → gera QR code + código Pix
 *  3. Webhook confirma pagamento → atualizamos o pedido
 * 
 * Split: ao criar a cobrança, informamos a conta do restaurante como destinatário
 * e ficamos com nossa taxa (0,5% + R$0,40) na conta master FireHub.
 */

const CELCOIN_BASE = process.env.CELCOIN_ENV === "production"
  ? "https://openfinance.celcoin.dev"
  : "https://sandbox.openfinance.celcoin.dev";

const CLIENT_ID     = process.env.CELCOIN_CLIENT_ID!;
const CLIENT_SECRET = process.env.CELCOIN_CLIENT_SECRET!;

// Cache do token para não repetir autenticação a cada chamada
let _token: string | null = null;
let _tokenExp = 0;

export async function getCelcoinToken(): Promise<string> {
  if (_token && Date.now() < _tokenExp) return _token;

  const res = await fetch(`${CELCOIN_BASE}/v5/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type:    "client_credentials",
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });

  if (!res.ok) throw new Error(`Celcoin auth error: ${res.status}`);
  const data = await res.json();
  _token    = data.access_token;
  _tokenExp = Date.now() + (data.expires_in - 60) * 1000; // 60s de margem
  return _token!;
}

export interface CelcoinPixResult {
  transactionId: string;   // ID interno Celcoin
  pixKey:        string;   // Chave copia-e-cola
  qrCodeBase64?: string;   // Imagem QR Code em base64 (opcional)
  expiresAt:     string;   // ISO string de expiração
}

/**
 * Gera uma cobrança PIX dinâmica na Celcoin.
 * 
 * @param params.amount          Valor total do pedido (R$)
 * @param params.orderId         ID do pedido no FireHub (referência interna)
 * @param params.customerName    Nome do consumidor
 * @param params.customerCpf     CPF do consumidor (opcional)
 * @param params.restaurantAccount  Celcoin account ID do restaurante (subconta)
 * @param params.franchiseePixKey   Chave Pix do restaurante (se split direto)
 */
export async function createCelcoinPix(params: {
  amount:             number;
  orderId:            string;
  customerName:       string;
  customerCpf?:       string;
  restaurantAccount?: string;
}): Promise<CelcoinPixResult> {
  const token = await getCelcoinToken();

  // Taxa FireHub: 0,5% + R$0,40
  const firehubFee = parseFloat((params.amount * 0.005 + 0.40).toFixed(2));
  const restaurantAmount = parseFloat((params.amount - firehubFee).toFixed(2));

  const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 min

  const body: Record<string, any> = {
    amount:          params.amount,
    merchantCategoryCode: "5812",  // Restaurantes
    paymentType:     "immediate",
    key:             process.env.CELCOIN_PIX_KEY || "", // Chave PIX mestre FireHub
    expiresAt:       expiresAt.toISOString(),
    infoAdicionais:  [{ nome: "Pedido", valor: params.orderId.slice(-8).toUpperCase() }],
    merchantName:    "FireHub",
    txId:            params.orderId.replace(/-/g, "").slice(0, 35),
    debtor: {
      name: params.customerName,
      ...(params.customerCpf ? { cpf: params.customerCpf.replace(/\D/g, "") } : {}),
    },
  };

  // Split automático se restaurante tiver subconta Celcoin
  if (params.restaurantAccount) {
    body.split = {
      type:     "fixed",
      amount:   restaurantAmount,
      account:  params.restaurantAccount,
    };
  }

  const res = await fetch(`${CELCOIN_BASE}/v5/transactions/px/charge/dynamic`, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Celcoin PIX error: ${JSON.stringify(data)}`);
  }

  return {
    transactionId: data.transactionId || data.id || data.txId,
    pixKey:        data.emv || data.brCode || data.qrcode || "",
    qrCodeBase64:  data.qrcodeImage || undefined,
    expiresAt:     expiresAt.toISOString(),
  };
}

/**
 * Verifica o status de um PIX Celcoin
 */
export async function checkCelcoinPixStatus(transactionId: string): Promise<"PENDING" | "PAID" | "EXPIRED" | "CANCELLED"> {
  const token = await getCelcoinToken();

  const res = await fetch(
    `${CELCOIN_BASE}/v5/transactions/px/charge/checkStatus?transactionId=${transactionId}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!res.ok) return "PENDING";
  const data = await res.json();

  const status = (data.status || data.transactionStatus || "").toUpperCase();
  if (status === "PAID" || status === "COMPLETED" || status === "APPROVED") return "PAID";
  if (status === "EXPIRED" || status === "CANCELLED") return "EXPIRED";
  return "PENDING";
}
