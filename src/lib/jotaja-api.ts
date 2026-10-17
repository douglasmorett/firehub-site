/**
 * /src/lib/jotaja-api.ts
 * Helper centralizado para autenticação e chamadas à API do Jotajá via Open Delivery.
 * Análogo ao ifood-api.ts — OAuth2 client_credentials + wrappers autenticados.
 *
 * POR LOJA, SEM EXCEÇÃO: cada loja fala com o JotaJá só com a credencial dela,
 * gravada no banco. Não existe credencial de reserva (JOTAJA_CLIENT_ID/SECRET no
 * ambiente): era ela que fazia loja sem credencial — ou chamada sem loja —
 * falar com o JotaJá como OUTRO restaurante (ver brendi-api.ts). Chamada sem
 * loja, ou de loja sem credencial, falha com erro claro.
 */

import { prisma } from "./prisma";

const JOTAJA_BASE = process.env.JOTAJA_BASE_URL || "https://api.jotaja.com/openDelivery";

const _tokenCache = new Map<string, { token: string; exp: number; clientId: string }>();
const _pendingTokenFetches = new Map<string, Promise<string>>();

function invalidateTokenCache(storeUserId?: string) {
  if (storeUserId) _tokenCache.delete(`store_${storeUserId}`);
}

interface JotajaCredentials {
  clientId: string;
  clientSecret: string;
  cacheKey: string;
}

/** As credenciais JotaJá DESTA loja — nunca as de outra. */
async function resolveCredentials(storeUserId?: string): Promise<JotajaCredentials> {
  if (!storeUserId) {
    throw new Error("Jotajá: chamada sem loja — cada loja usa só a própria credencial");
  }
  const user = await prisma.user.findUnique({
    where: { id: storeUserId },
    select: { jotajaClientId: true, jotajaClientSecret: true },
  });
  if (!user?.jotajaClientId || !user?.jotajaClientSecret) {
    throw new Error("Jotajá: credenciais não configuradas para esta loja");
  }
  return {
    clientId: user.jotajaClientId,
    clientSecret: user.jotajaClientSecret,
    cacheKey: `store_${storeUserId}`,
  };
}

/**
 * A loja recebe pedido do JotaJá? Só com credencial E integração ligada.
 * Credencial gravada com a integração desligada não puxa nada — antes o poll do
 * painel rodava para toda loja que tivesse credencial, ligada ou não.
 */
export async function lojaComJotajaLigado(lojaId: string): Promise<boolean> {
  const loja = await prisma.user.findUnique({
    where: { id: lojaId },
    select: { jotajaConnected: true, jotajaClientId: true, jotajaClientSecret: true },
  });
  return !!(loja?.jotajaConnected && loja.jotajaClientId && loja.jotajaClientSecret);
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

// ── Ligar a integração: credencial que ainda não está no banco ─────────────
//
// O JotaJá guarda na fila os eventos dos últimos 7 dias. Quando ele ativa o
// Open Delivery de uma loja antes de o FireHub ligar, a fila enche (Duga Burguer,
// 16/10/2026: 313 pedidos da semana). Ligar sem esvaziar jogava a semana inteira
// no painel e na impressora da loja. Por isso a tela de Integrações lê a fila
// com a credencial nova, confere de que loja ela é e dá baixa no que é de antes.

async function tokenDaCredencial(clientId: string, clientSecret: string): Promise<string> {
  const res = await fetch(`${JOTAJA_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }),
  });
  if (!res.ok) throw new Error(`JotaJá recusou a credencial (HTTP ${res.status})`);
  const data = await res.json();
  return data.access_token ?? data.accessToken;
}

/** Os eventos que estão na fila desta credencial agora. */
export async function filaDaCredencial(clientId: string, clientSecret: string): Promise<any[]> {
  const token = await tokenDaCredencial(clientId, clientSecret);
  const res = await fetch(`${JOTAJA_BASE}/v1/events:polling`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Fila do JotaJá respondeu HTTP ${res.status}`);
  const texto = await res.text();
  const eventos = texto ? JSON.parse(texto) : [];
  return Array.isArray(eventos) ? eventos : [eventos];
}

/** Dá baixa (ACK) nestes eventos, em lotes. Devolve quantos o JotaJá aceitou. */
export async function darBaixaNaFila(clientId: string, clientSecret: string, eventos: any[]): Promise<number> {
  const token = await tokenDaCredencial(clientId, clientSecret);
  let baixados = 0;
  for (let i = 0; i < eventos.length; i += 50) {
    const lote = eventos.slice(i, i + 50).map((e) => ({
      id: e.eventId || e.id,
      orderId: e.orderId || "",
      eventType: e.eventType || e.fullCode || e.code || "",
    }));
    const res = await fetch(`${JOTAJA_BASE}/v1/events/acknowledgment`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(lote),
    });
    if (!res.ok) throw new Error(`Baixa na fila do JotaJá respondeu HTTP ${res.status}`);
    baixados += lote.length;
  }
  return baixados;
}
