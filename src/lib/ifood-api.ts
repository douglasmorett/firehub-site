/**
 * /src/lib/ifood-api.ts
 * Helper centralizado para autenticação e chamadas à iFood Merchant API.
 * Usada em todos os cenários de homologação.
 */

import { prisma } from "./prisma";

const IFOOD_BASE = "https://merchant-api.ifood.com.br";

// Cache de token em memória (válido por ~1h)
let _token: string | null = null;
let _tokenExp = 0;

/** Obtém (ou reutiliza) o Bearer token via client_credentials */
export async function getIfoodToken(): Promise<string> {
  if (_token && Date.now() < _tokenExp) return _token;

  const clientId     = process.env.IFOOD_CLIENT_ID;
  const clientSecret = process.env.IFOOD_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("IFOOD_CLIENT_ID / IFOOD_CLIENT_SECRET não configurados.");
  }

  const res = await fetch(`${IFOOD_BASE}/authentication/v1.0/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grantType: "client_credentials", clientId, clientSecret }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`iFood auth falhou: ${res.status} — ${err.slice(0, 300)}`);
  }

  const data   = await res.json();
  _token       = data.accessToken;
  _tokenExp    = Date.now() + ((data.expiresIn ?? 3600) - 60) * 1000;
  return _token!;
}

/** Wrapper autenticado para LEITURAS (com header de homologação para os cenários de teste) */
export async function ifoodFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = await getIfoodToken();
  return fetch(`${IFOOD_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-request-homologation": "true",
      ...(options.headers ?? {}),
    },
  });
}

/**
 * Wrapper para ESCRITAS reais (POST/PUT/DELETE).
 * Sem x-request-homologation para que as mudanças
 * reflitam de verdade no Portal do Parceiro iFood.
 */
export async function ifoodMutate(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = await getIfoodToken();
  return fetch(`${IFOOD_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(options.headers ?? {}),
    },
  });
}

/** merchantId principal (UUID) */
export function getMerchantId(): string {
  const id = process.env.IFOOD_MERCHANT_UUID;
  if (!id) throw new Error("IFOOD_MERCHANT_UUID não configurado.");
  return id;
}

/** Obtém o merchantId específico do usuário logado no banco */
export async function getMerchantIdForUser(email: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { ifoodMerchantId: true }
  });
  const id = user?.ifoodMerchantId;
  if (!id) throw new Error("Você não possui uma loja iFood integrada.");
  return id;
}
