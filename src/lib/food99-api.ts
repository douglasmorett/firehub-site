/**
 * Cliente da API do 99Food (DiDi Food Open Platform).
 *
 * Contrato verificado contra o swagger.yaml oficial baixado do portal de
 * desenvolvedores, e cada chamada abaixo foi testada contra produção.
 *
 * ── Quem é dono de quê ──────────────────────────────────────────────────────
 * O app_id e o app_secret são do FIREHUB, não do lojista. Existe um app só —
 * "FireHub", registrado pela Grupo Hakim — e todas as lojas passam por ele. O
 * que cada loja tem é um `app_shop_id` (o id dela no nosso banco) e um
 * `auth_token` próprio, emitido depois que o dono autoriza.
 *
 * Isso é o oposto do que a tela de Integrações pedia até agora: ela solicitava
 * App ID e Secret Key de cada lojista, como se fossem dele. Não são, e nenhum
 * lojista teria de onde tirá-los — eles só existem no portal de desenvolvedor
 * da Grupo Hakim. Por isso as credenciais do app moram em variável de ambiente.
 *
 * ── Fluxo de autoatendimento ────────────────────────────────────────────────
 * 1. O lojista clica em "Conectar 99Food" no painel dele.
 * 2. getAuthorizationUrl(lojaId) devolve uma URL do 99Food, gerada na hora.
 * 3. O lojista abre, entra com a conta DELE do 99Food e autoriza.
 * 4. getAuthToken(lojaId) passa a devolver o token da loja.
 * 5. Os pedidos começam a chegar no nosso webhook.
 *
 * Ninguém do FireHub precisa tocar em nada. É o mesmo desenho do iFood
 * distribuído.
 */

const BASE = process.env.FOOD99_BASE_URL || "https://openapi.didi-food.com";

/** Loja ainda não autorizou o app. Não é falha: é o estado inicial. */
export const ERRO_SEM_AUTORIZACAO = 10101;

export interface RespostaFood99<T = any> {
  errno: number;
  errmsg: string;
  requestId?: string;
  time?: number;
  data?: T;
}

/**
 * Credenciais do APP (não da loja). Ficam em variável de ambiente porque são
 * únicas para todo o FireHub.
 */
function credenciaisDoApp(): { appId: string; appSecret: string } | null {
  const appId = (process.env.FOOD99_APP_ID || "").trim();
  const appSecret = (process.env.FOOD99_APP_SECRET || "").trim();
  if (!appId || !appSecret) return null;
  return { appId, appSecret };
}

export function food99Configurado(): boolean {
  return credenciaisDoApp() !== null;
}

async function chamar<T = any>(
  caminho: string,
  opcoes: { metodo?: "GET" | "POST"; query?: Record<string, string>; corpo?: any } = {}
): Promise<RespostaFood99<T>> {
  const url = new URL(`${BASE}${caminho}`);
  for (const [k, v] of Object.entries(opcoes.query || {})) {
    url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString(), {
    method: opcoes.metodo || "GET",
    headers: { "Content-Type": "application/json" },
    body: opcoes.corpo ? JSON.stringify(opcoes.corpo) : undefined,
    // O 99Food espera resposta rápida e nós também: melhor falhar e tentar de
    // novo do que segurar uma requisição do lojista por meio minuto.
    signal: AbortSignal.timeout(15000),
  });

  const texto = await res.text();
  try {
    return JSON.parse(texto) as RespostaFood99<T>;
  } catch {
    return { errno: -1, errmsg: `Resposta não-JSON do 99Food (HTTP ${res.status}): ${texto.slice(0, 200)}` };
  }
}

/**
 * URL da página onde o LOJISTA autoriza o FireHub, com a conta dele.
 *
 * `app_shop_id` é o id da loja no nosso banco. É ele que amarra a autorização
 * à loja certa — e é o mesmo valor que volta depois em cada pedido, o que
 * elimina o palpite que o webhook fazia quando o merchantId não batia.
 *
 * A URL carrega timestamp e assinatura, então tem validade curta: gere na hora
 * do clique, nunca guarde.
 */
export async function getAuthorizationUrl(lojaId: string): Promise<{ url: string } | { erro: string }> {
  const cred = credenciaisDoApp();
  if (!cred) return { erro: "FOOD99_APP_ID / FOOD99_APP_SECRET não configurados no servidor." };

  const r = await chamar<{ url: string }>("/v1/auth/authorizationpage/getUrl", {
    metodo: "POST",
    corpo: { app_id: Number(cred.appId), app_shop_id: lojaId },
  });

  if (r.errno !== 0 || !r.data?.url) {
    return { erro: r.errmsg || "O 99Food não devolveu a URL de autorização." };
  }
  return { url: r.data.url };
}

export interface TokenDaLoja {
  auth_token: string;
  token_expiration_time: number;
  app_shop_id: string;
}

/**
 * Token da loja. Só existe depois que o dono autorizou.
 *
 * Devolve `autorizada: false` no errno 10101 em vez de tratar como erro — é o
 * estado normal de quem ainda não clicou em autorizar, e a tela precisa saber
 * diferenciar "ainda não conectou" de "deu problema".
 */
export async function getAuthToken(
  lojaId: string
): Promise<{ autorizada: true; token: TokenDaLoja } | { autorizada: false; erro?: string }> {
  const cred = credenciaisDoApp();
  if (!cred) return { autorizada: false, erro: "FOOD99_APP_ID / FOOD99_APP_SECRET não configurados." };

  const r = await chamar<TokenDaLoja>("/v1/auth/authtoken/get", {
    query: { app_id: cred.appId, app_secret: cred.appSecret, app_shop_id: lojaId },
  });

  if (r.errno === ERRO_SEM_AUTORIZACAO) return { autorizada: false };
  if (r.errno !== 0 || !r.data?.auth_token) {
    return { autorizada: false, erro: r.errmsg || "Falha ao consultar o token da loja." };
  }
  return { autorizada: true, token: r.data };
}

/**
 * Gera um token novo. O 99Food limita a uma renovação a cada dois minutos, e
 * depois de renovar é preciso buscar o valor com getAuthToken.
 */
export async function refreshAuthToken(lojaId: string): Promise<boolean> {
  const cred = credenciaisDoApp();
  if (!cred) return false;
  const r = await chamar("/v1/auth/authtoken/refresh", {
    query: { app_id: cred.appId, app_secret: cred.appSecret, app_shop_id: lojaId },
  });
  return r.errno === 0;
}

// ── Ações sobre o pedido ────────────────────────────────────────────────────
// Estas usam o auth_token DA LOJA, não as credenciais do app. Sem elas o
// pedido chega mas a loja não consegue responder ao 99Food — e pedido não
// confirmado a tempo é cancelado do lado deles.

export async function confirmarPedido(authToken: string, orderId: string): Promise<RespostaFood99> {
  return chamar("/v1/order/order/confirm", {
    metodo: "POST",
    query: { auth_token: authToken },
    corpo: { order_id: Number(orderId) },
  });
}

export async function cancelarPedido(authToken: string, orderId: string, motivo?: string): Promise<RespostaFood99> {
  return chamar("/v1/order/order/cancel", {
    metodo: "POST",
    query: { auth_token: authToken },
    corpo: { order_id: Number(orderId), ...(motivo ? { reason: motivo } : {}) },
  });
}

export async function pedidoPronto(authToken: string, orderId: string): Promise<RespostaFood99> {
  return chamar("/v1/order/order/ready", {
    metodo: "POST",
    query: { auth_token: authToken },
    corpo: { order_id: Number(orderId) },
  });
}

export async function pedidoEntregue(authToken: string, orderId: string): Promise<RespostaFood99> {
  return chamar("/v1/order/order/delivered", {
    metodo: "POST",
    query: { auth_token: authToken },
    corpo: { order_id: Number(orderId) },
  });
}

export async function detalheDoPedido(authToken: string, orderId: string): Promise<RespostaFood99> {
  return chamar("/v1/order/order/detail", {
    query: { auth_token: authToken, order_id: orderId },
  });
}

// ── Diagnóstico ─────────────────────────────────────────────────────────────

/**
 * Resposta CRUA do 99Food para a consulta de token de uma loja.
 *
 * `getAuthToken` acima traduz tudo que não é sucesso para `autorizada: false`,
 * o que serve para a tela do lojista mas apaga a informação de que a gente
 * precisa quando a integração não anda: o errno. "Não autorizada" (10101),
 * "app_shop_id inexistente" e "assinatura inválida" viram a mesma frase, e não
 * dá para saber se o lojista não clicou em autorizar ou se estamos perguntando
 * pela loja errada.
 *
 * Foi exatamente essa ambiguidade que segurou o caso da Brasa Burguer: o
 * lojista tinha autorizado, e a tela continuava dizendo "ainda não conectou".
 */
export async function diagnosticoAuth(appShopId: string): Promise<RespostaFood99<TokenDaLoja>> {
  const cred = credenciaisDoApp();
  if (!cred) return { errno: -2, errmsg: "FOOD99_APP_ID / FOOD99_APP_SECRET não configurados no servidor." };
  return chamar<TokenDaLoja>("/v1/auth/authtoken/get", {
    query: { app_id: cred.appId, app_secret: cred.appSecret, app_shop_id: appShopId },
  });
}

/** O app_id é identificador público, não segredo — pode aparecer no diagnóstico. */
export function appIdVisivel(): string | null {
  return credenciaisDoApp()?.appId ?? null;
}
