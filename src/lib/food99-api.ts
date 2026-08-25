import { createHash } from "crypto";
import { parseJson99Food } from "./json-ids-longos";

/**
 * Cliente da API do 99Food (DiDi Food Open Platform).
 *
 * Contrato verificado contra o swagger.yaml oficial baixado do portal de
 * desenvolvedores, e cada chamada abaixo foi testada contra produção.
 *
 * ── Quem é dono de quê ──────────────────────────────────────────────────────
 * O app_id e o app_secret são do FIREHUB, não do lojista. Existe um app só —
 * "FireHub", registrado pela Grupo Hakim — e todas as lojas passam por ele. O
 * que cada loja tem é um `app_shop_id` (o identificador dela DENTRO do
 * vínculo, atribuído pelo 99Food no momento em que o lojista autoriza) e um
 * `auth_token` próprio.
 *
 * Isso é o oposto do que a tela de Integrações pedia até agora: ela solicitava
 * App ID e Secret Key de cada lojista, como se fossem dele. Não são, e nenhum
 * lojista teria de onde tirá-los — eles só existem no portal de desenvolvedor
 * da Grupo Hakim. Por isso as credenciais do app moram em variável de ambiente.
 *
 * ── Fluxo de autoatendimento ────────────────────────────────────────────────
 * 1. O lojista clica em "Conectar 99Food" no painel dele.
 * 2. getAuthorizationUrl() devolve uma URL do 99Food, gerada na hora.
 * 3. O lojista abre, entra com a conta DELE do 99Food e autoriza.
 * 4. listarLojasVinculadas() mostra a loja recém-autorizada e o app_shop_id
 *    que o 99Food deu a ela; é aí que a amarração com a nossa loja é gravada.
 * 5. getAuthToken(app_shop_id) passa a devolver o token, e os pedidos começam
 *    a chegar no webhook.
 *
 * ── Por que o passo 4 existe ────────────────────────────────────────────────
 * O desenho anterior pulava dele: mandava o nosso id da loja como app_shop_id
 * em getUrl e depois perguntava o token por esse mesmo id. Parecia fechar, mas
 * o endpoint IGNORA o app_shop_id — verificado mandando três valores
 * diferentes (o nosso id, um texto qualquer, e nenhum) e recebendo URLs
 * equivalentes, sem o parâmetro em nenhuma delas. O swagger ainda documenta
 * uma URL com `appShopId` na query; a que o 99Food devolve hoje não tem.
 *
 * Consequência prática: o lojista autorizava de verdade e a nossa tela seguia
 * dizendo "não conectado", porque perguntávamos por um id que o vínculo nunca
 * teve. É preciso listar para descobrir.
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

/**
 * Serializa o corpo mantendo id de 64 bits como NÚMERO, sem perder dígito.
 *
 * O 99Food espera `order_id` como integer, mas passar por `Number()` no
 * JavaScript arredonda um id de 19 dígitos — o mesmo estrago que
 * lib/json-ids-longos.ts conserta na entrada, só que na saída. Então o valor
 * viaja como string até o último instante e as aspas são removidas no texto
 * já serializado: é a única forma de emitir um inteiro que a linguagem não
 * consegue representar.
 */
function serializarCorpo(corpo: any, idsCrus?: string[]): string {
  const texto = JSON.stringify(corpo);
  if (!idsCrus?.length) return texto;
  return idsCrus.reduce(
    (acc, campo) => acc.replace(new RegExp(`("${campo}":)"(-?\\d+)"`, "g"), "$1$2"),
    texto
  );
}

export function food99Configurado(): boolean {
  return credenciaisDoApp() !== null;
}

async function chamar<T = any>(
  caminho: string,
  opcoes: { metodo?: "GET" | "POST"; query?: Record<string, string>; corpo?: any; idsCrus?: string[] } = {}
): Promise<RespostaFood99<T>> {
  const url = new URL(`${BASE}${caminho}`);
  for (const [k, v] of Object.entries(opcoes.query || {})) {
    url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString(), {
    method: opcoes.metodo || "GET",
    headers: { "Content-Type": "application/json" },
    body: opcoes.corpo ? serializarCorpo(opcoes.corpo, opcoes.idsCrus) : undefined,
    // O 99Food espera resposta rápida e nós também: melhor falhar e tentar de
    // novo do que segurar uma requisição do lojista por meio minuto.
    signal: AbortSignal.timeout(15000),
  });

  const texto = await res.text();
  try {
    // Mesmo cuidado da entrada do webhook: as respostas trazem shop_id e
    // order_id de 19 dígitos, e o JSON.parse nativo os arredondaria. Um
    // app_shop_id lido errado aqui é um vínculo que nunca mais fecha.
    return parseJson99Food(texto) as RespostaFood99<T>;
  } catch {
    return { errno: -1, errmsg: `Resposta não-JSON do 99Food (HTTP ${res.status}): ${texto.slice(0, 200)}` };
  }
}

/**
 * URL da página onde o LOJISTA autoriza o FireHub, com a conta dele.
 *
 * ATENÇÃO: o `app_shop_id` mandado aqui é IGNORADO pelo 99Food hoje. A URL
 * devolvida não o carrega, e mandar valores diferentes (ou nenhum) devolve a
 * mesma página. Ele segue sendo enviado porque o swagger o exige, mas NÃO
 * conte com ele para amarrar a autorização à loja: quem faz essa amarração é
 * listarLojasVinculadas(), depois que o lojista autoriza.
 *
 * A URL carrega timestamp e assinatura, então tem validade curta: gere na hora
 * do clique, nunca guarde.
 */
export async function getAuthorizationUrl(lojaId: string): Promise<{ url: string } | { erro: string }> {
  const cred = credenciaisDoApp();
  if (!cred) return { erro: "FOOD99_APP_ID / FOOD99_APP_SECRET não configurados no servidor." };

  // app_id como STRING + idsCrus, nunca Number(): o app_id tem 19 dígitos
  // (5764607734538831960) e Number() o entrega como 5764607734538832000. O
  // 99Food responde a esse app inexistente com "110006 Can't get app".
  const r = await chamar<{ url: string }>("/v1/auth/authorizationpage/getUrl", {
    metodo: "POST",
    corpo: { app_id: cred.appId, app_shop_id: lojaId },
    idsCrus: ["app_id"],
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
    corpo: { order_id: String(orderId) },
    idsCrus: ["order_id"],
  });
}

export async function cancelarPedido(authToken: string, orderId: string, motivo?: string): Promise<RespostaFood99> {
  return chamar("/v1/order/order/cancel", {
    metodo: "POST",
    query: { auth_token: authToken },
    corpo: { order_id: String(orderId), ...(motivo ? { reason: motivo } : {}) },
    idsCrus: ["order_id"],
  });
}

export async function pedidoPronto(authToken: string, orderId: string): Promise<RespostaFood99> {
  return chamar("/v1/order/order/ready", {
    metodo: "POST",
    query: { auth_token: authToken },
    corpo: { order_id: String(orderId) },
    idsCrus: ["order_id"],
  });
}

export async function pedidoEntregue(authToken: string, orderId: string): Promise<RespostaFood99> {
  return chamar("/v1/order/order/delivered", {
    metodo: "POST",
    query: { auth_token: authToken },
    corpo: { order_id: String(orderId) },
    idsCrus: ["order_id"],
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

// ── Lojas vinculadas ao app ─────────────────────────────────────────────────

/**
 * O `shop/list` exige um `sign`, e o algoritmo não está no swagger — ele diz
 * "Signature generated as explained above" e o "above" é uma página do portal
 * que não descreve a fórmula. Em vez de fixar um palpite e descobrir na
 * produção que era outro, as variantes conhecidas do padrão DiDi ficam listadas
 * aqui e o código tenta uma a uma até o 99Food aceitar.
 *
 * A que funcionar fica memorizada em `assinaturaBoa`, então o custo de
 * tentativa é pago uma vez por processo, não a cada chamada.
 */
type Assinador = (params: Record<string, string | number>, segredo: string) => string;

const md5 = (t: string) => createHash("md5").update(t, "utf8").digest("hex");

/** Pares ordenados por chave — base comum a quase todas as variantes. */
function paresOrdenados(params: Record<string, string | number>): [string, string][] {
  return Object.keys(params)
    .filter((k) => k !== "sign" && params[k] !== undefined && params[k] !== null)
    .sort()
    .map((k) => [k, String(params[k])]);
}

const VARIANTES: { nome: string; fn: Assinador }[] = [
  {
    nome: "md5(k=v&…&secret)",
    fn: (p, s) => md5(paresOrdenados(p).map(([k, v]) => `${k}=${v}`).join("&") + "&" + s),
  },
  {
    nome: "md5(k=v&…secret)",
    fn: (p, s) => md5(paresOrdenados(p).map(([k, v]) => `${k}=${v}`).join("&") + s),
  },
  {
    nome: "md5(kv…secret)",
    fn: (p, s) => md5(paresOrdenados(p).map(([k, v]) => k + v).join("") + s),
  },
  {
    nome: "md5(secret+k=v&…+secret)",
    fn: (p, s) => md5(s + paresOrdenados(p).map(([k, v]) => `${k}=${v}`).join("&") + s),
  },
  {
    nome: "md5(v…secret)",
    fn: (p, s) => md5(paresOrdenados(p).map(([, v]) => v).join("") + s),
  },
  {
    nome: "md5(k=v&…&key=secret)",
    fn: (p, s) => md5(paresOrdenados(p).map(([k, v]) => `${k}=${v}`).join("&") + "&key=" + s),
  },
];

/** Variante já confirmada nesta instância. Null = ainda não se sabe. */
let assinaturaBoa: { nome: string; fn: Assinador } | null = null;

/**
 * O `shop/list` aceita UMA chamada a cada 20 segundos — para o app inteiro,
 * não por loja. Passando disso ele responde
 * `10005 The calling frequency exceeds the setting：window: 20s, limit: 1`.
 *
 * Isso tem duas consequências que mudam o desenho:
 *
 * 1. Nada que rode em toda visita de tela pode chamar este endpoint. Com mais
 *    de uma loja abrindo Integrações ao mesmo tempo, todas veriam erro.
 * 2. Tentar as variantes de assinatura em sequência estoura o limite antes de
 *    chegar à quarta — o 10005 vira "nenhuma variante funcionou", que é um
 *    diagnóstico errado. Por isso o loop PARA no primeiro 10005 e diz o que
 *    realmente houve.
 *
 * O cache abaixo absorve o caso comum: o lojista clica em "Já autorizei" duas
 * ou três vezes seguidas, e só a primeira vira chamada de verdade.
 */
const JANELA_RATE_LIMIT_MS = 20_000;
let cacheLojas: { em: number; lojas: LojaVinculada[]; variante: string } | null = null;

export interface LojaVinculada {
  shop_id?: string;
  app_shop_id?: string;
  shop_name?: string;
  [k: string]: any;
}

/**
 * Lojas atualmente vinculadas ao app FireHub no 99Food.
 *
 * É o que fecha o autoatendimento. A página de autorização NÃO carrega o
 * app_shop_id (a doc mostra um exemplo com `appShopId` na query, mas a URL que
 * o endpoint devolve hoje não tem esse parâmetro — foi verificado mandando
 * três valores diferentes e recebendo a mesma URL). Ou seja: depois que o
 * lojista autoriza, não há como saber por qual identificador perguntar pelo
 * token dele. Esta listagem é a resposta: a loja recém-autorizada aparece aqui,
 * com o app_shop_id que o 99Food atribuiu.
 */
export async function listarLojasVinculadas(): Promise<
  { ok: true; lojas: LojaVinculada[]; variante: string } | { ok: false; erro: string; tentativas?: string[] }
> {
  const cred = credenciaisDoApp();
  if (!cred) return { ok: false, erro: "FOOD99_APP_ID / FOOD99_APP_SECRET não configurados." };

  // Dentro da janela do rate limit, devolve o que já se sabe em vez de gastar
  // a única chamada permitida — o lojista clicando "Já autorizei" duas vezes
  // seguidas é o caso comum, e a segunda não pode virar uma mensagem de erro.
  if (cacheLojas && Date.now() - cacheLojas.em < JANELA_RATE_LIMIT_MS) {
    return { ok: true, lojas: cacheLojas.lojas, variante: `${cacheLojas.variante} (cache)` };
  }

  // app_id fica STRING aqui e sai como número cru na serialização (idsCrus).
  // Number() o corromperia — são 19 dígitos — e o 99Food responderia
  // "110006 Can't get app", que parece erro de app não cadastrado e não é.
  // A assinatura também usa este valor, então precisa ser o dígito exato.
  const base = { app_id: cred.appId, timestamp: Math.floor(Date.now() / 1000), page_no: 1, page_size: 100 };

  // Só a variante já confirmada, quando existe. Sem ela, todas — mas o loop
  // para no primeiro 10005, senão as tentativas seguintes gastam a janela de
  // 20s e o resultado vira "nenhuma assinatura serviu", diagnóstico errado.
  const ordem = assinaturaBoa ? [assinaturaBoa] : VARIANTES;
  const tentativas: string[] = [];

  for (const variante of ordem) {
    const corpo = { ...base, sign: variante.fn(base, cred.appSecret) };
    const r = await chamar<any>("/v1/shop/shop/list", { metodo: "POST", corpo, idsCrus: ["app_id"] });

    if (r.errno === 0) {
      assinaturaBoa = variante;
      const d: any = r.data || {};
      const lojas: LojaVinculada[] = d.shop_list || d.list || d.shops || (Array.isArray(d) ? d : []);
      cacheLojas = { em: Date.now(), lojas, variante: variante.nome };
      return { ok: true, lojas, variante: variante.nome };
    }

    tentativas.push(`${variante.nome} → ${r.errno} ${r.errmsg}`);

    if (r.errno === 10005 || /frequency/i.test(r.errmsg || "")) {
      return {
        ok: false,
        erro: "O 99Food aceita uma consulta de lojas a cada 20 segundos. Espere um pouco e tente de novo.",
        tentativas,
      };
    }

    // Erro que não é de assinatura: insistir com outra fórmula não ajuda.
    if (!/sign/i.test(r.errmsg || "")) {
      return { ok: false, erro: `${r.errno} ${r.errmsg}`, tentativas };
    }
  }

  return { ok: false, erro: "Nenhuma variante de assinatura foi aceita pelo 99Food.", tentativas };
}
