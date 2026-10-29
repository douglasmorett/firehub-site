/**
 * Trava a regra de lib/ifood-autorizacao.ts (lojas paradas há 90 dias perdem a
 * autorização no iFood a partir de 16/11/2026):
 *
 *   - loja funcionando NÃO cai: GET /merchants volta `200 []` neste app (só
 *     Order e Events por loja) e o merchant está no `merchant_scope` do token;
 *   - cai (connected=false) só quem sumiu da lista do token renovado E do GET;
 *   - GET /merchants sem 200 não decide nada;
 *   - renovação que falhou agora não derruba (vale o último escopo do token);
 *   - o central enxergando a loja segura ela;
 *   - quem reaparece volta a connected=true sozinho.
 *
 * Sem banco nem rede: banco falso em globalThis.prisma e `fetch` trocado — o
 * molde de scripts/teste-ifood-dono-n6.ts.
 *
 *   npx tsx scripts/teste-ifood-autorizacao.ts
 */
export {};

process.env.NEXTAUTH_SECRET ||= "teste";
process.env.DATABASE_URL ||= "postgresql://ninguem@localhost:1/nada";
process.env.IFOOD_CLIENT_ID = "central";
process.env.IFOOD_CLIENT_SECRET = "segredo";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — veio ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`}`);
};

const M1 = "aaaaaaaa-0000-4000-8000-000000000001";
const M2 = "bbbbbbbb-0000-4000-8000-000000000002";
const M3 = "cccccccc-0000-4000-8000-000000000003";

/** JWT falso com o `merchant_scope` do iFood ("<uuid>:order", "<uuid>:events"). */
const jwt = (nome: string, merchants: string[]) =>
  "x." + Buffer.from(JSON.stringify({ sub: nome, merchant_scope: merchants.flatMap((m) => [`${m}:order`, `${m}:events`]) })).toString("base64") + ".y";

// ── Banco falso ──────────────────────────────────────────────────────────────
const FUTURO = new Date(Date.now() + 24 * 3600 * 1000);
const PASSADO = new Date(Date.now() - 3600 * 1000);
type Integ = { id: string; userId: string; merchantId: string; active: boolean; connected: boolean; accessToken: string | null; refreshToken: string | null; tokenExpiresAt: Date | null; clientId: null; clientSecret: null; createdAt: Date };
let INTEG: Integ[] = [];
let USER: { id: string; ifoodMerchantId: string | null; ifoodAccessToken: string | null; ifoodRefreshToken: string | null; ifoodTokenExpiresAt: Date | null };
const integ = (merchantId: string, accessToken: string | null, extra: Partial<Integ> = {}): Integ => ({
  id: `i-${merchantId.slice(0, 4)}`, userId: "loja", merchantId, active: true, connected: true,
  accessToken, refreshToken: null, tokenExpiresAt: FUTURO, clientId: null, clientSecret: null, createdAt: new Date(0), ...extra,
});
const recorta = (o: any, select?: any) => (o && select ? Object.fromEntries(Object.keys(select).map((k) => [k, o[k] ?? null])) : o);
const casa = (o: any, where: any = {}) =>
  Object.entries(where).every(([k, v]: [string, any]) => (v && typeof v === "object" && "in" in v ? v.in.includes(o[k]) : o[k] === v));

(globalThis as any).prisma = {
  user: { findUnique: async ({ select }: any) => recorta(USER, select) },
  // A vez da renovação (lib/vez.ts) sempre é desta chamada.
  $queryRaw: async () => [{ ok: 1 }],
  $executeRaw: async () => 0,
  ifoodIntegration: {
    findMany: async ({ where, select }: any) => INTEG.filter((i) => casa(i, where)).map((i) => recorta(i, select)),
    findUnique: async ({ where, select }: any) => recorta(INTEG.find((i) => i.id === where.id), select),
    update: async ({ where, data }: any) => Object.assign(INTEG.find((i) => i.id === where.id)!, data),
    updateMany: async ({ where, data }: any) => {
      const alvo = INTEG.filter((i) => casa(i, where));
      alvo.forEach((i) => Object.assign(i, data));
      return { count: alvo.length };
    },
  },
};

// ── O iFood falso ────────────────────────────────────────────────────────────
let respostaMerchants: Record<string, { status: number; body: unknown }> = {};
let centralToken = jwt("central", []);
(globalThis as any).fetch = async (url: string, init?: any) => {
  const auth = String(init?.headers?.Authorization || "").replace("Bearer ", "");
  // Token do central sai; renovação de token de loja falha (o caso "renovação caiu agora").
  if (url.endsWith("/authentication/v1.0/oauth/token") && String(init?.body).includes("client_credentials")) {
    return new Response(JSON.stringify({ accessToken: centralToken, expiresIn: 3600 }), { status: 200 });
  }
  if (url.endsWith("/merchant/v1.0/merchants")) {
    const r = respostaMerchants[auth] ?? { status: 200, body: [] };
    return new Response(JSON.stringify(r.body), { status: r.status });
  }
  return new Response("{}", { status: 500 });
};

const { conferirAutorizacaoIfood, decidirAutorizacao } = require("../src/lib/ifood-autorizacao");

const estado = () => Object.fromEntries(INTEG.map((i) => [i.merchantId.slice(0, 4), i.connected]));
const rodar = async () => {
  const log: string[] = [];
  await conferirAutorizacaoIfood("loja", "Loja", log);
  return log;
};
const preparar = (integs: Integ[], userToken: string | null = null) => {
  INTEG = integs;
  USER = { id: "loja", ifoodMerchantId: integs[0]?.merchantId ?? null, ifoodAccessToken: userToken, ifoodRefreshToken: null, ifoodTokenExpiresAt: userToken ? FUTURO : null };
  respostaMerchants = {};
};

(async () => {
  process.env.IFOOD_CENTRAL_FALLBACK = "off";

  // 1. A regra pura.
  confere(
    "regra: sai quem não está na lista, volta quem reapareceu, quem não foi conferido fica",
    decidirAutorizacao(
      [{ merchantId: M1, connected: true }, { merchantId: M2, connected: false }, { merchantId: M3, connected: true }],
      new Set([M1, M2]),
      new Set([M2]),
    ),
    { perderam: [M1], voltaram: [M2] },
  );

  // 2. Produção hoje: GET /merchants = 200 [] e o merchant no escopo do token.
  const t12 = jwt("t12", [M1, M2]);
  preparar([integ(M1, t12), integ(M2, t12)]);
  await rodar();
  confere("loja funcionando (200 [] + merchant no escopo) continua conectada", estado(), { aaaa: true, bbbb: true });

  // 3. Token renovado sem o M2 e GET 200 []: o M2 cai, o M1 fica.
  const t1 = jwt("t1", [M1]);
  preparar([integ(M1, t1), integ(M2, t1)]);
  let log = await rodar();
  confere("o iFood tirou o M2 do token: só ele vai para connected=false", estado(), { aaaa: true, bbbb: false });
  confere("e o motivo vai para o log do cron", log.some((l) => l.includes(M2) && l.includes("autorizar de novo")), true);

  // 4. GET /merchants sem 200: não decide nada.
  preparar([integ(M1, t1), integ(M2, t1)]);
  respostaMerchants[t1] = { status: 403, body: { message: "forbidden" } };
  log = await rodar();
  confere("GET /merchants 403: ninguém cai", estado(), { aaaa: true, bbbb: true });
  confere("e o log diz que confere na próxima volta", log.some((l) => l.includes("próxima volta")), true);

  // 5. A API oficial lista a loja mesmo fora do escopo do token: fica.
  preparar([integ(M1, t1), integ(M2, t1)]);
  respostaMerchants[t1] = { status: 200, body: [{ id: M2, name: "Loja 2" }] };
  await rodar();
  confere("GET /merchants listando o M2 segura ele", estado(), { aaaa: true, bbbb: true });

  // 6. Renovação que falhou agora: o M2 tem token próprio vencido (com ele no
  // escopo) e caiu no token do usuário, que não o enxerga. Não é prova.
  const t2velho = jwt("t2velho", [M2]);
  preparar([integ(M1, t1), integ(M2, t2velho, { tokenExpiresAt: PASSADO, refreshToken: "r2" })], t1);
  await rodar();
  confere("renovação falhou: vale o último escopo do token próprio, ninguém cai", estado(), { aaaa: true, bbbb: true });

  // 7. Volta sozinha: estava false e reapareceu no token.
  preparar([integ(M1, t12), integ(M2, t12, { connected: false })]);
  await rodar();
  confere("autorizou de novo: volta para connected=true", estado(), { aaaa: true, bbbb: true });

  // 8. O central enxerga a loja: continua autorizada.
  process.env.IFOOD_CENTRAL_FALLBACK = "";
  centralToken = jwt("central", [M2]);
  preparar([integ(M1, t1), integ(M2, t1)]);
  await rodar();
  confere("o app central ainda enxerga o M2: fica", estado(), { aaaa: true, bbbb: true });

  // 9. Sem token nenhum: nada a conferir.
  process.env.IFOOD_CENTRAL_FALLBACK = "off";
  preparar([integ(M1, null, { tokenExpiresAt: null })]);
  await rodar();
  confere("loja sem token utilizável: nada muda (é outro problema)", estado(), { aaaa: true });

  console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
  process.exit(falhas === 0 ? 0 : 1);
})();
