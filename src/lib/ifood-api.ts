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

/** Wrapper autenticado para LEITURAS */
export async function ifoodFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = await getIfoodToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(options.headers as Record<string, string> ?? {}),
  };
  return fetch(`${IFOOD_BASE}${path}`, {
    ...options,
    headers,
  });
}

/**
 * Wrapper para ESCRITAS reais (POST/PUT/DELETE).
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

/**
 * Atualiza o tempo de preparo da loja no iFood (myPreparationTime).
 * Testa as variações oficiais da iFood Merchant API.
 */
export async function updateIfoodPreparationTime(merchantId: string, minutes: number): Promise<{ success: boolean; error?: string }> {
  try {
    const validMinutes = Math.min(70, Math.max(5, Math.round(minutes)));
    const token = await getIfoodToken();

    const headersBase = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    // Strategy 1: Standard PUT /merchant/v1.0/merchants/{merchantId}/myPreparationTime with integer body
    let res = await fetch(`${IFOOD_BASE}/merchant/v1.0/merchants/${merchantId}/myPreparationTime`, {
      method: "PUT",
      headers: headersBase,
      body: JSON.stringify(validMinutes),
    });

    if (res.ok) {
      console.log(`[iFood Sync] ✅ Tempo de preparo da loja ${merchantId} atualizado no iFood: ${validMinutes} min`);
      return { success: true };
    }

    let lastErr = await res.text();

    // Strategy 2: PUT with X-iFood-Customer-ID
    res = await fetch(`${IFOOD_BASE}/merchant/v1.0/merchants/${merchantId}/myPreparationTime`, {
      method: "PUT",
      headers: { ...headersBase, "X-iFood-Customer-ID": merchantId },
      body: JSON.stringify(validMinutes),
    });
    if (res.ok) return { success: true };

    // Strategy 3: PUT with object payload { "preparationTime": validMinutes }
    res = await fetch(`${IFOOD_BASE}/merchant/v1.0/merchants/${merchantId}/myPreparationTime`, {
      method: "PUT",
      headers: headersBase,
      body: JSON.stringify({ preparationTime: validMinutes }),
    });
    if (res.ok) return { success: true };

    // Strategy 4: POST /merchant/v1.0/merchants/{merchantId}/myPreparationTime
    res = await fetch(`${IFOOD_BASE}/merchant/v1.0/merchants/${merchantId}/myPreparationTime`, {
      method: "POST",
      headers: headersBase,
      body: JSON.stringify(validMinutes),
    });
    if (res.ok) return { success: true };

    console.error(`[iFood Sync] Erro ao atualizar tempo de preparo (${validMinutes}m) para loja ${merchantId}:`, lastErr);
    return { success: false, error: lastErr };
  } catch (err: any) {
    console.error(`[iFood Sync] Exceção ao atualizar tempo no iFood:`, err?.message);
    return { success: false, error: err?.message };
  }
}

/**
 * Extrai e calcula o preço unitário real do item do iFood,
 * levando em conta opções/sub-itens/complementos (ex: combo ou nugget com opção paga)
 * e fallbacks como i.totalPrice / quantidade.
 */
export function getIfoodItemUnitPrice(i: any): number {
  if (!i) return 0;
  const subItemsList = i.options || i.subItems || i.garnishItems || i.items || [];
  const optionsSum = Array.isArray(subItemsList)
    ? subItemsList.reduce((acc: number, s: any) => acc + ((s.price || s.unitPrice || s.addition || 0) * (s.quantity || 1)), 0)
    : 0;

  const basePrice = typeof i.unitPrice === "number" ? i.unitPrice : (typeof i.price === "number" ? i.price : 0);
  let totalUnitPrice = basePrice + optionsSum;

  if (totalUnitPrice === 0 && typeof i.totalPrice === "number" && i.totalPrice > 0 && (i.quantity || 1) > 0) {
    totalUnitPrice = i.totalPrice / (i.quantity || 1);
  } else if (totalUnitPrice === 0 && typeof i.price === "number" && i.price > 0) {
    totalUnitPrice = i.price;
  }

  return totalUnitPrice;
}

