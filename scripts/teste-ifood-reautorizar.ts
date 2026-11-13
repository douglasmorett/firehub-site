/**
 * Trava a reautorização do iFood pelo próprio token (Holy Top, 13/11/2026).
 *
 * A loja já conectada tinha o selo "Autorize de novo para liberar as
 * novidades". Autorizou no portal, colou o código e ouviu "cole o Merchant ID";
 * colou o UUID e o selo continuou, porque a integração seguia com o token velho.
 *
 *   1. código com token que cobre a integração da loja → a integração ganha o
 *      token novo, faltaReautorizar vira false e o aviso é "✅ Autorização
 *      renovada para <nome>" (também com resquício do merchant no registro de
 *      um funcionário, que antes marcava a loja como "ocupada");
 *   2. token com merchant que ainda não é integração → fluxo de sempre;
 *   3. token sem merchant_scope (não é JWT) → fluxo de sempre;
 *   4. Merchant ID colado nunca troca o token novo por um mais velho — e
 *      aplica o mais novo quando o da integração é o velho.
 *
 * Sem banco nem rede: banco falso em globalThis.prisma e fetch falso, o molde
 * de scripts/teste-ifood-dono-n6.ts.
 *
 *   npx tsx scripts/teste-ifood-reautorizar.ts
 */
export {};

process.env.NEXTAUTH_SECRET ||= "teste";
process.env.DATABASE_URL ||= "postgresql://ninguem@localhost:1/nada";
process.env.IFOOD_CLIENT_ID_DISTRIBUTED = "cliente-distribuido";
process.env.IFOOD_CLIENT_SECRET_DISTRIBUTED = "segredo-distribuido";
delete process.env.IFOOD_HOMOLOG_CLIENT_ID;

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — veio ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`}`);
};

// ── Tokens falsos ────────────────────────────────────────────────────────────
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (escopo: string[], iat: number) => `${b64({ alg: "none" })}.${b64({ merchant_scope: escopo, iat, exp: iat + 21600 })}.assinatura`;
const M = "aaaaaaaa-0000-4000-8000-000000000001";      // a loja (Holy Top)
const M_OUTRA = "bbbbbbbb-0000-4000-8000-000000000002"; // outra loja da conta, ainda fora do FireHub
const velhos = (m: string) => [`${m}:order`, `${m}:events`];
const novos = (m: string) => [...velhos(m), `${m}:merchant`, `${m}:catalog`, `${m}:shipping`];
const T_VELHO = jwt(velhos(M), 1_000);
const T_NOVO = jwt(novos(M), 2_000);

// ── Banco falso ──────────────────────────────────────────────────────────────
type Usuario = Record<string, any> & { id: string; email: string };
type Integracao = Record<string, any> & { userId: string; merchantId: string };
let USUARIOS: Usuario[] = [];
let INTEGRACOES: Integracao[] = [];

const recorta = (o: any, select?: any) => (o && select ? Object.fromEntries(Object.keys(select).map((k) => [k, o[k] ?? null])) : o);
const casa = (o: any, where: any = {}): boolean =>
  Object.entries(where).every(([k, v]: [string, any]): boolean => {
    if (k === "NOT") return !casa(o, v);
    if (k === "userId_merchantId") return o.userId === v.userId && o.merchantId === v.merchantId;
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return v.in.includes(o[k]);
      return true;
    }
    return (o[k] ?? null) === v;
  });
const comUser = (i: Integracao, select: any) => {
  const base = recorta(i, select);
  if (select?.user) base.user = recorta(USUARIOS.find((u) => u.id === i.userId), select.user.select);
  return base;
};

(globalThis as any).prisma = {
  user: {
    findUnique: async ({ where, select }: any) =>
      recorta(USUARIOS.find((u) => (where.email ? u.email === where.email : u.id === where.id)) ?? null, select),
    findFirst: async ({ where, select }: any) => recorta(USUARIOS.find((u) => casa(u, where)) ?? null, select),
    findMany: async ({ where, select }: any) => USUARIOS.filter((u) => casa(u, where)).map((u) => recorta(u, select)),
    update: async ({ where, data }: any) => {
      const u = USUARIOS.find((x) => x.id === where.id);
      if (u) Object.assign(u, data);
      return u;
    },
  },
  ifoodIntegration: {
    findMany: async ({ where, select }: any) => INTEGRACOES.filter((i) => casa(i, where)).map((i) => comUser(i, select)),
    findFirst: async ({ where, select }: any) => recorta(INTEGRACOES.find((i) => casa(i, where)) ?? null, select),
    update: async ({ where, data }: any) => {
      const i = INTEGRACOES.find((x) => casa(x, where));
      if (!i) throw new Error("não achou");
      return Object.assign(i, data);
    },
    updateMany: async ({ where, data }: any) => {
      const alvo = INTEGRACOES.filter((i) => casa(i, where));
      alvo.forEach((i) => Object.assign(i, data));
      return { count: alvo.length };
    },
    upsert: async ({ where, create, update }: any) => {
      const achou = INTEGRACOES.find((i) => casa(i, where));
      if (achou) return Object.assign(achou, update);
      const nova = { accessToken: null, refreshToken: null, tokenExpiresAt: null, clientId: null, clientSecret: null, ...create };
      INTEGRACOES.push(nova);
      return nova;
    },
  },
};

// ── Sessão e rede ────────────────────────────────────────────────────────────
const stub = (caminho: string, exports: Record<string, unknown>) => {
  const arquivo = require.resolve(caminho);
  require.cache[arquivo] = { id: arquivo, filename: arquivo, loaded: true, exports: { __esModule: true, ...exports } } as any;
};
let sessao: any = null;
const getServerSession = async () => sessao;
stub("next-auth/next", { getServerSession });
stub("next-auth", { getServerSession, default: () => null });
stub("../src/lib/auth", { authOptions: {} });

// O iFood: a troca do código devolve `tokenDaTroca`; a fila de eventos vem vazia
// (é fora do horário de pedido — o caso da Holy Top).
let tokenDaTroca = "";
(globalThis as any).fetch = async (url: string) => {
  if (String(url).includes("/oauth/token")) {
    return new Response(JSON.stringify({ accessToken: tokenDaTroca, refreshToken: "refresh-novo", expiresIn: 21600 }), { status: 200 });
  }
  if (String(url).includes("events:polling")) return new Response("[]", { status: 200 });
  throw new Error(`rede no teste: ${url}`);
};

const req = (body: unknown) => {
  const { NextRequest } = require("next/server");
  return new NextRequest("http://localhost/api/ifood/auth", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
};

/** A Holy Top: integração com o token de antes de 12/11; User com o mesmo token. */
const reiniciar = (opcoes: { resquicioNoFuncionario?: boolean } = {}) => {
  USUARIOS = [
    {
      id: "holy", email: "dono@holy", role: "FRANCHISEE", ownerId: null, name: "Holy Top", storeName: "Holy Top",
      ifoodMerchantId: M, ifoodConnected: true, ifoodAccessToken: T_VELHO, ifoodRefreshToken: "refresh-velho",
      ifoodTokenExpiresAt: new Date(Date.now() + 3600_000), ifoodAuthVerifier: "verifier-da-sessao",
    },
    {
      id: "func", email: "func@holy", role: "STAFF", ownerId: "holy",
      // Resquício do bug antigo: o vínculo gravado no registro do funcionário.
      ifoodMerchantId: opcoes.resquicioNoFuncionario ? M : null,
    },
  ];
  INTEGRACOES = [{
    userId: "holy", merchantId: M, label: "Holy Top", active: true, connected: true,
    accessToken: T_VELHO, refreshToken: "refresh-velho", tokenExpiresAt: new Date(Date.now() + 3600_000),
    clientId: "cliente-distribuido", clientSecret: "segredo-distribuido", createdAt: new Date(0),
  }];
  sessao = { user: { email: "dono@holy" } };
};

async function main() {
  const { POST } = await import("../src/app/api/ifood/auth/route");
  const { faltaReautorizar } = await import("../src/lib/ifood-permissoes");
  const integ = (m: string) => INTEGRACOES.find((i) => i.userId === "holy" && i.merchantId === m);
  const colarCodigo = async (token: string) => {
    tokenDaTroca = token;
    const r = await POST(req({ authorizationCode: "HSXD-CWHG" }));
    return { status: r.status, corpo: await r.json() };
  };

  // ── 1. Reautorização ────────────────────────────────────────────────────────
  console.log("\n── 1. Reautorização: o token cobre a integração que já existe ──");
  for (const resquicio of [false, true]) {
    const caso = resquicio ? " (com o merchant também no registro do funcionário)" : "";
    reiniciar({ resquicioNoFuncionario: resquicio });
    confere(`antes: selo "Autorize de novo" aceso${caso}`, faltaReautorizar(integ(M)!.accessToken, M), true);
    const { status, corpo } = await colarCodigo(T_NOVO);
    confere(`a integração ganha o token novo${caso}`, [status, integ(M)!.accessToken === T_NOVO, integ(M)!.refreshToken], [200, true, "refresh-novo"]);
    confere(`faltaReautorizar vira false${caso}`, faltaReautorizar(integ(M)!.accessToken, M), false);
    confere(
      `aviso "✅ Autorização renovada", sem pedir Merchant ID${caso}`,
      [corpo.message, corpo.needsMerchantId ?? false, corpo.renovada, corpo.merchantId, corpo.isAdditional],
      ["✅ Autorização renovada para Holy Top", false, true, M, false],
    );
    confere(`nada de loja nova nem cobrança mexida${caso}`, [INTEGRACOES.length, integ(M)!.active], [1, true]);
    confere(`o User também fica com o token novo${caso}`, USUARIOS[0].ifoodAccessToken === T_NOVO, true);
  }

  // ── 2. Token com merchant que ainda não é integração ────────────────────────
  console.log("\n── 2. Token com loja que ainda não está no FireHub: fluxo de sempre ──");
  reiniciar();
  INTEGRACOES = [];
  USUARIOS[0].ifoodMerchantId = M; // só o vínculo antigo no User
  USUARIOS[0].ifoodAccessToken = jwt(velhos(M), 1_000);
  let res = await colarCodigo(jwt([...novos(M), ...novos(M_OUTRA)], 2_000));
  confere(
    "loja nova do escopo vira integração como antes (a que este código autorizou + a principal do User), sem aviso de renovação",
    [res.status, res.corpo.renovada ?? false, INTEGRACOES.map((i) => i.merchantId)],
    [200, false, [M_OUTRA, M]],
  );

  reiniciar();
  INTEGRACOES = [];
  USUARIOS[0].ifoodMerchantId = null;
  USUARIOS[0].ifoodAccessToken = null;
  res = await colarCodigo(jwt(novos(M_OUTRA), 2_000));
  confere(
    "conta vazia + uma loja no token: vincula como antes",
    [res.status, res.corpo.renovada ?? false, res.corpo.message, INTEGRACOES.map((i) => i.merchantId)],
    [200, false, "🎉 Loja iFood vinculada com sucesso!", [M_OUTRA]],
  );

  // ── 3. Token que não é JWT ──────────────────────────────────────────────────
  console.log("\n── 3. Token sem merchant_scope: fluxo de sempre ──");
  reiniciar();
  res = await colarCodigo("token-opaco");
  confere(
    "pede o Merchant ID como antes e não mexe na integração",
    [res.status, res.corpo.needsMerchantId, res.corpo.renovada ?? false, integ(M)!.accessToken === T_VELHO],
    [200, true, false, true],
  );

  // ── 4. Merchant ID colado ───────────────────────────────────────────────────
  console.log("\n── 4. Merchant ID colado à mão ──");
  const colarUuid = async (uuid: string) => {
    const r = await POST(req({ authorizationCode: uuid }));
    return { status: r.status, corpo: await r.json() };
  };

  reiniciar();
  await colarCodigo(T_NOVO);
  // O User voltou a ter um token mais velho (ex.: outra autorização antiga) —
  // colar o UUID não pode desfazer a autorização nova da integração.
  USUARIOS[0].ifoodAccessToken = T_VELHO;
  res = await colarUuid(M);
  confere(
    "colar o UUID não troca o token novo da integração pelo velho do User",
    [res.status, integ(M)!.accessToken === T_NOVO, faltaReautorizar(integ(M)!.accessToken, M), res.corpo.renovada ?? false],
    [200, true, false, false],
  );

  // O caminho antigo: token novo só no User (ex.: antes desta correção) e a
  // integração com o velho. Colar o UUID agora aplica o mais novo.
  reiniciar();
  USUARIOS[0].ifoodAccessToken = T_NOVO;
  res = await colarUuid(M);
  confere(
    "integração com o token velho e User com o novo: colar o UUID aplica o novo",
    [res.status, integ(M)!.accessToken === T_NOVO, faltaReautorizar(integ(M)!.accessToken, M), res.corpo.message],
    [200, true, false, "✅ Autorização renovada para Holy Top"],
  );

  // Token do User que não cobre este merchant não entra, mesmo sendo mais novo.
  reiniciar();
  USUARIOS[0].ifoodAccessToken = jwt(novos(M_OUTRA), 3_000);
  res = await colarUuid(M);
  confere("token do User de outra loja não entra na integração", integ(M)!.accessToken === T_VELHO, true);

  console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo certo.");
  process.exit(falhas ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
