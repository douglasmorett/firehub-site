/**
 * /src/lib/jotaja-api.ts
 * Helper centralizado para autenticação e chamadas à API do Jotajá via Open Delivery.
 * Análogo ao ifood-api.ts — OAuth2 client_credentials + wrappers autenticados.
 *
 * MULTI-TENANT: Cada loja tem seu próprio token OAuth e credenciais.
 * O cache é por storeId, evitando cruzamento entre lojas.
 */

import { prisma } from "./prisma";

const JOTAJA_BASE = process.env.JOTAJA_BASE_URL || "https://api.jotaja.com/openDelivery";

const _tokenCache = new Map<string, { token: string; exp: number; clientId: string }>();
const _pendingTokenFetches = new Map<string, Promise<string>>();

function invalidateTokenCache(storeUserId?: string) {
  if (storeUserId) {
    _tokenCache.delete(`store_${storeUserId}`);
  } else {
    // Clear all env-based caches
    for (const [key] of _tokenCache) {
      if (key.startsWith('env_') || key === 'global') _tokenCache.delete(key);
    }
  }
}

interface JotajaCredentials {
  clientId: string;
  clientSecret: string;
  cacheKey: string;
}

/**
 * Resolve as credenciais Jotajá para uma loja específica.
 * Se storeUserId for fornecido, busca credenciais do banco para aquela loja.
 * Caso contrário, usa variáveis de ambiente como fallback.
 */
async function resolveCredentials(storeUserId?: string): Promise<JotajaCredentials> {
  const envClientId = process.env.JOTAJA_CLIENT_ID || "";
  const envClientSecret = process.env.JOTAJA_CLIENT_SECRET || "";

  if (storeUserId) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: storeUserId },
        select: { jotajaClientId: true, jotajaClientSecret: true },
      });
      if (user?.jotajaClientId && user?.jotajaClientSecret) {
        return {
          clientId: user.jotajaClientId,
          clientSecret: user.jotajaClientSecret,
          cacheKey: `store_${storeUserId}`,
        };
      }
    } catch {}
  }

  // Fallback para env vars (usado quando nenhuma loja específica é informada)
  return {
    clientId: envClientId,
    clientSecret: envClientSecret,
    cacheKey: envClientId ? `env_${envClientId}` : "global",
  };
}

/** Obtém (ou reutiliza) o Bearer token via client_credentials, com cache per-store */
export async function getJotajaToken(storeUserId?: string): Promise<string> {
  const creds = await resolveCredentials(storeUserId);

  // Verificar cache PER-STORE
  const cached = _tokenCache.get(creds.cacheKey);
  if (cached && Date.now() < cached.exp && cached.clientId === creds.clientId) {
    return cached.token;
  }

  // Promise-sharing: se já tem uma requisição em andamento para essa loja, reutiliza
  const pendingKey = creds.cacheKey;
  const pending = _pendingTokenFetches.get(pendingKey);
  if (pending) return pending;
  
  const tokenPromise = fetchNewToken(creds);
  _pendingTokenFetches.set(pendingKey, tokenPromise);
  try {
    return await tokenPromise;
  } finally {
    _pendingTokenFetches.delete(pendingKey);
  }
}

async function fetchNewToken(creds: JotajaCredentials): Promise<string> {
  if (!creds.clientId || !creds.clientSecret) {
    throw new Error("Jotajá: credenciais não configuradas para esta loja");
  }

  const res = await fetch(`${JOTAJA_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Jotajá auth falhou: ${res.status} — ${err.slice(0, 300)}`);
  }

  const data   = await res.json();
  const token  = data.access_token ?? data.accessToken;
  const expMs  = Date.now() + ((data.expires_in ?? data.expiresIn ?? 3600) - 60) * 1000;

  _tokenCache.set(creds.cacheKey, { token, exp: expMs, clientId: creds.clientId });

  return token;
}

/** Wrapper autenticado para LEITURAS (GET) — per-store */
export async function jotajaFetch(
  path: string,
  options: RequestInit = {},
  storeUserId?: string
): Promise<Response> {
  const doFetch = async () => {
    const token = await getJotajaToken(storeUserId);
    return fetch(`${JOTAJA_BASE}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(options.headers ?? {}),
      },
    });
  };
  
  const res = await doFetch();
  if (res.status === 401) {
    // Token expirou ou foi revogado — invalidar cache e retry
    invalidateTokenCache(storeUserId);
    return doFetch();
  }
  return res;
}

/**
 * Wrapper para ESCRITAS reais (POST/PUT/DELETE) — per-store.
 * Mesma autenticação, sem headers especiais de homologação.
 */
export async function jotajaMutate(
  path: string,
  options: RequestInit = {},
  storeUserId?: string
): Promise<Response> {
  const doFetch = async () => {
    const token = await getJotajaToken(storeUserId);
    return fetch(`${JOTAJA_BASE}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(options.headers ?? {}),
      },
    });
  };
  
  const res = await doFetch();
  if (res.status === 401) {
    // Token expirou ou foi revogado — invalidar cache e retry
    invalidateTokenCache(storeUserId);
    return doFetch();
  }
  return res;
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
