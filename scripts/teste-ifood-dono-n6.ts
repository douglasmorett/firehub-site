/**
 * Trava as correções de posse da integração iFood (auditoria de 23/10/2026,
 * branch fix/n6-ifood):
 *
 *   F29/F34  POST /api/ifood/auth com Merchant UUID colado: merchant que já é
 *            de OUTRA loja é recusado (a régua do link-merchant).
 *   F87      POST /api/ifood/integration/create: a mesma régua — olhando também
 *            User.ifoodMerchantId — e só com a caixinha do iFood.
 *   F79      /api/ifood/shipping, logistics/etapa e logistics/codigo: o orderId
 *            do corpo só vale para pedido DESTA loja.
 *
 * E o que não pode quebrar: a loja reconecta o próprio merchant, loja nova
 * conecta merchant livre, funcionário com permissão segue no pedido da loja.
 *
 * Sem banco nem rede: banco falso em globalThis.prisma e as libs de rede
 * trocadas no cache do require — o molde de scripts/teste-seguranca-da-madrugada.ts.
 *
 *   npx tsx scripts/teste-ifood-dono-n6.ts   (DATABASE_URL e NEXTAUTH_SECRET falsos já vêm de padrão)
 */
export {};

process.env.NEXTAUTH_SECRET ||= "teste";
process.env.DATABASE_URL ||= "postgresql://ninguem@localhost:1/nada";
// O central nem entra na cascata: a loja de teste tem token próprio.
process.env.IFOOD_CENTRAL_FALLBACK = "off";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — veio ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`}`);
};

// ── Ids ──────────────────────────────────────────────────────────────────────
const M_A = "aaaaaaaa-0000-4000-8000-000000000001";      // merchant da loja A (principal + integração)
const M_B = "bbbbbbbb-0000-4000-8000-000000000002";      // merchant da loja B (integração)
const M_VELHA = "cccccccc-0000-4000-8000-000000000003";  // loja antiga: só User.ifoodMerchantId
const M_LIVRE = "dddddddd-0000-4000-8000-000000000004";
const M_LIVRE2 = "eeeeeeee-0000-4000-8000-000000000005";
const O_A = "11111111-0000-4000-8000-00000000000a";      // CustomerOrder da loja A
const O_B = "22222222-0000-4000-8000-00000000000b";      // CustomerOrder da loja B
const O_SHIP_A = "33333333-0000-4000-8000-00000000000a"; // Shipping registrado pela loja A
const O_SHIP_B = "44444444-0000-4000-8000-00000000000b"; // Shipping registrado pela loja B

// ── Banco falso ──────────────────────────────────────────────────────────────
const FUTURO = new Date(Date.now() + 24 * 3600 * 1000);
type Usuario = { id: string; email: string; role: string; ownerId: string | null; permissions: string | null; ifoodMerchantId?: string | null; storeName?: string };
const USUARIOS: Usuario[] = [
  { id: "loja-a", email: "a@loja", role: "FRANCHISEE", ownerId: null, permissions: null, ifoodMerchantId: M_A, storeName: "Loja A" },
  // Resquício do bug antigo: o vínculo gravado no registro do funcionário.
  { id: "func-a", email: "func@a", role: "STAFF", ownerId: "loja-a", permissions: "orders,ifood", ifoodMerchantId: M_A },
  { id: "caixa-a", email: "caixa@a", role: "STAFF", ownerId: "loja-a", permissions: "orders" },
  { id: "loja-b", email: "b@loja", role: "FRANCHISEE", ownerId: null, permissions: null, ifoodMerchantId: null, storeName: "Loja B" },
  { id: "loja-velha", email: "velha@loja", role: "FRANCHISEE", ownerId: null, permissions: null, ifoodMerchantId: M_VELHA, storeName: "Loja Velha" },
  { id: "loja-nova", email: "nova@loja", role: "FRANCHISEE", ownerId: null, permissions: null, ifoodMerchantId: null, storeName: "Loja Nova" },
];
type Integracao = { id: string; userId: string; merchantId: string; label: string; active: boolean; connected: boolean; accessToken: string | null; refreshToken: string | null; tokenExpiresAt: Date | null; clientId: string | null; clientSecret: string | null; createdAt: Date };
let INTEGRACOES: Integracao[] = [];
const PEDIDOS = [
  { id: "co-a", ifoodOrderId: O_A, franchiseeId: "loja-a", ifoodDriverStatus: null as string | null, exige: true },
  { id: "co-b", ifoodOrderId: O_B, franchiseeId: "loja-b", ifoodDriverStatus: null as string | null, exige: true },
];
const SHIPPING = [
  { ifoodOrderId: O_SHIP_A, franchiseeId: "loja-a" },
  { ifoodOrderId: O_SHIP_B, franchiseeId: "loja-b" },
];
const integ = (id: string, userId: string, merchantId: string): Integracao => ({
  id, userId, merchantId, label: id, active: true, connected: true,
  accessToken: `token-${userId}`, refreshToken: null, tokenExpiresAt: FUTURO, clientId: null, clientSecret: null, createdAt: new Date(0),
});
let gravados: Record<string, any[]> = {};
const gravou = (onde: string, dados: any) => ((gravados[onde] ||= []).push(dados), dados);
const reiniciar = () => {
  INTEGRACOES = [integ("i-a", "loja-a", M_A), integ("i-b", "loja-b", M_B)];
  gravados = {};
  chamadas.length = 0;
  for (const p of PEDIDOS) p.ifoodDriverStatus = null;
};

const recorta = (o: any, select?: any) => (o && select ? Object.fromEntries(Object.keys(select).map((k) => [k, o[k] ?? null])) : o);
const casa = (o: any, where: any = {}): boolean =>
  Object.entries(where).every(([k, v]: [string, any]): boolean => {
    if (k === "NOT") return !casa(o, v);
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return v.in.includes(o[k]);
      if ("not" in v) return o[k] !== v.not;
      return true;
    }
    return o[k] === v;
  });
const comUser = (i: Integracao, select: any) => {
  const base = recorta(i, select);
  if (select?.user) base.user = recorta(USUARIOS.find((u) => u.id === i.userId), select.user.select);
  return base;
};
const valoresDo = (strings: TemplateStringsArray, values: any[]) => ({ sql: strings.join("?"), values });

(globalThis as any).prisma = {
  user: {
    findUnique: async ({ where, select }: any) =>
      recorta(USUARIOS.find((u) => (where.email ? u.email === where.email : u.id === where.id)) ?? null, select),
    findMany: async ({ where, select }: any) => USUARIOS.filter((u) => casa(u, where)).map((u) => recorta(u, select)),
    update: async ({ where, data }: any) => gravou("user.update", { id: where.id, ...data }),
  },
  ifoodIntegration: {
    findMany: async ({ where, select }: any) => INTEGRACOES.filter((i) => casa(i, where)).map((i) => comUser(i, select)),
    findFirst: async ({ where }: any) => INTEGRACOES.find((i) => casa(i, where)) ?? null,
    count: async ({ where }: any) => INTEGRACOES.filter((i) => casa(i, where)).length,
    create: async ({ data }: any) => {
      if (INTEGRACOES.some((i) => i.userId === data.userId && i.merchantId === data.merchantId)) throw Object.assign(new Error("dup"), { code: "P2002" });
      const nova = { ...integ(`i-${INTEGRACOES.length + 1}`, data.userId, data.merchantId), ...data };
      INTEGRACOES.push(nova);
      return gravou("ifoodIntegration.create", nova);
    },
    upsert: async ({ where, create }: any) => {
      const { userId, merchantId } = where.userId_merchantId;
      const achou = INTEGRACOES.find((i) => i.userId === userId && i.merchantId === merchantId);
      if (!achou) INTEGRACOES.push({ ...integ(`i-${INTEGRACOES.length + 1}`, userId, merchantId), ...create });
      return gravou("ifoodIntegration.upsert", { userId, merchantId });
    },
    update: async ({ data }: any) => data,
    updateMany: async () => ({ count: 0 }),
  },
  customerOrder: {
    findUnique: async ({ where, select }: any) => recorta(PEDIDOS.find((p) => p.ifoodOrderId === where.ifoodOrderId) ?? null, select),
    findFirst: async ({ where, select }: any) => recorta(PEDIDOS.find((p) => casa(p, where)) ?? null, select),
    update: async ({ where, data }: any) => {
      const p = PEDIDOS.find((x) => x.id === where.id);
      if (p && data.ifoodDriverStatus) p.ifoodDriverStatus = data.ifoodDriverStatus;
      return gravou("customerOrder.update", { id: where.id, ...data });
    },
    updateMany: async ({ where, data }: any) => gravou("customerOrder.updateMany", { where, data }),
  },
  $executeRawUnsafe: async () => 0,
  $executeRaw: async () => 0,
  $queryRaw: (strings: TemplateStringsArray, ...values: any[]) => {
    const { sql } = valoresDo(strings, values);
    if (sql.includes('"IfoodShippingPedido"')) {
      const [orderId, franchiseeId] = values;
      return Promise.resolve(SHIPPING.filter((s) => s.ifoodOrderId === orderId && s.franchiseeId === franchiseeId).map(() => ({ "?column?": 1 })));
    }
    if (sql.includes("ifoodDropCodeRequired")) {
      const p = PEDIDOS.find((x) => x.ifoodOrderId === values[0]);
      return Promise.resolve(p ? [{ exige: p.exige }] : []);
    }
    return Promise.resolve([]);
  },
};

// ── Sessão e libs de rede ────────────────────────────────────────────────────
const stub = (caminho: string, exports: Record<string, unknown>) => {
  const arquivo = require.resolve(caminho);
  require.cache[arquivo] = { id: arquivo, filename: arquivo, loaded: true, exports: { __esModule: true, ...exports } } as any;
};
let sessao: any = null;
const naSessao = (email: string | null) => { sessao = email ? { user: { email } } : null; };
const getServerSession = async () => sessao;
stub("next-auth/next", { getServerSession });
stub("next-auth", { getServerSession, default: () => null });
stub("../src/lib/auth", { authOptions: {} });
stub("../src/lib/ifood-api", {
  getIfoodToken: async () => { throw new Error("o central não pode ser chamado no teste"); },
  getTokenDaLojaIfood: async () => null,
  merchantsDoToken: () => [],
});
// Toda chamada ao iFood passa por aqui: registrar quem chamou é o que prova
// que o pedido alheio nem chegou ao iFood.
const chamadas: string[] = [];
stub("../src/lib/ifood-http", {
  chamarComContexto: async (_ctx: any, path: string) => (chamadas.push(path), { ok: true, status: 200, data: {}, tentativas: 1, origem: "integracao" }),
  chamarIfood: async () => { throw new Error("rede no teste"); },
  mensagemDeErro: () => "erro",
});

const req = (url: string, init?: { method?: string; body?: unknown }) => {
  const { NextRequest } = require("next/server");
  return new NextRequest(`http://localhost${url}`, {
    method: init?.method || "GET",
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body), headers: { "Content-Type": "application/json" } } : {}),
  });
};
const integracoesDe = (userId: string) => INTEGRACOES.filter((i) => i.userId === userId).map((i) => i.merchantId);

async function main() {
  // ── F29/F34: /api/ifood/auth com UUID colado ────────────────────────────────
  console.log("\n── F29/F34: /api/ifood/auth com Merchant UUID ──");
  const auth = await import("../src/app/api/ifood/auth/route");
  const colar = (uuid: string) => auth.POST(req("/api/ifood/auth", { method: "POST", body: { merchantId: uuid } }));

  reiniciar();
  naSessao("b@loja");
  let r: Response = await colar(M_A);
  confere("loja B cola o merchant da loja A: 409 e nada gravado", [r.status, gravados["user.update"]?.length ?? 0, integracoesDe("loja-b")], [409, 0, [M_B]]);
  r = await colar(M_VELHA);
  confere("…nem o da loja antiga, que só tem User.ifoodMerchantId", [r.status, integracoesDe("loja-b")], [409, [M_B]]);

  reiniciar();
  naSessao("a@loja");
  r = await colar(M_A);
  confere("loja A reconecta o próprio merchant (com resquício no funcionário): 200", [r.status, (await r.json()).success, integracoesDe("loja-a")], [200, true, [M_A]]);
  naSessao("func@a");
  r = await colar(M_A);
  confere("funcionário da A reconecta o merchant da A: 200, gravado na loja", [r.status, gravados["ifoodIntegration.upsert"]?.at(-1)?.userId], [200, "loja-a"]);

  reiniciar();
  naSessao("nova@loja");
  r = await colar(M_LIVRE);
  confere("loja nova conecta merchant livre: 200 e vira a principal", [r.status, integracoesDe("loja-nova"), gravados["user.update"]?.[0]?.ifoodMerchantId], [200, [M_LIVRE], M_LIVRE]);

  // ── F87: /api/ifood/integration/create ──────────────────────────────────────
  console.log("\n── F87: /api/ifood/integration/create ──");
  const criar = await import("../src/app/api/ifood/integration/create/route");
  const nova = (merchantId: string) => criar.POST(req("/api/ifood/integration/create", { method: "POST", body: { label: "Loja", merchantId } }));

  reiniciar();
  naSessao("b@loja");
  r = await nova(M_VELHA);
  confere("loja B não reivindica a loja antiga (só User.ifoodMerchantId): 409", [r.status, integracoesDe("loja-b")], [409, [M_B]]);
  r = await nova(M_A);
  confere("…nem a da loja A: 409", r.status, 409);
  naSessao("caixa@a");
  r = await nova(M_LIVRE2);
  confere("funcionário sem a caixinha do iFood: 403, nada criado", [r.status, integracoesDe("loja-a")], [403, [M_A]]);
  naSessao("func@a");
  r = await nova(M_LIVRE2);
  confere("funcionário com a caixinha do iFood cria na loja: 200", [r.status, integracoesDe("loja-a")], [200, [M_A, M_LIVRE2]]);
  naSessao("velha@loja");
  r = await nova(M_VELHA);
  confere("loja antiga cria a integração do próprio merchant: 200", [r.status, integracoesDe("loja-velha")], [200, [M_VELHA]]);
  naSessao("nova@loja");
  r = await nova(M_LIVRE);
  confere("loja nova cria com merchant livre: 200", [r.status, integracoesDe("loja-nova")], [200, [M_LIVRE]]);

  // ── F79: shipping ───────────────────────────────────────────────────────────
  console.log("\n── F79: /api/ifood/shipping ──");
  const shipping = await import("../src/app/api/ifood/shipping/route");
  const acao = (corpo: any) => shipping.POST(req("/api/ifood/shipping", { method: "POST", body: corpo }));
  const ver = (q: string) => shipping.GET(req(`/api/ifood/shipping?${q}`));

  reiniciar();
  naSessao("b@loja");
  r = await acao({ acao: "cancelar", orderId: O_SHIP_A, codigo: "501", motivo: "x" });
  confere("loja B cancela Shipping da loja A: 404, nenhuma chamada ao iFood", [r.status, chamadas.length], [404, 0]);
  r = await acao({ acao: "confirmar", orderId: O_A });
  confere("…nem confirma pedido do painel da A: 404", [r.status, chamadas.length], [404, 0]);
  r = await ver(`acao=detalhe&orderId=${O_SHIP_A}`);
  confere("…nem lê o detalhe (cliente, endereço) do pedido da A: 404", [r.status, chamadas.length], [404, 0]);
  r = await acao({ acao: "confirmar", orderId: O_SHIP_B });
  confere("loja B confirma o próprio Shipping: 200", [r.status, chamadas.length], [200, 1]);

  reiniciar();
  naSessao("func@a");
  r = await acao({ acao: "confirmar", orderId: O_SHIP_A });
  confere("funcionário da A confirma o Shipping da A: 200", [r.status, chamadas], [200, [`/order/v1.0/orders/${O_SHIP_A}/confirm`]]);
  r = await ver(`acao=rastreio&orderId=${O_SHIP_A}`);
  confere("…e vê o rastreio: 200", r.status, 200);
  naSessao("a@loja");
  r = await acao({ acao: "aceitarTroca", orderId: O_A });
  confere("dono da A age no pedido gravado no painel: 200", r.status, 200);

  // ── F79: logistics/etapa ────────────────────────────────────────────────────
  console.log("\n── F79: /api/ifood/logistics/etapa ──");
  const etapa = await import("../src/app/api/ifood/logistics/etapa/route");
  const alocar = (orderId: string) => etapa.POST(req("/api/ifood/logistics/etapa", {
    method: "POST",
    body: { orderId, etapa: "assignDriver", entregador: { nome: "Zé", telefone: "22999998888", veiculo: "MOTORCYCLE" } },
  }));

  reiniciar();
  naSessao("b@loja");
  r = await alocar(O_A);
  confere("loja B aloca entregador no pedido da A: 404, sem chamada", [r.status, chamadas.length, PEDIDOS[0].ifoodDriverStatus], [404, 0, null]);
  r = await alocar("99999999-0000-4000-8000-000000000009");
  confere("…nem em pedido que não existe aqui: 404", [r.status, chamadas.length], [404, 0]);
  naSessao("func@a");
  r = await alocar(O_A);
  confere("funcionário da A aloca no pedido da A: 200 e grava a etapa", [r.status, chamadas.length, PEDIDOS[0].ifoodDriverStatus], [200, 1, "ASSIGNED"]);

  // ── F79: logistics/codigo ───────────────────────────────────────────────────
  console.log("\n── F79: /api/ifood/logistics/codigo ──");
  const codigo = await import("../src/app/api/ifood/logistics/codigo/route");
  const validar = (orderId: string) => codigo.POST(req("/api/ifood/logistics/codigo", { method: "POST", body: { orderId, codigo: "1234", forcar: true } }));

  reiniciar();
  naSessao("b@loja");
  r = await validar(O_A);
  confere("loja B valida código no pedido da A (mesmo com forcar): 404, sem chamada", [r.status, chamadas.length, gravados["customerOrder.updateMany"]?.length ?? 0], [404, 0, 0]);
  naSessao("func@a");
  r = await validar(O_A);
  confere("funcionário da A valida o código do pedido da A: 200, conferido", [r.status, (await r.json()).conferido, chamadas.length], [200, true, 1]);

  console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo certo.");
  process.exit(falhas ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
