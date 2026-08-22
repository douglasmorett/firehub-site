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

  const clientId     = process.env.IFOOD_CLIENT_ID || "f003da60-a255-4a6f-a1fb-f94819c6f286";
  const clientSecret = process.env.IFOOD_CLIENT_SECRET || "107a0sf9as7pyuq2fuxahnlvurw8fngt2pkm049j10otj10pgme8874hf0u8ayxcjv9pkndicdposictjzv4708jtmy3p0q6mx51";

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

// ── APP DISTRIBUÍDO ─────────────────────────────────────────────────────────
// Cada loja autoriza o MESMO app (clientId distribuído) e passa a constar na
// aba Permissões dele. Quem enxerga essas lojas e recebe os eventos delas é o
// token de client_credentials DO APP — não o token que o lojista gera no fluxo
// de authorization_code.
//
// Foi por isso que a Pastel da Paulista nunca recebeu pedido: o sistema tentava
// descobrir a loja com o token do lojista, e o GET /merchants respondia [] —
// confirmado no log de produção com verifier presente e status 200. No portal
// do desenvolvedor, as três lojas aparecem Ativas.
let _tokenDist: string | null = null;
let _tokenDistExp = 0;

/** Token do APP distribuído (client_credentials). Cobre todas as lojas autorizadas. */
export async function getIfoodDistributedToken(): Promise<string> {
  if (_tokenDist && Date.now() < _tokenDistExp) return _tokenDist;

  const clientId = process.env.IFOOD_CLIENT_ID_DISTRIBUTED;
  const clientSecret = process.env.IFOOD_CLIENT_SECRET_DISTRIBUTED;
  if (!clientId || !clientSecret) {
    throw new Error("IFOOD_CLIENT_ID_DISTRIBUTED / IFOOD_CLIENT_SECRET_DISTRIBUTED não configurados");
  }

  const res = await fetch(`${IFOOD_BASE}/authentication/v1.0/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grantType: "client_credentials", clientId, clientSecret }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`iFood auth distribuído falhou: ${res.status} — ${err.slice(0, 300)}`);
  }

  const data = await res.json();
  _tokenDist = data.accessToken;
  _tokenDistExp = Date.now() + ((data.expiresIn ?? 3600) - 60) * 1000;
  return _tokenDist!;
}

/** Lojas autorizadas ao app distribuído (as que aparecem em Permissões). */
export async function listIfoodDistributedMerchants(): Promise<{ id: string; name: string }[]> {
  const token = await getIfoodDistributedToken();
  const res = await fetch(`${IFOOD_BASE}/merchant/v1.0/merchants`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) {
    console.error(`[iFood] listar merchants do app falhou: ${res.status}`);
    return [];
  }
  const data = await res.json();
  const lista = Array.isArray(data) ? data : (data?.merchants || data?.data || []);
  return lista
    .map((m: any) => ({ id: m.id || m.merchantId, name: m.name || m.corporateName || "" }))
    .filter((m: any) => !!m.id);
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

  // A forma mais segura e exata é usar o totalPrice da linha (se existir), 
  // pois o iFood já calculou (unitPrice + soma das opções) * quantity.
  if (typeof i.totalPrice === "number" && i.totalPrice > 0 && (i.quantity || 1) > 0) {
    return i.totalPrice / (i.quantity || 1);
  }

  // Fallback: tentar calcular manualmente se não vier totalPrice
  const subItemsList = i.options || i.subItems || i.garnishItems || i.items || [];
  const optionsSum = Array.isArray(subItemsList)
    ? subItemsList.reduce((acc: number, s: any) => {
        // Se tiver unitPrice, multiplica pela quantidade. Senão, assume que o price já é o total da opção
        const unitAdd = typeof s.unitPrice === "number" ? s.unitPrice : (typeof s.addition === "number" ? s.addition : null);
        if (unitAdd !== null) {
          return acc + (unitAdd * (s.quantity || 1));
        }
        return acc + (s.price || 0);
      }, 0)
    : 0;

  const basePrice = typeof i.unitPrice === "number" ? i.unitPrice : (typeof i.price === "number" ? i.price : 0);
  let totalUnitPrice = basePrice + optionsSum;

  if (totalUnitPrice === 0 && typeof i.price === "number" && i.price > 0) {
    totalUnitPrice = i.price;
  }

  return totalUnitPrice;
}

