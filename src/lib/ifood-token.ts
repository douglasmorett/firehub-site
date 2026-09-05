/**
 * /src/lib/ifood-token.ts
 *
 * De onde sai o Bearer token de cada chamada ao iFood.
 *
 * O FireHub conviveu com dois aplicativos, e o token certo depende de quem é a
 * loja:
 *
 *   1. IfoodIntegration.accessToken — o desenho definitivo. Cada loja guarda o
 *      seu token do app DISTRIBUÍDO, renovado pelo refreshToken da própria linha.
 *   2. User.ifoodAccessToken — onde os tokens do distribuído moram hoje, porque
 *      o fluxo de autorização cria a IfoodIntegration sem gravar token nela.
 *   3. getIfoodToken() — client_credentials do app CENTRALIZADO, que a loja
 *      antiga sempre usou. Continua valendo como último recurso, para que essa
 *      loja não pare quando as rotas migrarem.
 *
 * ── Por que isto devolve uma LISTA, e não um token ──
 *
 * A tentação é escrever `tokenDaLoja(id) ?? tokenCentral()`. Não funciona, e o
 * motivo é específico deste repositório: `getTokenDaLojaIfood` devolve o access
 * token VELHO em vez de null em cinco caminhos de falha diferentes
 * (ifood-api.ts:91-93, 101, 119, 123, 138). Como ele quase nunca devolve null,
 * o `??` quase nunca dispara — e um Bearer morto viaja na requisição enquanto o
 * fallback nunca acontece.
 *
 * Pior: um token pode estar perfeitamente dentro da validade e ainda assim ser
 * recusado, porque pertence ao aplicativo errado para aquela loja. Foi o que a
 * produção respondeu quando conferimos: 403 "User is forbidden to access this
 * resource" com token válido em mãos.
 *
 * Ou seja, a única prova de que uma credencial serve é o iFood aceitá-la. Por
 * isso aqui se devolve a lista de candidatas em ordem de preferência, e quem
 * chama (ifood-http) troca de credencial diante de 401/403 — casos em que nada
 * aconteceu do outro lado e repetir é seguro.
 */
import { prisma } from "./prisma";
import { getIfoodToken, getTokenDaLojaIfood } from "./ifood-api";

const IFOOD_BASE = "https://merchant-api.ifood.com.br";

export type OrigemToken = "integracao" | "usuario" | "central";

export type Credencial = {
  token: string;
  origem: OrigemToken;
  integrationId?: string;
};

export type ContextoIfood = {
  merchantId: string;
  label?: string;
  /** Em ordem de preferência. Nunca vazia — sem candidata, contextoIfood lança. */
  credenciais: Credencial[];
};

/** Erro com mensagem pronta para a tela e status HTTP adequado. */
export class ErroIfood extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "ErroIfood";
    this.status = status;
  }
}

/**
 * O dono da credencial.
 *
 * Numa rede, a integração fica pendurada no franqueado, e um funcionário tem
 * `ownerId` preenchido. Buscar a credencial pelo id de quem está logado
 * devolveria vazio e pararia a operação do balcão.
 */
async function donoDaLoja(email: string): Promise<{ userId: string; franchiseeId: string }> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, ownerId: true },
  });
  if (!user) throw new ErroIfood("Usuário não encontrado.", 404);
  return { userId: user.id, franchiseeId: user.ownerId || user.id };
}

/** Renova um par de tokens do app distribuído. null quando não há como. */
async function renovar(refreshToken: string, clientId?: string | null, clientSecret?: string | null) {
  const id = clientId || process.env.IFOOD_CLIENT_ID_DISTRIBUTED;
  const secret = clientSecret || process.env.IFOOD_CLIENT_SECRET_DISTRIBUTED;
  if (!id || !secret) {
    console.error("[iFood token] Sem IFOOD_CLIENT_ID_DISTRIBUTED/SECRET — não dá para renovar.");
    return null;
  }
  try {
    const res = await fetch(`${IFOOD_BASE}/authentication/v1.0/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grantType: "refresh_token",
        clientId: id,
        clientSecret: secret,
        refreshToken,
      }),
    });
    if (!res.ok) {
      console.error(`[iFood token] refresh recusado: ${res.status}`);
      return null;
    }
    const data = await res.json();
    if (!data?.accessToken) return null;
    return {
      accessToken: data.accessToken as string,
      refreshToken: (data.refreshToken as string) || refreshToken,
      expiresAt: new Date(Date.now() + ((data.expiresIn ?? 3600) - 60) * 1000),
    };
  } catch (e: any) {
    console.error("[iFood token] Erro ao renovar:", e?.message);
    return null;
  }
}

/** Renova 5 min antes de vencer: token que expira no meio da chamada vira 401 na cara do lojista. */
const MARGEM = 5 * 60 * 1000;
const aindaVale = (exp?: Date | null) => !!exp && exp.getTime() - MARGEM > Date.now();
const naoVenceu = (exp?: Date | null) => !!exp && exp.getTime() > Date.now();

async function tokenDaIntegracao(integ: {
  id: string;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  clientId: string | null;
  clientSecret: string | null;
}): Promise<string | null> {
  if (integ.accessToken && aindaVale(integ.tokenExpiresAt)) return integ.accessToken;

  if (integ.refreshToken) {
    const novo = await renovar(integ.refreshToken, integ.clientId, integ.clientSecret);
    if (novo) {
      await prisma.ifoodIntegration.update({
        where: { id: integ.id },
        data: {
          accessToken: novo.accessToken,
          refreshToken: novo.refreshToken,
          tokenExpiresAt: novo.expiresAt,
        },
      });
      return novo.accessToken;
    }
  }
  // Última chance: um token que ainda não venceu de fato vale a tentativa.
  // Se o iFood recusar, o fallback por 401/403 assume — que é justamente o
  // desenho que esta camada existe para permitir.
  return integ.accessToken && naoVenceu(integ.tokenExpiresAt) ? integ.accessToken : null;
}

async function tokenDoUsuario(userId: string): Promise<string | null> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { ifoodAccessToken: true, ifoodRefreshToken: true, ifoodTokenExpiresAt: true },
  });
  if (!u) return null;

  if (u.ifoodAccessToken && aindaVale(u.ifoodTokenExpiresAt)) return u.ifoodAccessToken;

  if (u.ifoodRefreshToken) {
    const novo = await renovar(u.ifoodRefreshToken);
    if (novo) {
      await prisma.user.update({
        where: { id: userId },
        data: {
          ifoodAccessToken: novo.accessToken,
          ifoodRefreshToken: novo.refreshToken,
          ifoodTokenExpiresAt: novo.expiresAt,
        },
      });
      return novo.accessToken;
    }
  }
  return u.ifoodAccessToken && naoVenceu(u.ifoodTokenExpiresAt) ? u.ifoodAccessToken : null;
}

/** O central pode ser desligado por env, sem redeploy, quando a migração fechar. */
function centralPermitido(explicito?: boolean) {
  if (explicito === false) return false;
  return process.env.IFOOD_CENTRAL_FALLBACK !== "off";
}

type IntegracaoComToken = {
  id: string;
  label: string | null;
  merchantId: string;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  clientId: string | null;
  clientSecret: string | null;
};

const SELECT_INTEGRACAO = {
  id: true, label: true, merchantId: true, accessToken: true,
  refreshToken: true, tokenExpiresAt: true, clientId: true, clientSecret: true,
} as const;

/**
 * A cascata em si: integração → usuário → central. É compartilhada entre o
 * contexto da sessão (telas) e o contexto do pedido (transições de status).
 */
async function cascataDeCredenciais(opts: {
  userId: string;
  franchiseeId: string;
  integracoes: IntegracaoComToken[];
  permitirCentral?: boolean;
  /**
   * Empilhar TODAS as integrações com token, não só a primeira. É o que o
   * pedido precisa: numa conta com três lojas do iFood, o token de uma não
   * abre o pedido da outra, e chamarComContexto só troca de credencial se
   * houver próxima na lista.
   */
  todas?: boolean;
}): Promise<{ credenciais: Credencial[]; lojaEscolhida: IntegracaoComToken | null }> {
  const { userId, franchiseeId, integracoes } = opts;
  const credenciais: Credencial[] = [];
  let lojaEscolhida = integracoes[0] ?? null;

  // 1) Integração com token próprio — a resposta preferida.
  for (const integ of integracoes) {
    const token = await tokenDaIntegracao(integ);
    if (token) {
      if (credenciais.length === 0) lojaEscolhida = integ;
      credenciais.push({ token, origem: "integracao", integrationId: integ.id });
      if (!opts.todas) break;
    }
  }

  // 2) O token do distribuído que ainda mora no usuário.
  const tokenUser = (await tokenDoUsuario(franchiseeId)) ?? (await tokenDoUsuario(userId));
  if (tokenUser && !credenciais.some((c) => c.token === tokenUser)) {
    credenciais.push({ token: tokenUser, origem: "usuario" });
  }

  // 3) O centralizado, por último e só se permitido.
  if (centralPermitido(opts.permitirCentral)) {
    try {
      const central = await getIfoodToken();
      if (central) credenciais.push({ token: central, origem: "central" });
    } catch (e: any) {
      // Falta de segredo do app central não pode derrubar a loja que tem token
      // próprio — por isso o erro morre aqui.
      console.warn("[iFood token] central indisponível:", e?.message);
    }
  }

  return { credenciais, lojaEscolhida };
}

/**
 * O contexto de um PEDIDO — resolvido pelo dono do pedido, nunca pela sessão.
 *
 * As transições de status (confirm, dispatch, conclude, cancel) chamavam o
 * iFood com `getIfoodToken()`, o app centralizado, que só alcança a Hakim.
 * Nas outras lojas cada chamada era um 403 engolido pelo log — o pedido saía
 * para entrega aqui e ficava parado lá (ver lib/ifood-pedido.ts).
 *
 * Resolver pela sessão também não serviria: o ADMIN em modo suporte e o app do
 * motoboy (que nem tem sessão de lojista) mexem em pedidos de outra conta. O
 * dono é `franchiseeId`, e a integração preferida é a do merchant do pedido —
 * numa conta com várias lojas do iFood, o token de uma não abre o pedido da
 * outra.
 */
export async function contextoDoPedido(pedido: {
  franchiseeId: string;
  /** CustomerOrder.ifoodStoreMerchant — a loja do iFood de onde o pedido veio. */
  ifoodStoreMerchant?: string | null;
}): Promise<ContextoIfood> {
  const dono = await prisma.user.findUnique({
    where: { id: pedido.franchiseeId },
    select: { id: true, ownerId: true, ifoodMerchantId: true },
  });
  if (!dono) throw new ErroIfood("Loja do pedido não encontrada.", 404);
  const franchiseeId = dono.ownerId || dono.id;

  const todas = await prisma.ifoodIntegration.findMany({
    where: { userId: franchiseeId, active: true },
    orderBy: { createdAt: "asc" },
    select: SELECT_INTEGRACAO,
  });
  // A integração do merchant do pedido vai na frente; as outras ficam como
  // reserva, porque a loja antiga pode ter o pedido gravado sem merchantId.
  const doPedido = todas.filter((i) => i.merchantId === pedido.ifoodStoreMerchant);
  const integracoes = [...doPedido, ...todas.filter((i) => !doPedido.includes(i))];

  const { credenciais, lojaEscolhida } = await cascataDeCredenciais({
    userId: dono.id, franchiseeId, integracoes, todas: true,
  });

  if (credenciais.length === 0) {
    throw new ErroIfood(
      "Esta loja não tem uma autorização válida do iFood. Reconecte a loja em Integrações.",
      409,
    );
  }

  return {
    merchantId: pedido.ifoodStoreMerchant || lojaEscolhida?.merchantId || dono.ifoodMerchantId || "",
    label: lojaEscolhida?.label ?? undefined,
    credenciais,
  };
}

/**
 * Qual loja e com quais credenciais falar com o iFood.
 *
 * @param merchantId quando a tela deixa escolher entre várias lojas da conta.
 * @param permitirCentral passe `false` para exigir o app distribuído — é o que
 *        a homologação precisa, já que o client_id informado no chamado tem
 *        que bater com o das requisições que o analista vai ler.
 */
export async function contextoIfood(opts: {
  email?: string | null;
  merchantId?: string | null;
  permitirCentral?: boolean;
}): Promise<ContextoIfood> {
  const { email, merchantId } = opts;
  if (!email) throw new ErroIfood("Sessão sem e-mail — faça login novamente.", 401);

  const { userId, franchiseeId } = await donoDaLoja(email);

  const integracoes = await prisma.ifoodIntegration.findMany({
    where: { userId: franchiseeId, active: true, ...(merchantId ? { merchantId } : {}) },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, label: true, merchantId: true, accessToken: true,
      refreshToken: true, tokenExpiresAt: true, clientId: true, clientSecret: true,
    },
  });

  if (merchantId && integracoes.length === 0) {
    throw new ErroIfood("Esta loja iFood não está integrada nesta conta.", 404);
  }

  const { credenciais, lojaEscolhida } = await cascataDeCredenciais({
    userId, franchiseeId, integracoes, permitirCentral: opts.permitirCentral,
  });

  const alvo =
    lojaEscolhida?.merchantId ||
    (await prisma.user.findUnique({
      where: { id: franchiseeId },
      select: { ifoodMerchantId: true },
    }))?.ifoodMerchantId ||
    null;

  if (!alvo) throw new ErroIfood("Nenhuma loja iFood conectada nesta conta.", 404);

  if (credenciais.length === 0) {
    throw new ErroIfood(
      "Esta loja não tem uma autorização válida do iFood. Reconecte a loja em Integrações.",
      409,
    );
  }

  return { merchantId: alvo, label: lojaEscolhida?.label ?? undefined, credenciais };
}

/** Todas as lojas iFood da conta — para o seletor das telas. */
export async function lojasIfood(email: string) {
  const { franchiseeId } = await donoDaLoja(email);
  const integracoes = await prisma.ifoodIntegration.findMany({
    where: { userId: franchiseeId, active: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, label: true, merchantId: true, connected: true },
  });
  if (integracoes.length > 0) return integracoes;

  // Conta anterior à tabela de integrações.
  const u = await prisma.user.findUnique({
    where: { id: franchiseeId },
    select: { ifoodMerchantId: true, storeName: true, name: true, ifoodConnected: true },
  });
  if (!u?.ifoodMerchantId) return [];
  return [{
    id: "legado",
    label: u.storeName || u.name || "Loja Principal",
    merchantId: u.ifoodMerchantId,
    connected: u.ifoodConnected,
  }];
}

/**
 * A LOJA da sessão — nunca o registro de quem está logado.
 *
 * Numa rede, o funcionário tem `ownerId` preenchido e a integração vive no
 * franqueado. Gravar token e vínculo no registro de quem abriu a tela põe a
 * credencial numa conta que o polling não lê: a loja fica "conectada" na tela
 * e sem pedido nenhum na cozinha. `lojaAtivaDoAdmin` é o modo suporte, em que
 * o ADMIN opera com a loja do cliente na tela.
 */
export async function lojaDaSessao(
  email: string,
  lojaAtivaDoAdmin?: string | null,
): Promise<string | null> {
  const u = await prisma.user.findUnique({
    where: { email },
    select: { id: true, role: true, ownerId: true },
  });
  if (!u) return null;
  if (u.role === "ADMIN" && lojaAtivaDoAdmin && lojaAtivaDoAdmin !== "all") return lojaAtivaDoAdmin;
  return u.ownerId || u.id;
}

/** Um token e as lojas iFood que ele pode puxar numa única chamada. */
export type GrupoPolling = {
  token: string;
  origem: OrigemToken;
  merchants: string[];
};

/**
 * TODAS as lojas iFood de uma conta, agrupadas pelo token que as puxa.
 *
 * O polling sempre leu `User.ifoodMerchantId` — UM campo só. Quem integrou três
 * lojas na mesma conta (Ragnar Burguer, Ragnar Pizza e Tadala Burguer, no mesmo
 * login do iFood) via as três na tela de Integrações e pagava os +R$50 de cada
 * adicional, mas só a que estava naquele campo recebia pedido. As outras duas
 * ficavam mudas para sempre, sem nenhum erro em lugar nenhum.
 *
 * O agrupamento é POR TOKEN de propósito: quando a mesma autorização cobre
 * várias lojas — o caso comum, um login do lojista com várias lojas — sai UMA
 * chamada com todos os merchants no header, em vez de uma por loja (o iFood
 * limita a frequência do polling, e três chamadas por minuto por conta é o
 * caminho do 429). Loja com token próprio vira um grupo à parte.
 */
export async function gruposDePollingIfood(franchiseeId: string): Promise<GrupoPolling[]> {
  const integracoes = await prisma.ifoodIntegration.findMany({
    where: { userId: franchiseeId, active: true },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, merchantId: true, accessToken: true, refreshToken: true,
      tokenExpiresAt: true, clientId: true, clientSecret: true,
    },
  });

  const porToken = new Map<string, GrupoPolling>();
  const juntar = (token: string, origem: OrigemToken, merchantId: string) => {
    const grupo = porToken.get(token) ?? { token, origem, merchants: [] };
    if (!grupo.merchants.includes(merchantId)) grupo.merchants.push(merchantId);
    porToken.set(token, grupo);
  };

  const vistos = new Set<string>();
  const semTokenProprio: string[] = [];

  for (const integ of integracoes) {
    if (!integ.merchantId || vistos.has(integ.merchantId)) continue;
    vistos.add(integ.merchantId);
    const token = await tokenDaIntegracao(integ);
    if (token) juntar(token, "integracao", integ.merchantId);
    else semTokenProprio.push(integ.merchantId);
  }

  const u = await prisma.user.findUnique({
    where: { id: franchiseeId },
    select: { ifoodMerchantId: true },
  });
  if (u?.ifoodMerchantId && !vistos.has(u.ifoodMerchantId)) {
    vistos.add(u.ifoodMerchantId);
    semTokenProprio.push(u.ifoodMerchantId);
  }

  if (semTokenProprio.length > 0) {
    // Integração cadastrada pela tela (colando o Merchant ID) nasce SEM token:
    // quem autorizou foi o login do lojista, e esse token mora no User. É o
    // caminho normal de quem tem várias lojas no mesmo login do iFood.
    //
    // O `??` cai no getTokenDaLojaIfood de propósito: ele devolve o access
    // token mesmo sem data de validade gravada, e há lojas antigas assim. Sem
    // essa rede elas parariam de ser puxadas hoje.
    const tokenUser = (await tokenDoUsuario(franchiseeId)) ?? (await getTokenDaLojaIfood(franchiseeId));
    if (tokenUser) for (const m of semTokenProprio) juntar(tokenUser, "usuario", m);
  }

  // Loja RECÉM-AUTORIZADA: tem token e nenhuma loja iFood conhecida ainda. O
  // grupo sai com a lista vazia mesmo — quem puxa a fila não filtra por
  // merchant, e é o primeiro pedido que revela qual loja é. Devolver nada aqui
  // era deixá-la fora do cron, esperando um vínculo que ninguém faria.
  if (porToken.size === 0) {
    const tokenUser = (await tokenDoUsuario(franchiseeId)) ?? (await getTokenDaLojaIfood(franchiseeId));
    if (tokenUser) return [{ token: tokenUser, origem: "usuario", merchants: [] }];
  }

  return [...porToken.values()];
}
