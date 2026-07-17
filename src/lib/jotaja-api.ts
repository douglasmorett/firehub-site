/**
 * /src/lib/jotaja-api.ts
 * Helper centralizado para autenticação e chamadas à API do Jotajá via Open Delivery.
 * Análogo ao ifood-api.ts — OAuth2 client_credentials + wrappers autenticados.
 */

import { prisma } from "./prisma";

const JOTAJA_BASE = process.env.JOTAJA_BASE_URL || "https://api.jotaja.com/openDelivery";

// Cache de token em memória (válido por ~1h)
let _token: string | null = null;
let _tokenExp = 0;

/** Obtém (ou reutiliza) o Bearer token via client_credentials */
export async function getJotajaToken(): Promise<string> {
  if (_token && Date.now() < _tokenExp) return _token;

  const clientId     = process.env.JOTAJA_CLIENT_ID;
  const clientSecret = process.env.JOTAJA_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("JOTAJA_CLIENT_ID / JOTAJA_CLIENT_SECRET não configurados.");
  }

  const res = await fetch(`${JOTAJA_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Jotajá auth falhou: ${res.status} — ${err.slice(0, 300)}`);
  }

  const data   = await res.json();
  _token       = data.access_token ?? data.accessToken;
  _tokenExp    = Date.now() + ((data.expires_in ?? data.expiresIn ?? 3600) - 60) * 1000;
  return _token!;
}

/** Wrapper autenticado para LEITURAS (GET) */
export async function jotajaFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = await getJotajaToken();
  return fetch(`${JOTAJA_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(options.headers ?? {}),
    },
  });
}

/**
 * Wrapper para ESCRITAS reais (POST/PUT/DELETE).
 * Mesma autenticação, sem headers especiais de homologação.
 */
export async function jotajaMutate(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = await getJotajaToken();
  return fetch(`${JOTAJA_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(options.headers ?? {}),
    },
  });
}

/** merchantId principal (UUID) do Jotajá */
export function getJotajaMerchantId(): string {
  const id = process.env.JOTAJA_MERCHANT_ID;
  if (!id) throw new Error("JOTAJA_MERCHANT_ID não configurado.");
  return id;
}

/** Obtém o merchantId do Jotajá para o usuário logado */
export async function getJotajaMerchantIdForUser(email: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { jotajaMerchantId: true }
  });
  const id = (user as any)?.jotajaMerchantId;
  if (!id) throw new Error("Você não possui uma loja Jotajá integrada.");
  return id;
}
