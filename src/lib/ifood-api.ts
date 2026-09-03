/**
 * /src/lib/ifood-api.ts
 * Helper centralizado para autenticação e chamadas à iFood Merchant API.
 * Usada em todos os cenários de homologação.
 */

import { prisma } from "./prisma";
import { segredoObrigatorio } from "./segredos";

const IFOOD_BASE = "https://merchant-api.ifood.com.br";

// Cache de token em memória (válido por ~1h)
let _token: string | null = null;
let _tokenExp = 0;

/** Obtém (ou reutiliza) o Bearer token via client_credentials */
export async function getIfoodToken(): Promise<string> {
  if (_token && Date.now() < _tokenExp) return _token;

  const clientId     = segredoObrigatorio("IFOOD_CLIENT_ID");
  const clientSecret = segredoObrigatorio("IFOOD_CLIENT_SECRET");

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
// NÃO existe client_credentials aqui. Confirmado contra a API de produção:
//
//   POST /authentication/v1.0/oauth/token  grantType=client_credentials
//   → 400 {"error":{"code":"BadRequest","message":
//          "Unsupported grant type client_credentials to client cabc4064-…"}}
//
// e confirmado no portal do desenvolvedor: o app "FireHub Distribuído" é do
// tipo *Authorization Code*. Ou seja, não há "token do app" que enxergue as
// lojas — cada loja tem o SEU access_token, nascido do código que o lojista
// cola, e é com ele que se faz polling, buscar pedido e dar ACK.
//
// Outro achado que explica o bug da Pastel da Paulista: em Permissões, os
// módulos autorizados de cada loja são apenas **Order** e **Events**. Sem o
// módulo *Merchant*, o GET /merchant/v1.0/merchants responde 200 [] mesmo com
// token perfeitamente válido. Por isso a descoberta do merchantId NÃO pode
// depender daquele endpoint: o merchantId vem dentro dos próprios eventos.

/**
 * Token da PRÓPRIA loja (app distribuído), renovando via refresh_token quando
 * necessário.
 *
 * Sem isto os tokens simplesmente morriam: em produção a Hakim estava com o
 * token vencido desde 07/08 e a Brasa Burguer desde 22/08 03:44, ambos
 * devolvendo 401 "token expired" — ninguém nunca os renovou.
 *
 * Retorna null quando a loja não tem credencial utilizável; nunca cai no token
 * de outra loja, o que cruzaria dados entre donos diferentes.
 */
export async function getTokenDaLojaIfood(userId: string): Promise<string | null> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      ifoodAccessToken: true,
      ifoodRefreshToken: true,
      ifoodTokenExpiresAt: true,
    },
  });
  if (!u) return null;

  const margem = 5 * 60 * 1000; // renova 5 min antes de vencer
  const valido =
    !!u.ifoodAccessToken &&
    !!u.ifoodTokenExpiresAt &&
    u.ifoodTokenExpiresAt.getTime() - margem > Date.now();

  if (valido) return u.ifoodAccessToken!;

  if (!u.ifoodRefreshToken) {
    // Sem refresh não há como renovar. Devolve o access token só se ainda não
    // venceu de fato — melhor uma última chamada válida do que nenhuma.
    if (u.ifoodAccessToken && u.ifoodTokenExpiresAt && u.ifoodTokenExpiresAt.getTime() > Date.now()) {
      return u.ifoodAccessToken;
    }
    return null;
  }

  const clientId = process.env.IFOOD_CLIENT_ID_DISTRIBUTED;
  const clientSecret = process.env.IFOOD_CLIENT_SECRET_DISTRIBUTED;
  if (!clientId || !clientSecret) {
    console.error("[iFood] IFOOD_CLIENT_ID_DISTRIBUTED / IFOOD_CLIENT_SECRET_DISTRIBUTED não configurados — não dá para renovar token de loja.");
    return u.ifoodAccessToken ?? null;
  }

  try {
    const res = await fetch(`${IFOOD_BASE}/authentication/v1.0/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grantType: "refresh_token",
        clientId,
        clientSecret,
        refreshToken: u.ifoodRefreshToken,
      }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      console.error(`[iFood] refresh_token falhou para a loja ${userId}: ${res.status} ${err.slice(0, 200)}`);
      return u.ifoodAccessToken ?? null;
    }

    const data = await res.json();
    if (!data?.accessToken) return u.ifoodAccessToken ?? null;

    await prisma.user.update({
      where: { id: userId },
      data: {
        ifoodAccessToken: data.accessToken,
        ifoodRefreshToken: data.refreshToken || u.ifoodRefreshToken,
        ifoodTokenExpiresAt: new Date(Date.now() + ((data.expiresIn ?? 3600) - 60) * 1000),
      },
    });

    console.log(`[iFood] Token da loja ${userId} renovado.`);
    return data.accessToken as string;
  } catch (e: any) {
    console.error(`[iFood] Erro ao renovar token da loja ${userId}:`, e?.message);
    return u.ifoodAccessToken ?? null;
  }
}

/**
 * Descobre os merchantIds que um access_token de loja alcança, lendo os
 * eventos da fila.
 *
 * É o único caminho possível neste app: o módulo Merchant não está autorizado,
 * então /merchant/v1.0/merchants responde [].
 *
 * NÃO envia acknowledgment — os eventos continuam na fila para o cron
 * processar normalmente. Só se espia quem é o dono.
 */
export async function descobrirMerchantsPorEventos(accessToken: string): Promise<string[]> {
  try {
    const res = await fetch(`${IFOOD_BASE}/events/v1.0/events:polling`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return [];
    const texto = await res.text();
    const eventos = texto ? JSON.parse(texto) : [];
    if (!Array.isArray(eventos)) return [];
    return [...new Set(eventos.map((e: any) => e?.merchantId).filter(Boolean))] as string[];
  } catch {
    return [];
  }
}

/**
 * Os merchants que a fila desta loja revela, JÁ COM O NOME de cada um.
 *
 * O nome não vem no evento — vem do detalhe de um pedido daquele merchant
 * (`merchant.name`). É um GET a mais por merchant, e vale cada um: sem ele, a
 * escolha que sobra para o lojista é entre dois UUIDs, e ninguém sabe qual é a
 * sua loja olhando para `469a9863-…`. Com o nome, ele lê "Ragnar Burger" e
 * "Tadala Burger" e responde na hora.
 *
 * Por que isso existe: a conta do lojista no iFood pode ter MAIS DE UMA loja
 * autorizada ao app, e aí a fila traz eventos das duas. Sem saber qual é qual,
 * o vínculo automático se recusa a escolher (e está certo: adotar o merchant
 * errado faz o pedido de uma loja cair no painel da outra). O resultado era a
 * loja ficar sem pedido nenhum, para sempre e sem explicação na tela.
 *
 * Espiar a fila é seguro: sem `acknowledgment` o iFood mantém tudo lá.
 */
export async function descobrirMerchantsComNome(
  accessToken: string
): Promise<{ merchantId: string; nome: string }[]> {
  try {
    const res = await fetch(`${IFOOD_BASE}/events/v1.0/events:polling`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return [];
    const texto = await res.text();
    const eventos = texto ? JSON.parse(texto) : [];
    if (!Array.isArray(eventos)) return [];

    // Um pedido por merchant basta para descobrir o nome.
    const umPedidoPorMerchant = new Map<string, string>();
    for (const e of eventos) {
      if (e?.merchantId && e?.orderId && !umPedidoPorMerchant.has(e.merchantId)) {
        umPedidoPorMerchant.set(e.merchantId, e.orderId);
      }
    }

    const saida: { merchantId: string; nome: string }[] = [];
    for (const [merchantId, orderId] of umPedidoPorMerchant) {
      let nome = "";
      try {
        const r = await fetch(`${IFOOD_BASE}/order/v1.0/orders/${orderId}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (r.ok) nome = (await r.json())?.merchant?.name || "";
      } catch {
        // Sem o nome ainda dá para escolher pelo UUID — pior, mas não trava.
      }
      saida.push({ merchantId, nome });
    }
    return saida;
  } catch {
    return [];
  }
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

