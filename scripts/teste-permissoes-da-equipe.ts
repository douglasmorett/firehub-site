/**
 * Quem da loja pode o quê nas rotas de /api (auditoria de 23/10/2026).
 *
 * O proxy só confere as caixinhas do funcionário ao abrir a página; a rota
 * chamada direto passava para qualquer login. Aqui:
 *   1. as regras puras (lib/permissoes-da-equipe.ts, configSemCredenciais);
 *   2. os handlers, com sessão e prisma de mentira: o funcionário sem a
 *      caixinha leva 403, o dono continua passando, e o que vai ao navegador
 *      não leva senha nem chave.
 *
 *   npx tsx scripts/teste-permissoes-da-equipe.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

process.env.NEXTAUTH_SECRET ||= "teste";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — veio ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`}`);
};
const ler = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8");

// ── Banco e sessão de mentira ──────────────────────────────────────────────
type Usuario = { id: string; email: string; role: string; ownerId: string | null; permissions: string | null; accountGroupId?: string | null; password?: string; chatbotConfig?: any };
const USUARIOS: Usuario[] = [
  { id: "dono", email: "dono@loja", role: "FRANCHISEE", ownerId: null, permissions: null, password: "$2a$12$hashDoDono", chatbotConfig: { evolutionUrl: "https://gw", evolutionApiKey: "chave-do-gw", geminiApiKey: "AIza-plataforma", cloudApiAccessToken: "EAAG", pixDaLoja: null, active: true } },
  { id: "filial", email: "filial@loja", role: "FRANCHISEE", ownerId: null, permissions: null, accountGroupId: "dono" },
  { id: "caixa", email: "caixa@loja", role: "STAFF", ownerId: "dono", permissions: "orders,kds" },
  { id: "gerente", email: "gerente@loja", role: "STAFF", ownerId: "dono", permissions: "orders,financeiro,minha_loja,cardapio,motoboys" },
  { id: "admin", email: "admin@firehub", role: "ADMIN", ownerId: null, permissions: null },
  { id: "rebaixado", email: "ex-admin@firehub", role: "FRANCHISEE", ownerId: null, permissions: null },
];
let logado: string | null = null;
const naSessao = (email: string | null, roleNoCookie?: string) => {
  logado = email;
  cookieRole = roleNoCookie ?? USUARIOS.find((u) => u.email === email)?.role ?? null;
};
let cookieRole: string | null = null;
const gravados: Record<string, any[]> = {};
const gravou = (onde: string, dados: any) => ((gravados[onde] ||= []).push(dados), dados);

async function prepararMocks() {
  const na = require("next-auth/next");
  na.getServerSession = async () => (logado ? { user: { email: logado, role: cookieRole } } : null);

  const { prisma } = await import("../src/lib/prisma");
  const p = prisma as any;
  const acha = (where: any) => USUARIOS.find((u) => (where.email ? u.email === where.email : u.id === where.id)) ?? null;
  const recorta = (u: any, select?: any) => (u && select ? Object.fromEntries(Object.keys(select).map((k) => [k, u[k] ?? null])) : u);
  p.user.findUnique = async ({ where, select }: any) => recorta(acha(where), select);
  p.user.findMany = async () => [];
  p.user.update = async ({ data }: any) => gravou("user.update", data);
  p.user.create = async ({ data, select }: any) => recorta({ id: "nova", ...gravou("user.create", data) }, select);
  p.ambassador.findFirst = async () => null;
  p.apiKey.create = async ({ data, select }: any) => recorta({ id: "k1", active: true, createdAt: new Date(0), ...gravou("apiKey.create", data) }, select);
  p.apiKey.deleteMany = async () => (gravou("apiKey.deleteMany", {}), { count: 1 });
  p.menuProduct.count = async () => 0;
  p.menuProduct.findMany = async () => (gravou("menuProduct.findMany", {}), []);
  p.menuCategory.count = async () => 0;
  p.purchaseInvoice.findMany = async ({ where }: any) => (gravou("purchaseInvoice.findMany", where), []);
  p.purchaseInvoice.deleteMany = async () => ({ count: 1 });
  p.purchaseInvoice.create = async ({ data }: any) => gravou("purchaseInvoice.create", data);
  // Rota de outra loja: findFirst com o filtro da loja não acha.
  p.routeSchedule.findFirst = async ({ where }: any) => {
    const lojas: string[] = where?.franchiseeId?.in ?? [];
    return where?.id === "rota-da-loja" && lojas.includes("dono") ? { id: "rota-da-loja" } : null;
  };
  p.routeSchedule.update = async () => (gravou("routeSchedule.update", {}), { id: "rota-da-loja", motoboy: null, routeNumber: "R1" });
  p.routeSchedule.findUnique = async (args: any) => (gravou("routeSchedule.findUnique", args), { id: "rota-da-loja" });
  p.motoboy.findFirst = async ({ where }: any) => (where?.id === "moto-da-loja" ? { id: "moto-da-loja" } : null);
  p.customerOrder.findMany = async () => [];
  p.customerOrder.updateMany = async () => ({ count: 0 });
}

const req = (url: string, init?: { method?: string; body?: unknown }) => {
  const { NextRequest } = require("next/server");
  return new NextRequest(`http://localhost${url}`, {
    method: init?.method || "GET",
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body), headers: { "Content-Type": "application/json" } } : {}),
  });
};

async function main() {
  // ── 1. Regras puras ───────────────────────────────────────────────────────
  const { ehDonoOuAdmin, podeComoNaTela, ehAdminNoBanco } = await import("../src/lib/permissoes-da-equipe");
  const u = (id: string) => USUARIOS.find((x) => x.id === id)!;
  console.log("\n── Dono ou ADMIN ──");
  confere("dono da loja passa", ehDonoOuAdmin(u("dono")), true);
  confere("filial (FRANCHISEE do grupo) passa", ehDonoOuAdmin(u("filial")), true);
  confere("ADMIN passa", ehDonoOuAdmin(u("admin")), true);
  confere("funcionário, mesmo com tudo marcado, não passa", ehDonoOuAdmin(u("gerente")), false);
  confere("STAFF da equipe interna (sem dono) não passa", ehDonoOuAdmin({ role: "STAFF", ownerId: null }), false);
  confere("parceiro (AMBASSADOR) não passa", ehDonoOuAdmin({ role: "AMBASSADOR", ownerId: null }), false);
  confere("sem usuário não passa", ehDonoOuAdmin(null), false);

  console.log("\n── A caixinha da tela ──");
  confere("dono passa em qualquer tela", ["/store/fiscal", "/store/chatbot", "/store/cardapio"].map((t) => podeComoNaTela(u("dono"), t)), [true, true, true]);
  confere("ADMIN passa", podeComoNaTela(u("admin"), "/store/financeiro"), true);
  confere("caixa (Pedidos/KDS) não abre Fiscal, Financeiro, Robô, Cardápio, Motoboys",
    ["/store/fiscal", "/store/financeiro", "/store/chatbot", "/store/cardapio", "/store/motoboys"].map((t) => podeComoNaTela(u("caixa"), t)),
    [false, false, false, false, false]);
  confere("gerente com as caixinhas abre as mesmas telas",
    ["/store/fiscal", "/store/financeiro", "/store/chatbot", "/store/cardapio", "/store/motoboys"].map((t) => podeComoNaTela(u("gerente"), t)),
    [true, true, true, true, true]);
  confere("sem usuário não passa", podeComoNaTela(null, "/store/fiscal"), false);

  await prepararMocks();
  console.log("\n── ADMIN lido do banco ──");
  confere("ADMIN no banco passa", await ehAdminNoBanco({ user: { email: "admin@firehub" } }), true);
  confere("cookie diz ADMIN, banco diz FRANCHISEE: não passa", await ehAdminNoBanco({ user: { email: "ex-admin@firehub", role: "ADMIN" } }), false);
  confere("sem sessão não passa", await ehAdminNoBanco(null), false);

  console.log("\n── Credenciais do robô ──");
  const { configSemCredenciais, CREDENCIAL_SALVA } = await import("../src/lib/gateway-da-loja");
  const original = { evolutionUrl: "https://gw", evolutionApiKey: "k", geminiApiKey: "", cloudApiAccessToken: "t", phone: "5522", active: true };
  const limpo = configSemCredenciais(original);
  confere("chaves viram marcador", [limpo.evolutionUrl, limpo.evolutionApiKey, limpo.cloudApiAccessToken], [CREDENCIAL_SALVA, CREDENCIAL_SALVA, CREDENCIAL_SALVA]);
  confere("vazia continua vazia (a tela não vê chave que não existe)", limpo.geminiApiKey, "");
  confere("Boolean(evolutionUrl) da tela continua verdadeiro", Boolean(limpo.evolutionUrl), true);
  confere("o resto passa igual", [limpo.phone, limpo.active], ["5522", true]);
  confere("não mexe no objeto salvo", original.evolutionApiKey, "k");
  // O marcador que a tela devolve ao salvar não pode virar a chave: a gravação
  // só aceita os campos do lojista, e nenhuma credencial está entre eles.
  const campos = ler("src/app/api/chatbot/config/route.ts").split("const CAMPOS_DO_LOJISTA = [")[1].split("] as const")[0];
  confere("nenhuma credencial na lista de campos graváveis", ["evolutionUrl", "evolutionApiKey", "geminiApiKey", "cloudApi", "instanceName"].filter((c) => campos.includes(`"${c}`)), []);

  // ── 2. Handlers ───────────────────────────────────────────────────────────
  console.log("\n── /api/store/api-keys ──");
  const apiKeys = await import("../src/app/api/store/api-keys/route");
  naSessao("caixa@loja");
  confere("funcionário não cria chave (403)", (await apiKeys.POST(req("/api/store/api-keys", { method: "POST", body: { name: "x" } }))).status, 403);
  confere("…nem revoga (403)", (await apiKeys.DELETE(req("/api/store/api-keys?id=k1", { method: "DELETE" }))).status, 403);
  confere("nada gravado", [gravados["apiKey.create"]?.length ?? 0, gravados["apiKey.deleteMany"]?.length ?? 0], [0, 0]);
  naSessao("dono@loja");
  const criada = await apiKeys.POST(req("/api/store/api-keys", { method: "POST", body: { name: "PDV" } }));
  confere("dono cria (201) na loja dele", [criada.status, gravados["apiKey.create"]?.[0]?.franchiseeId], [201, "dono"]);
  confere("dono revoga", (await apiKeys.DELETE(req("/api/store/api-keys?id=k1", { method: "DELETE" }))).status, 200);

  console.log("\n── /api/store/create ──");
  const criar = await import("../src/app/api/store/create/route");
  naSessao("gerente@loja");
  confere("funcionário não abre loja nova (403)", (await criar.POST(req("/api/store/create", { method: "POST", body: { storeName: "X" } }) as any)).status, 403);
  naSessao("dono@loja");
  const nova = await criar.POST(req("/api/store/create", { method: "POST", body: { storeName: "Filial Centro" } }) as any);
  const corpoDaNova = await nova.json();
  confere("dono abre (200, success)", [nova.status, corpoDaNova.success], [200, true]);
  confere("a resposta só leva id, nome e slug — sem hash de senha", Object.keys(corpoDaNova.store).sort(), ["id", "slug", "storeName"]);
  confere("(F143, fora daqui: a filial ainda nasce com a cópia do hash)", gravados["user.create"]?.[0]?.password, "$2a$12$hashDoDono");

  console.log("\n── /api/store/routes PATCH ──");
  const rotas = await import("../src/app/api/store/routes/route");
  naSessao("dono@loja");
  const alheia = await rotas.PATCH(req("/api/store/routes", { method: "PATCH", body: { routeId: "rota-de-outra-loja", motoboyId: "moto-da-loja" } }));
  confere("rota de outra loja sem orderIds: 404 e nada gravado", [alheia.status, gravados["routeSchedule.update"]?.length ?? 0], [404, 0]);
  const motoAlheio = await rotas.PATCH(req("/api/store/routes", { method: "PATCH", body: { routeId: "rota-da-loja", motoboyId: "moto-de-outra-loja" } }));
  confere("entregador de outra loja: 404 e nada gravado", [motoAlheio.status, gravados["routeSchedule.update"]?.length ?? 0], [404, 0]);
  const troca = await rotas.PATCH(req("/api/store/routes", { method: "PATCH", body: { routeId: "rota-da-loja", motoboyId: "moto-da-loja" } }));
  confere("trocar o entregador da própria rota continua (200)", troca.status, 200);
  const devolvida = gravados["routeSchedule.findUnique"]?.at(-1)?.include;
  confere("a rota volta sem a senha do entregador", devolvida?.motoboy, { select: { id: true, name: true, phone: true } });

  console.log("\n── /api/admin/clean-no-photo-products ──");
  const semFoto = await import("../src/app/api/admin/clean-no-photo-products/route");
  naSessao("caixa@loja");
  confere("funcionário sem Cardápio não apaga (403)", [(await semFoto.POST(req("/api/admin/clean-no-photo-products", { method: "POST" }))).status, gravados["menuProduct.findMany"]?.length ?? 0], [403, 0]);
  naSessao("gerente@loja");
  confere("funcionário com Cardápio passa", (await semFoto.POST(req("/api/admin/clean-no-photo-products", { method: "POST" }))).status, 200);

  console.log("\n── /api/invoices ──");
  const notas = await import("../src/app/api/invoices/route");
  naSessao("caixa@loja");
  confere("funcionário sem Financeiro não lista (403)", (await notas.GET(req("/api/invoices?category=BUSINESS"))).status, 403);
  confere("…nem apaga (403)", (await notas.DELETE(req("/api/invoices", { method: "DELETE", body: { id: "n1" } }))).status, 403);
  const manual = await import("../src/app/api/invoices/manual/route");
  confere("…nem lança nota manual (403)", [(await manual.POST(req("/api/invoices/manual", { method: "POST", body: { description: "x", value: "5000" } }))).status, gravados["purchaseInvoice.create"]?.length ?? 0], [403, 0]);
  naSessao("gerente@loja");
  confere("funcionário com Financeiro lista (200)", (await notas.GET(req("/api/invoices?category=PERSONAL"))).status, 200);
  confere("…mas sem as notas PESSOAIS do dono", gravados["purchaseInvoice.findMany"]?.at(-1)?.NOT, { category: "PERSONAL" });
  naSessao("dono@loja");
  await notas.GET(req("/api/invoices?category=PERSONAL"));
  confere("o dono vê as pessoais", gravados["purchaseInvoice.findMany"]?.at(-1)?.NOT, undefined);

  console.log("\n── /api/store/fiscal/contador/exportar ──");
  const exportar = await import("../src/app/api/store/fiscal/contador/exportar/route");
  naSessao("caixa@loja");
  confere("funcionário sem Financeiro não baixa o pacote (403)", (await exportar.GET(new Request("http://localhost/x?de=2026-10-01&ate=2026-10-02"))).status, 403);

  console.log("\n── /api/chatbot/config ──");
  const robo = await import("../src/app/api/chatbot/config/route");
  naSessao("caixa@loja");
  const lido = await (await robo.GET()).json();
  confere("qualquer login lê, mas sem as chaves", [lido.config.evolutionApiKey, lido.config.geminiApiKey, lido.config.cloudApiAccessToken], [CREDENCIAL_SALVA, CREDENCIAL_SALVA, CREDENCIAL_SALVA]);
  confere("…e com o que a tela usa", [Boolean(lido.config.evolutionUrl), lido.config.active], [true, true]);
  const pixDoCaixa = await robo.POST(req("/api/chatbot/config", { method: "POST", body: { pixDaLoja: { chave: "x" } } }));
  confere("funcionário sem Minha loja não grava (403)", [pixDoCaixa.status, gravados["user.update"]?.length ?? 0], [403, 0]);
  naSessao("dono@loja");
  const salvo = await robo.POST(req("/api/chatbot/config", { method: "POST", body: { ...lido.config, customPrompt: "oi" } }));
  const corpoSalvo = await salvo.json();
  const noBanco = gravados["user.update"]?.at(-1)?.chatbotConfig;
  confere("dono grava (200)", [salvo.status, noBanco?.customPrompt], [200, "oi"]);
  confere("o marcador que a tela devolveu não apagou as chaves salvas", [noBanco?.evolutionApiKey, noBanco?.geminiApiKey, noBanco?.evolutionUrl], ["chave-do-gw", "AIza-plataforma", "https://gw"]);
  confere("a resposta do POST também vai sem as chaves", corpoSalvo.config.evolutionApiKey, CREDENCIAL_SALVA);

  console.log("\n── /api/chatbot/diagnostico ──");
  const diag = await import("../src/app/api/chatbot/diagnostico/route");
  naSessao("dono@loja");
  confere("lojista não vê o rastro de todas as lojas (401)", (await diag.GET(req("/api/chatbot/diagnostico"))).status, 401);
  naSessao("ex-admin@firehub", "ADMIN");
  confere("ADMIN rebaixado (cookie velho) não vê", (await diag.GET(req("/api/chatbot/diagnostico"))).status, 401);
  naSessao("admin@firehub");
  confere("ADMIN vê", (await diag.GET(req("/api/chatbot/diagnostico"))).status, 200);

  console.log("\n── /api/admin/check-role ──");
  const checkRole = await import("../src/app/api/admin/check-role/route");
  naSessao("ex-admin@firehub", "ADMIN");
  const volta = await checkRole.POST(new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ email: "ex-admin@firehub", role: "ADMIN" }) }));
  confere("ADMIN rebaixado não se promove de volta (403)", volta.status, 403);

  console.log("\n── /api/motoboys/[id] ──");
  const moto = await import("../src/app/api/motoboys/[id]/route");
  naSessao("caixa@loja");
  confere("funcionário sem Motoboys não edita nem apaga (403)", [
    (await moto.PUT(new Request("http://localhost/x", { method: "PUT", body: JSON.stringify({ password: "1" }) }), { params: Promise.resolve({ id: "m1" }) })).status,
    (await moto.DELETE(new Request("http://localhost/x", { method: "DELETE" }), { params: Promise.resolve({ id: "m1" }) })).status,
  ], [403, 403]);

  console.log("\n── Escrita do cardápio ──");
  const cardapio = await import("../src/app/api/admin/menu-products/route");
  naSessao("caixa@loja");
  confere("funcionário sem Cardápio não grava produto (403)", [
    (await cardapio.POST(req("/api/admin/menu-products", { method: "POST", body: {} }))).status,
    (await cardapio.PUT(req("/api/admin/menu-products", { method: "PUT", body: {} }))).status,
    (await cardapio.DELETE(req("/api/admin/menu-products?id=p1", { method: "DELETE" }))).status,
    (await cardapio.PATCH(req("/api/admin/menu-products", { method: "PATCH", body: {} }))).status,
  ], [403, 403, 403, 403]);
  const pizzas = await import("../src/app/api/admin/cardapio/pizzas/route");
  confere("…nem cadastra pizza (403)", (await pizzas.POST(req("/api/admin/cardapio/pizzas", { method: "POST", body: {} }))).status, 403);

  console.log("\n── O que vai ao navegador (conferência no código) ──");
  const paginaMotoboys = ler("src/app/store/motoboys/page.tsx");
  confere("/store/motoboys tira password e pinCode antes das props", /\(\{ password, pinCode, \.\.\.mb \}\)/.test(paginaMotoboys), true);
  confere("assign-motoboy não carrega o motoboy inteiro", /^\s*motoboy: true,/m.test(ler("src/app/api/customer-order/assign-motoboy/route.ts")), false);
  confere("/store decide o ADMIN pelo banco", /const role = \(session\.user as any\)\?\.role/.test(ler("src/app/store/page.tsx")), false);

  console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo certo.");
  process.exit(falhas ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
