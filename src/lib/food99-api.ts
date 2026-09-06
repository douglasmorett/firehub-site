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
 * ── Autorizar NÃO é vincular (doc oficial, lida em 06/09/2026) ─────────────
 * O `getUrl` oficial aceita SÓ `app_id`. O `app_shop_id` que este arquivo
 * mandava nele nunca chegou a lugar nenhum — e as duas leituras anteriores
 * ("o endpoint ignora" / "ele viaja dentro do uid") eram tentativas de
 * explicar um vínculo que, na verdade, alguém criou à mão no portal.
 *
 * O que a página do getUrl faz é a ETAPA 1: o lojista AUTORIZA o app. O
 * vínculo — o `app_shop_id`, o token, o que o webhook enxerga — é a ETAPA 2, e
 * nasce no `shopBind` (v3), chamado por NÓS, com o id que NÓS escolhemos. Quem
 * autorizou e ainda não foi vinculado aparece no `getAuthorizedShops` (v3) com
 * `bound_flag = 0`. O `shop/list` v1 lista só quem já está vinculado — por
 * isso uma loja recém-autorizada nunca aparecia nele.
 *
 * Foi exatamente o Frangoso: autorizou três vezes, e a API respondia 10101
 * porque ninguém tinha feito a etapa 2. Ver food99-vinculo.ts.
 */

const BASE = process.env.FOOD99_BASE_URL || "https://openapi.didi-food.com";

/**
 * Host da documentação OFICIAL (developer-food.99app.com → Documentos do
 * desenvolvedor → Food): `https://openapi.99food.com`. O BASE acima aponta para
 * `openapi.didi-food.com`, que respondeu a tudo até 04/09/2026 e desde então
 * diz que o app não tem loja nenhuma. Os endpoints v3 (getAuthorizedShops,
 * shopBind) só estão documentados neste host — e o diagnóstico sonda os dois.
 */
const BASE_V3 = process.env.FOOD99_BASE_URL_V3 || "https://openapi.99food.com";

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
  opcoes: { metodo?: "GET" | "POST"; query?: Record<string, string>; corpo?: any; idsCrus?: string[]; base?: string } = {}
): Promise<RespostaFood99<T>> {
  const url = new URL(`${opcoes.base || BASE}${caminho}`);
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
 * A doc oficial só aceita `app_id` aqui — o `app_shop_id` segue no corpo por
 * compatibilidade, mas NÃO amarra nada. A página é a etapa 1 (o lojista
 * autoriza); quem amarra o id da loja é o `shopBind`, depois. Um link serve
 * para qualquer loja que o dono escolher autorizar na página.
 *
 * A URL vale 7 dias segundo a doc, mas carrega timestamp e assinatura: gere na
 * hora do clique, nunca guarde.
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
 * Última tentativa de criar token, por loja. O 99Food aceita um refresh a cada
 * dois minutos, e esta função é chamada em laço pela tela de Integrações.
 */
const ultimoRefresh = new Map<string, number>();
const INTERVALO_REFRESH_MS = 2 * 60_000;

/**
 * Token da loja.
 *
 * ── O que o 10101 significa de verdade ──────────────────────────────────────
 *
 * A doc do `authtoken/get` diz, com todas as letras: *"If you don't have a
 * auth token yet or the auth token expired, please call auth/authtoken/refresh
 * api first."* Ou seja, 10101 responde a DUAS perguntas ao mesmo tempo:
 *
 *   - a loja não autorizou o app (aí não há o que fazer aqui), OU
 *   - a loja autorizou e **ainda não existe token** — ou o que existia caducou.
 *
 * O código tratava as duas como "não autorizada" e desistia. `refreshAuthToken`
 * só era chamado quando o `get` DAVA CERTO e o vencimento estava perto — não
 * havia caminho nenhum que se recuperasse de um 10101.
 *
 * O estrago disso apareceu inteiro em 06/09/2026:
 *
 *   - A Brasa Burguer parou de receber pedido em 04/09 01:08, do nada. O
 *     `shop/list` passou a devolver `total: 0` e todo `authtoken/get` do app
 *     virou 10101 — inclusive o dela, que recebia pedido no dia anterior.
 *   - O Frangoso autorizou de verdade (o portal registrou a hora) e a tela
 *     seguia dizendo "não autorizada", porque loja recém-autorizada ainda não
 *     tem token: é exatamente o caso que a doc manda resolver com refresh.
 *
 * Então agora o 10101 vira uma tentativa de criar o token, e só depois disso
 * "não autorizada" é uma resposta. O intervalo existe porque o refresh é
 * limitado a um a cada dois minutos e a tela pergunta de 5 em 5 segundos.
 */
export async function getAuthToken(
  lojaId: string
): Promise<{ autorizada: true; token: TokenDaLoja } | { autorizada: false; erro?: string }> {
  const cred = credenciaisDoApp();
  if (!cred) return { autorizada: false, erro: "FOOD99_APP_ID / FOOD99_APP_SECRET não configurados." };

  const consultar = () =>
    chamar<TokenDaLoja>("/v1/auth/authtoken/get", {
      query: { app_id: cred.appId, app_secret: cred.appSecret, app_shop_id: lojaId },
    });

  const r = await consultar();

  if (r.errno === ERRO_SEM_AUTORIZACAO) {
    const ultima = ultimoRefresh.get(lojaId) ?? 0;
    if (Date.now() - ultima < INTERVALO_REFRESH_MS) return { autorizada: false };
    ultimoRefresh.set(lojaId, Date.now());

    console.log(`[99Food] ${lojaId} sem token (10101) — criando um com authtoken/refresh`);
    if (!(await refreshAuthToken(lojaId))) {
      // Refresh recusado é a resposta honesta de "esta loja não autorizou o
      // app": não há vínculo para o qual criar token.
      return { autorizada: false };
    }

    // "This api always generate a new token, and you need to get it with
    // auth/authtoken/get api" — por isso a segunda consulta.
    const novo = await consultar();
    if (novo.errno === 0 && novo.data?.auth_token) {
      console.log(`[99Food] ${lojaId} token criado — vence em ${new Date(novo.data.token_expiration_time * 1000).toISOString()}`);
      return { autorizada: true, token: novo.data };
    }
    return {
      autorizada: false,
      erro: novo.errno === ERRO_SEM_AUTORIZACAO ? undefined : novo.errmsg,
    };
  }

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

/**
 * ── Cada uma destas tem uma forma DIFERENTE, e o swagger é quem manda ───────
 *
 * As quatro estavam escritas do mesmo jeito — POST, `auth_token` na query,
 * `order_id` no corpo — como se fossem variações de uma só. Não são, e nenhuma
 * das quatro estava certa. Isso passou despercebido porque nunca foram
 * exercitadas: sem pedido chegando, nada aqui chegou a ser chamado uma vez.
 *
 *   confirm    POST, auth_token e order_id NO CORPO (os dois `required`)
 *   cancel     POST, mesma coisa + `reason_id` inteiro, que é obrigatório
 *   ready      GET, auth_token e order_id na QUERY
 *   delivered  GET, na query — e só para entrega da própria loja
 *
 * Fonte: .99food-docs/swagger.yaml, /v1/order/order/*.
 */

export async function confirmarPedido(authToken: string, orderId: string): Promise<RespostaFood99> {
  return chamar("/v1/order/order/confirm", {
    metodo: "POST",
    corpo: { auth_token: authToken, order_id: String(orderId) },
    idsCrus: ["order_id"],
  });
}

/**
 * Motivo do cancelamento pela loja.
 *
 * O swagger lista os códigos aceitos (1010, 1020, 1030, 1040, 1050, 1060,
 * 1080) e NÃO diz o que cada um significa — o único com nome é o 1010, que é o
 * exemplo do próprio documento. Então 1010 é o padrão daqui, e quem souber o
 * código certo passa por cima. Mandar um código fora da lista é recusa na hora;
 * não mandar nenhum também, porque `reason_id` é `required`.
 */
export const MOTIVOS_CANCELAMENTO_99 = new Set([1010, 1020, 1030, 1040, 1050, 1060, 1080]);
export const MOTIVO_CANCELAMENTO_PADRAO = 1010;

/**
 * O código que chega da tela é do iFood (`501` e parentes), e o 99Food só
 * aceita os sete da lista acima. Repassar o 501 direto seria trocar "cancelou
 * no 99Food" por "o 99Food recusou o cancelamento" — com o cliente esperando
 * uma comida que a loja já parou de fazer. Código de fora da lista vira o
 * padrão, que cancela de verdade.
 */
function motivoValido(reasonId?: number): number {
  return reasonId != null && MOTIVOS_CANCELAMENTO_99.has(reasonId)
    ? reasonId
    : MOTIVO_CANCELAMENTO_PADRAO;
}

export async function cancelarPedido(
  authToken: string,
  orderId: string,
  motivo?: string,
  reasonId?: number
): Promise<RespostaFood99> {
  return chamar("/v1/order/order/cancel", {
    metodo: "POST",
    corpo: {
      auth_token: authToken,
      order_id: String(orderId),
      reason_id: motivoValido(reasonId),
      ...(motivo ? { reason: motivo } : {}),
    },
    idsCrus: ["order_id"],
  });
}

export async function pedidoPronto(authToken: string, orderId: string): Promise<RespostaFood99> {
  return chamar("/v1/order/order/ready", {
    query: { auth_token: authToken, order_id: String(orderId) },
  });
}

/**
 * ATENÇÃO: o swagger diz "Only used for self-delivery orders". Num pedido que o
 * entregador do 99 leva, quem dá baixa é a DiDi — chamar isto ali é, na melhor
 * das hipóteses, um erro devolvido. Quem chama tem que conferir `deliveryBy`.
 */
export async function pedidoEntregue(authToken: string, orderId: string): Promise<RespostaFood99> {
  return chamar("/v1/order/order/delivered", {
    query: { auth_token: authToken, order_id: String(orderId) },
  });
}

export async function detalheDoPedido(authToken: string, orderId: string): Promise<RespostaFood99> {
  return chamar("/v1/order/order/detail", {
    query: { auth_token: authToken, order_id: orderId },
  });
}

export interface LojaNoNoveNove {
  nome: string | null;
  shopId: string | null;
  appShopId: string | null;
  endereco: string | null;
}

/**
 * Nome e dados da loja como ela aparece no 99Food.
 *
 * Existe porque a tela dizia só "🟢 Loja autorizada no 99Food", sem dizer QUAL.
 * Com uma loja já é ruim (o lojista não confere se ligou a certa); com várias na
 * mesma conta seria impossível saber qual desligar.
 *
 * `shop/list` não serve para isto — ele devolve só ids (app_id, shop_id,
 * app_shop_id, city_id), sem nome. Quem tem o nome é o `shop/detail`, e ele
 * pede o auth_token DA LOJA, não as credenciais do app.
 *
 * O cache existe porque a tela de Integrações abre com frequência e o nome
 * muda raramente. Cinco minutos deixam a renomeação aparecer rápido sem
 * transformar cada abertura de tela numa ida à API deles.
 */
const cacheLoja = new Map<string, { em: number; loja: LojaNoNoveNove }>();
const VALIDADE_CACHE_LOJA_MS = 5 * 60_000;

export async function detalheDaLoja(authToken: string): Promise<LojaNoNoveNove | null> {
  const emCache = cacheLoja.get(authToken);
  if (emCache && Date.now() - emCache.em < VALIDADE_CACHE_LOJA_MS) return emCache.loja;

  const r = await chamar<any>("/v1/shop/shop/detail", { query: { auth_token: authToken } });
  if (r.errno !== 0 || !r.data) return null;

  const d = r.data;
  const loja: LojaNoNoveNove = {
    nome: d.name ? String(d.name).trim() : null,
    shopId: d.shop_id != null ? String(d.shop_id) : null,
    appShopId: d.app_shop_id ? String(d.app_shop_id) : null,
    endereco: [d.address, d.poi_name].filter(Boolean).map((s: any) => String(s).trim())[0] || null,
  };
  cacheLoja.set(authToken, { em: Date.now(), loja });
  return loja;
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
/**
 * Resposta CRUA do `authtoken/refresh`. `refreshAuthToken` devolve só true/false,
 * e em 06/09/2026 o "false" escondeu a pergunta que importava: o refresh falhou
 * POR QUÊ? "Loja não vinculada", "limite de 2 minutos" e "app inválido" viram o
 * mesmo boolean — e cada um leva a um conserto diferente.
 */
export async function diagnosticoRefresh(appShopId: string): Promise<RespostaFood99> {
  const cred = credenciaisDoApp();
  if (!cred) return { errno: -2, errmsg: "FOOD99_APP_ID / FOOD99_APP_SECRET não configurados no servidor." };
  return chamar("/v1/auth/authtoken/refresh", {
    query: { app_id: cred.appId, app_secret: cred.appSecret, app_shop_id: appShopId },
  });
}

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
let cacheLojas: { em: number; lojas: LojaVinculada[]; variante: string; cru: any } | null = null;

export interface LojaVinculada {
  shop_id?: string;
  app_shop_id?: string;
  shop_name?: string;
  [k: string]: any;
}

/**
 * Acha a lista de lojas dentro da resposta, seja qual for o nome do campo.
 *
 * Em 06/09/2026 o `shop/list` respondeu `errno 0` e a leitura antiga
 * (`shop_list` / `list` / `shops`) devolveu ZERO lojas — com duas vinculadas de
 * verdade: a Brasa Burguer, que recebe pedido todo dia, e o Frangoso,
 * autorizado minutos antes. Lista vazia com `ok: true` vira "Loja ainda não
 * autorizada" na tela do lojista, sem erro nenhum. É o pior tipo de defeito,
 * porque parece resposta.
 *
 * Como o que está em dúvida é justamente o NOME do campo, procurar por nome de
 * novo seria repetir a aposta. Isto procura pela FORMA: o primeiro array de
 * objetos que tenham `shop_id` ou `app_shop_id`, em qualquer profundidade. E,
 * quando nem assim acha, quem chama continua com o payload cru em mãos — é o
 * que o diagnóstico mostra, em vez de a gente adivinhar de novo.
 */
function lojasDaResposta(d: any, profundidade = 0): LojaVinculada[] {
  if (!d || profundidade > 4) return [];

  if (Array.isArray(d)) {
    const parecemLojas = d.some(
      (x) => x && typeof x === "object" && ("shop_id" in x || "app_shop_id" in x)
    );
    return parecemLojas ? (d as LojaVinculada[]) : [];
  }

  if (typeof d !== "object") return [];

  for (const valor of Object.values(d)) {
    const achou = lojasDaResposta(valor, profundidade + 1);
    if (achou.length) return achou;
  }
  return [];
}

/**
 * Lojas atualmente vinculadas ao app FireHub no 99Food.
 *
 * É o resgate do autoatendimento. Quando o vínculo nasce com o app_shop_id
 * certo, `getAuthToken(lojaId)` já resolve e ninguém precisa desta chamada.
 * Ela existe para o caso contrário: o lojista autorizou por um link gerado no
 * painel de outra loja, ou por fora do FireHub, e o vínculo carrega um
 * identificador que não é o nosso. Aí a loja recém-autorizada só aparece aqui.
 */
export async function listarLojasVinculadas(): Promise<
  | { ok: true; lojas: LojaVinculada[]; variante: string; cru?: any }
  | { ok: false; erro: string; tentativas?: string[] }
> {
  const cred = credenciaisDoApp();
  if (!cred) return { ok: false, erro: "FOOD99_APP_ID / FOOD99_APP_SECRET não configurados." };

  // Dentro da janela do rate limit, devolve o que já se sabe em vez de gastar
  // a única chamada permitida — o lojista clicando "Já autorizei" duas vezes
  // seguidas é o caso comum, e a segunda não pode virar uma mensagem de erro.
  if (cacheLojas && Date.now() - cacheLojas.em < JANELA_RATE_LIMIT_MS) {
    return {
      ok: true,
      lojas: cacheLojas.lojas,
      variante: `${cacheLojas.variante} (cache)`,
      cru: cacheLojas.cru,
    };
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
      const d: any = r.data ?? {};
      const lojas = lojasDaResposta(d);

      // Resposta aceita e nenhuma loja reconhecida é sinal de que o formato
      // mudou (ou nunca foi o que supomos). Fica no log porque é a única
      // chance de descobrir isso sem alguém abrir o diagnóstico na hora certa
      // — e é barato: só acontece quando a lista vem vazia.
      if (lojas.length === 0) {
        console.warn(
          "[99Food] shop/list aceito e sem loja reconhecida. Payload cru:",
          JSON.stringify(d).slice(0, 1000)
        );
      }

      cacheLojas = { em: Date.now(), lojas, variante: variante.nome, cru: d };
      return { ok: true, lojas, variante: variante.nome, cru: d };
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

// ── v3: autorização e vínculo por API ───────────────────────────────────────
//
// O que a doc oficial diz, e o swagger v1 não dizia: autorizar e vincular são
// DUAS coisas. O lojista autoriza na página do getUrl; o vínculo — o
// app_shop_id, o token, o que o webhook enxerga — nasce no `shopBind`, chamado
// por NÓS, com o id que NÓS escolhemos. Sem esta chamada a loja fica
// "autorizada" no painel do lojista e invisível para a API, para sempre. Foi
// exatamente o Frangoso em 06/09/2026.
//
// Os dois endpoints têm acesso controlado ("If you are unable to use it, please
// contact us"): 10006 aqui é "pedir liberação ao 99Food", não bug nosso.

/**
 * Assinatura como a doc oficial descreve (Authentication & Signature
 * Mechanism): chaves em ordem ASCII, `k=v` unidas por `&`, segredo colado no
 * fim SEM `&`, MD5. Duas regras que não estão no swagger e decidem o
 * `shopBind`: valor vazio não entra, e array/objeto entra como a string
 * literal `Array` (`shop_infos=Array`) — é assim que o PHP deles serializa, e
 * a doc mostra o exemplo em Python fazendo o mesmo de propósito.
 */
function assinarOficial(params: Record<string, unknown>, segredo: string): string {
  const pares = Object.keys(params)
    .filter((k) => k !== "sign" && params[k] !== undefined && params[k] !== null && params[k] !== "")
    .sort()
    .map((k) => {
      const v = params[k];
      const texto = typeof v === "object" ? "Array" : String(v);
      return `${k}=${texto}`;
    });
  return md5(pares.join("&") + segredo);
}

export interface LojaAutorizada {
  shopId: string;
  nome: string | null;
  /** Só vem quando a loja já está vinculada ao app. */
  appShopId: string | null;
  vinculada: boolean;
}

let cacheAutorizadas: { em: number; lojas: LojaAutorizada[]; cru: any } | null = null;
const CACHE_AUTORIZADAS_MS = 15_000;

/**
 * Lojas que autorizaram o app — vinculadas ou não (`bound_flag`).
 *
 * É a única forma de descobrir, por API, quem autorizou e ainda espera o
 * vínculo. A tela de Integrações pergunta isto de 25 em 25s enquanto o
 * lojista autoriza, daí o cache curto.
 */
export async function listarLojasAutorizadas(): Promise<
  { ok: true; lojas: LojaAutorizada[]; cru: any } | { ok: false; errno: number; erro: string; cru?: any }
> {
  const cred = credenciaisDoApp();
  if (!cred) return { ok: false, errno: -2, erro: "FOOD99_APP_ID / FOOD99_APP_SECRET não configurados." };

  if (cacheAutorizadas && Date.now() - cacheAutorizadas.em < CACHE_AUTORIZADAS_MS) {
    return { ok: true, lojas: cacheAutorizadas.lojas, cru: cacheAutorizadas.cru };
  }

  const lojas: LojaAutorizada[] = [];
  let cru: any = null;

  // A doc recomenda páginas de 5 a 15 (máximo 50) para não estourar timeout.
  for (let pagina = 1; pagina <= 10; pagina++) {
    const base = { app_id: cred.appId, timestamp: Math.floor(Date.now() / 1000), page_no: pagina, page_size: 15 };
    const corpo = { ...base, sign: assinarOficial(base, cred.appSecret) };
    const r = await chamar<any>("/v3/auth/authorization/getAuthorizedShops", {
      metodo: "POST",
      corpo,
      idsCrus: ["app_id"],
      base: BASE_V3,
    });

    if (r.errno !== 0) {
      return {
        ok: false,
        errno: r.errno,
        erro:
          r.errno === 10006
            ? "O 99Food não liberou o endpoint getAuthorizedShops para este app (10006 Permission denied). É preciso pedir a liberação ao suporte deles."
            : `${r.errno} ${r.errmsg}`,
        cru: r,
      };
    }

    const d: any = r.data ?? {};
    if (pagina === 1) cru = d;
    for (const s of Array.isArray(d.shops) ? d.shops : []) {
      if (s?.shop_id == null) continue;
      lojas.push({
        shopId: String(s.shop_id),
        nome: s.shop_name ? String(s.shop_name).trim() : null,
        appShopId: s.app_shop_id ? String(s.app_shop_id) : null,
        vinculada: Number(s.bound_flag) === 1,
      });
    }
    if (!d.total_page || pagina >= Number(d.total_page)) break;
  }

  cacheAutorizadas = { em: Date.now(), lojas, cru };
  return { ok: true, lojas, cru };
}

export interface VinculoFeito {
  shopId: string;
  appShopId: string;
  authToken: string;
  expiraEm: number;
}

/**
 * Cria o vínculo — a etapa 2. Aceita até 50 lojas; cada uma volta em
 * `sucesso` (já com o token) ou em `falha` (com o motivo do 99Food). Só existe
 * em produção, e só para loja que autorizou e ainda não está vinculada.
 */
export async function vincularLojas(itens: { shopId: string; appShopId: string }[]): Promise<
  | { ok: true; sucesso: VinculoFeito[]; falha: { shopId: string; appShopId: string; motivo: string }[]; cru: any }
  | { ok: false; errno: number; erro: string; cru?: any }
> {
  const cred = credenciaisDoApp();
  if (!cred) return { ok: false, errno: -2, erro: "FOOD99_APP_ID / FOOD99_APP_SECRET não configurados." };
  if (itens.length === 0 || itens.length > 50) return { ok: false, errno: -3, erro: "Informe de 1 a 50 lojas." };

  // shop_id vai como INTEIRO cru (idsCrus), igual ao app_id: são 19 dígitos.
  const shop_infos = itens.map((i) => ({ shop_id: i.shopId, app_shop_id: i.appShopId }));
  const base = { app_id: cred.appId, timestamp: Math.floor(Date.now() / 1000), shop_infos };
  const corpo = { ...base, sign: assinarOficial(base, cred.appSecret) };
  const r = await chamar<any>("/v3/auth/authorization/shopBind", {
    metodo: "POST",
    corpo,
    idsCrus: ["app_id", "shop_id"],
    base: BASE_V3,
  });

  if (r.errno !== 0) {
    return {
      ok: false,
      errno: r.errno,
      erro:
        r.errno === 10006
          ? "O 99Food não liberou o endpoint shopBind para este app (10006 Permission denied). É preciso pedir a liberação ao suporte deles."
          : `${r.errno} ${r.errmsg}`,
      cru: r,
    };
  }

  // Vinculou: as listas em cache ficaram velhas na hora.
  cacheAutorizadas = null;
  cacheLojas = null;

  const d: any = r.data ?? r;
  const sucesso: VinculoFeito[] = (Array.isArray(d.success_list) ? d.success_list : []).map((s: any) => ({
    shopId: String(s.shop_id),
    appShopId: String(s.app_shop_id),
    authToken: String(s.auth_token || ""),
    expiraEm: Number(s.token_expiration_time || 0),
  }));
  const falha = (Array.isArray(d.failure_list) ? d.failure_list : []).map((f: any) => ({
    shopId: String(f.shop_id),
    appShopId: String(f.app_shop_id),
    motivo: String(f.reason || "sem motivo"),
  }));
  return { ok: true, sucesso, falha, cru: d };
}

/**
 * Sonda do `shop/list` num host específico, sem cache — só para o diagnóstico
 * responder "em qual host este app tem loja?". O rate limit deles (1 a cada
 * 20s) pode devolver 10005 aqui; é informação, não falha.
 */
export async function sondarListaVinculadas(
  host: "didi-food" | "99food"
): Promise<{ host: string; errno: number; errmsg: string; total: number | null; cru: any }> {
  const cred = credenciaisDoApp();
  const base = host === "99food" ? BASE_V3 : BASE;
  if (!cred) return { host: base, errno: -2, errmsg: "sem credenciais", total: null, cru: null };
  const params = { app_id: cred.appId, timestamp: Math.floor(Date.now() / 1000), page_no: 1, page_size: 100 };
  const corpo = { ...params, sign: assinarOficial(params, cred.appSecret) };
  const r = await chamar<any>("/v1/shop/shop/list", { metodo: "POST", corpo, idsCrus: ["app_id"], base });
  const d: any = r.data ?? {};
  return {
    host: base,
    errno: r.errno,
    errmsg: r.errmsg,
    total: r.errno === 0 ? Number(d.total ?? d.total_cnt ?? 0) : null,
    cru: r.errno === 0 ? d : r,
  };
}

/**
 * Desfaz o vínculo da loja com o app FireHub, do lado do 99Food.
 *
 * O "Desconectar" da tela só limpava os campos do NOSSO banco. Como
 * `conectado` passou a ser o que o 99Food responde, apagar aqui e deixar o
 * vínculo de pé lá dava um botão que não desconecta: na consulta seguinte o
 * token continuava existindo e a loja voltava a aparecer conectada.
 *
 * Pede o `auth_token` da própria loja, não as credenciais do app — quem
 * desfaz o vínculo é quem o tem.
 */
export async function desvincularLoja(authToken: string): Promise<{ ok: true } | { ok: false; erro: string }> {
  const r = await chamar("/v1/shop/shop/unbind", {
    metodo: "POST",
    corpo: { auth_token: authToken },
  });
  if (r.errno !== 0) return { ok: false, erro: `${r.errno} ${r.errmsg}` };

  // A lista muda com o unbind, então o cache dela morre junto — senão uma
  // loja recém-desvinculada continuaria aparecendo como candidata por 20s.
  cacheLojas = null;
  return { ok: true };
}

/**
 * Confirma a loja ONLINE no 99Food.
 *
 * ── O problema que isto resolve ─────────────────────────────────────────────
 *
 * Até aqui o FireHub nunca mexeu no estado da loja no lado deles: quem punha a
 * loja online era o lojista, abrindo o app do 99Food. Fechou o app, loja
 * offline — e a descrição deste endpoint no swagger deles diz, com todas as
 * letras, que dali não se sai sozinho:
 *
 *   "If biz_status is offline, this shop will never be online until the
 *    biz_status set to online with this api or be online from didi's app
 *    manually."
 *
 * Ou seja: sem esta chamada, a ÚNICA forma de reabrir era abrir o app deles na
 * mão. É exatamente a reclamação que chegou — "só entra pedido se eu deixar o
 * 99 aberto". Não era o app aberto que fazia entrar pedido; era o app aberto
 * que mantinha a loja online.
 *
 * ── Por que só existe "online" aqui ─────────────────────────────────────────
 *
 * Esta função não fecha loja, e a assinatura não aceita "fechar" de propósito.
 * O horário do FireHub (`storeOpen`, `storeHours`) governa o NOSSO cardápio
 * digital e mais nada; o 99Food tem agenda própria, feita no painel deles. São
 * duas coisas sem relação, e amarrá-las fecharia a loja no horário errado.
 *
 * ── biz_status e auto_switch ────────────────────────────────────────────────
 *
 * `biz_status: 1` é o online — o estado do qual a loja não sai sozinha.
 *
 * `auto_switch: 3` = "set store online and offline automatically, order
 * release is enabled": é ele que faz o 99Food abrir E fechar a loja sozinho,
 * pela agenda cadastrada lá, sem ninguém tocar no app. É o valor que traduz o
 * pedido do dono — "ligado sem precisar abrir o gestor deles".
 *
 * Não usamos 1 ("online automatically"), que põe a loja online mas não a fecha:
 * a loja ficaria recebendo pedido fora do horário de funcionamento dela, e
 * pedido aceito que ninguém prepara vira cancelamento e punição no 99Food.
 *
 * Fonte: .99food-docs/swagger.yaml, /v1/shop/shop/setStatus.
 */
export async function setShopStatus(
  authToken: string,
  autoSwitch: 1 | 2 | 3
): Promise<{ ok: true; online: boolean } | { ok: false; erro: string }> {
  const r = await chamar<{ biz_status?: boolean; auto_switch?: boolean }>("/v1/shop/shop/setStatus", {
    metodo: "POST",
    corpo: {
      auth_token: authToken,
      biz_status: 1,
      auto_switch: autoSwitch,
    },
  });

  if (r.errno !== 0) return { ok: false, erro: `${r.errno} ${r.errmsg}` };

  // errno 0 NÃO quer dizer que a loja ficou online: o 99Food aceita a chamada e
  // responde biz_status=false quando ela continua offline por motivo dele (loja
  // bloqueada, vínculo suspenso, sem entregador). Tratar isso como sucesso faria
  // o log mentir "confirmada ONLINE" e travaria a retentativa. Só é sucesso se
  // ele confirmar online.
  if (r.data?.biz_status === false) {
    return { ok: false, erro: "setStatus aceito (errno 0) mas o 99Food manteve a loja OFFLINE" };
  }
  return { ok: true, online: true };
}

/**
 * Quem pode confirmar pedido: o app do 99Food, ou o nosso sistema.
 *
 * ── ESTA é a causa raiz de "só entra pedido se eu deixar o 99 aberto" ───────
 *
 * O swagger deles, em /v1/shop/shop/setconfirmmethod:
 *
 *   "If order_confirm_method is BAPP, both DiDi/99 Food's APP and your POS
 *    system can confirm new orders, but DiDi/99 Food's APP MUST REMAIN ONLINE.
 *    If order_confirm_method is OPENAPI, only your POS system can confirm new
 *    orders, and the DiDi/99 Food's APP DOES NOT NEED TO BE ONLINE.
 *    If the store is unbound, we will change the ordering method to BAPP by
 *    default."
 *
 * O padrão é BAPP, e nada no FireHub nunca mexeu nisso — então toda loja
 * conectada está em BAPP, exigindo o app deles online. Manter a loja online
 * pelo `setShopStatus` ajuda, mas não remove essa exigência: quem remove é
 * trocar para OPENAPI.
 *
 * ── Por que isto NÃO é chamado automaticamente ──────────────────────────────
 *
 * Em OPENAPI, SÓ o nosso sistema confirma pedido. Se o caminho de confirmação
 * daqui falhar por qualquer motivo — token vencido, webhook mudo, loja sem
 * vínculo — o pedido não é confirmado por ninguém, e o 99Food cancela. O modo
 * BAPP, com todos os seus defeitos, ao menos deixa o lojista salvar o pedido
 * na mão pelo app deles.
 *
 * Por isso a troca é DELIBERADA, uma loja por vez, e só depois de ver pedido
 * entrando e sendo confirmado sozinho naquela loja. Ligar isto antes disso
 * troca "o lojista precisa deixar o app aberto" por "os pedidos são
 * cancelados", que é estritamente pior.
 *
 * Fonte: .99food-docs/swagger.yaml, /v1/shop/shop/setconfirmmethod.
 */
export type MetodoConfirmacao99 = "BAPP" | "OPENAPI";

export async function setConfirmMethod(
  authToken: string,
  metodo: MetodoConfirmacao99
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const r = await chamar<{ order_confirm_method?: boolean }>("/v1/shop/shop/setconfirmmethod", {
    metodo: "POST",
    corpo: {
      auth_token: authToken,
      order_confirm_method: metodo === "OPENAPI" ? 2 : 1,
    },
  });

  if (r.errno !== 0) return { ok: false, erro: `${r.errno} ${r.errmsg}` };
  return { ok: true };
}

/**
 * O estado operacional da loja no 99Food, agora — sem cache.
 *
 * Separado de `detalheDaLoja` de propósito: aquele guarda nome e endereço por 5
 * minutos, o que é certo para um rótulo de tela e errado para decidir se a loja
 * está no ar. Aqui o valor velho é pior que nenhum.
 *
 * `sub_biz_status` é o campo que importa, porque distingue coisas que
 * `biz_status` junta (swagger.yaml, ShopModel):
 *
 *   0 padrão · 1 aberta · 2 PAUSADA pelo lojista · 3 fechada ·
 *   4 DESCONECTADA · 5 fechada no dia · 6 bloqueada ·
 *   7 fechada pelo sistema (sem entregador)
 *
 * O 4 é o problema do dono: é o estado em que a loja cai quando o gestor do
 * 99Food é fechado no PC. O 2 e o 5 são decisão do lojista, e religar por cima
 * deles seria trocar o problema por um pior — pedido entrando numa cozinha que
 * decidiu parar vira cancelamento e punição.
 */
export type EstadoOperacional99 = {
  nome: string | null;
  bizStatus: number | null;
  subBizStatus: number | null;
  autoSwitch: number | null;
};

export async function estadoOperacionalDaLoja(
  authToken: string
): Promise<EstadoOperacional99 | null> {
  const r = await chamar<any>("/v1/shop/shop/detail", { query: { auth_token: authToken } });
  if (r.errno !== 0 || !r.data) return null;
  const d = r.data;
  const num = (v: any) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    nome: d.name ? String(d.name).trim() : null,
    bizStatus: num(d.biz_status),
    subBizStatus: num(d.sub_biz_status),
    autoSwitch: num(d.auto_switch),
  };
}
