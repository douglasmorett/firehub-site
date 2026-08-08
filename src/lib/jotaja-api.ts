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
export async function getJotajaToken(userEmail?: string): Promise<string> {
  if (_token && Date.now() < _tokenExp) return _token;

  let clientId = process.env.JOTAJA_CLIENT_ID || "92c66502-57ce-4563-a9e3-0df07dda5a38";
  let clientSecret = process.env.JOTAJA_CLIENT_SECRET || "bf6798ba-5abe-43b8-a5d7-adca54643492";

  // Tenta obter credenciais dinâmicas do usuário no banco se disponíveis
  try {
    const u = await prisma.user.findFirst({
      where: {
        OR: [
          userEmail ? { email: userEmail } : undefined,
          { email: "contatohakim@gmail.com" },
          { jotajaConnected: true }
        ].filter(Boolean) as any,
        NOT: { jotajaClientId: null }
      },
      select: { jotajaClientId: true, jotajaClientSecret: true }
    });
    if (u?.jotajaClientId && u?.jotajaClientSecret) {
      clientId = u.jotajaClientId;
      clientSecret = u.jotajaClientSecret;
    }
  } catch (e) {}

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
