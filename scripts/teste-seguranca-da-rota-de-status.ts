/**
 * Hotfix de segurança (30/09/2026), sem nada do emissor de NFC-e:
 *
 *   1. PUT /api/customer-order/status carregava o pedido com
 *      `include: { franchisee: true }` e, no "status igual ao atual",
 *      devolvia o `order` inteiro — com a linha User da loja (hash da senha,
 *      resetToken em claro, tokens do Mercado Pago/iFood/99/JotaJá). Um
 *      funcionário pedia "esqueci a senha" do dono e lia o token aqui.
 *   2. /api/motoboys/dispatch-whatsapp e /api/store/routes/dispatch aceitavam
 *      pedidos/rotas de OUTRA loja (IDOR).
 *
 *   npx tsx scripts/teste-seguranca-da-rota-de-status.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};
const verdade = (oQue: string, cond: boolean, detalhe = "") => {
  if (!cond) falhas++;
  console.log(`${cond ? "✅" : "❌"} ${oQue}${cond ? "" : ` — ${detalhe}`}`);
};

const RAIZ = join(__dirname, "..");
const leRota = (rel: string) => readFileSync(join(RAIZ, "src", "app", "api", ...rel.split("/")), "utf8");

Object.assign(process.env, { NODE_ENV: "development" });
delete process.env.NEXTAUTH_SECRET;
process.env.DATABASE_URL ||= "postgresql://banco-falso/teste";

// ── Banco falso e stubs (instalados ANTES de importar qualquer rota) ─────────
type Linha = Record<string, any>;
const db: { user: Linha[]; customerOrder: Linha[]; routeSchedule: Linha[]; motoboy: Linha[] } = { user: [], customerOrder: [], routeSchedule: [], motoboy: [] };
const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const copia = <T,>(v: T): T => (v == null ? v : structuredClone(v));

function casaCampo(valor: any, filtro: any): boolean {
  if (filtro === null) return valor == null;
  if (typeof filtro !== "object" || Array.isArray(filtro)) return igual(valor, filtro);
  for (const [op, alvo] of Object.entries(filtro)) {
    if (op === "equals") { if (!igual(valor, alvo)) return false; }
    else if (op === "in") { if (!(alvo as unknown[]).includes(valor)) return false; }
    else if (op === "notIn") { if ((alvo as unknown[]).includes(valor)) return false; }
    else return false; // operador não previsto no banco falso deste teste
  }
  return true;
}
function casa(linha: Linha, where: any): boolean {
  if (!where) return true;
  for (const [k, v] of Object.entries(where)) {
    if (k === "AND") { if (!(v as any[]).every((w) => casa(linha, w))) return false; }
    else if (k === "OR") { if (!(v as any[]).some((w) => casa(linha, w))) return false; }
    else if (k === "NOT") { if (casa(linha, v)) return false; }
    // Relação (ex.: { franchisee: { ownerId } }): o banco falso não carrega
    // relação; a checagem cai no franchiseeId da outra cláusula do OR.
    else if (k === "franchisee") { return false; }
    else if (!casaCampo(linha[k], v)) return false;
  }
  return true;
}
const projetar = (linha: Linha, select?: Record<string, any>): Linha => {
  const c = copia(linha);
  if (!select) return c;
  const saida: Linha = {};
  for (const [k, v] of Object.entries(select)) {
    if (v === true) saida[k] = c[k] ?? null;
    else if (v && typeof v === "object" && "select" in v) saida[k] = c[k] ?? null; // relação: o teste não precisa do conteúdo
    else if (v && typeof v === "object") saida[k] = c[k] ?? null;
  }
  return saida;
};
const delegado = (modelo: keyof typeof db) => ({
  findUnique: async (a: any) => { const l = db[modelo].find((x) => casa(x, a.where)); return l ? projetar(l, a.select) : null; },
  findFirst: async (a: any) => { const l = db[modelo].find((x) => casa(x, a.where)); return l ? projetar(l, a.select) : null; },
  findMany: async (a: any = {}) => db[modelo].filter((x) => casa(x, a.where)).map((l) => projetar(l, a.select)),
  update: async (a: any) => { const l = db[modelo].find((x) => casa(x, a.where)); if (!l) throw new Error(`update ${modelo} não achou`); Object.assign(l, copia(a.data)); return projetar(l, a.select); },
  updateMany: async (a: any) => { const alvos = db[modelo].filter((x) => casa(x, a.where)); for (const l of alvos) Object.assign(l, copia(a.data)); return { count: alvos.length }; },
});
(globalThis as any).prisma = {
  user: delegado("user"), customerOrder: delegado("customerOrder"),
  routeSchedule: delegado("routeSchedule"), motoboy: delegado("motoboy"),
  $transaction: async (arg: any) => (Array.isArray(arg) ? Promise.all(arg) : arg((globalThis as any).prisma)),
};

const stub = (caminho: string, exports: Record<string, unknown>) => {
  const arquivo = require.resolve(caminho);
  // `__esModule: true`: sem isto, o `await import()` de um módulo do
  // require.cache devolve só `default`, e os `const { x } = await import()`
  // das rotas viriam undefined (conferido com uma sonda).
  require.cache[arquivo] = { id: arquivo, filename: arquivo, loaded: true, exports: { __esModule: true, ...exports } } as any;
};
let sessaoEmail: string | null = null;
stub("next-auth/next", { getServerSession: async () => (sessaoEmail ? { user: { email: sessaoEmail } } : null) });
stub("../src/lib/auth", { authOptions: {} });
// Nada de rede: o WhatsApp e as notificações viram no-op.
let whatsappEnviou = 0;
stub("../src/lib/whatsapp-evolution", { sendEvolutionMessage: async () => { whatsappEnviou++; return true; } });
stub("../src/lib/order-notifications", { sendOrderNotification: async () => {} });
// Os ganchos fiscais fire-and-forget: registram os ids que receberiam nota.
const nfceDisparada: any[] = [];
stub("../src/lib/fiscal-automatico", { emitirNfceDosPedidos: async (w: any) => { nfceDisparada.push(w); }, emitirNfceAutomatica: async () => {} });

// ── 1. /api/customer-order/status: a resposta não leva a linha da loja ───────
async function secaoStatus() {
  console.log("\n[1] /api/customer-order/status não vaza a linha da loja");
  db.user.length = 0; db.customerOrder.length = 0;
  db.user.push({ id: "dono", email: "dono@loja.teste", ownerId: null });
  // O pedido do banco falso carrega o que o include ANTIGO traria: se o handler
  // ecoasse a linha, estes campos apareceriam. Como o SELECT novo nem os pede,
  // eles nunca chegam ao handler — e a resposta do "sem mudança" só tem status.
  db.customerOrder.push({
    id: "p1", franchiseeId: "dono", status: "ENTREGUE", source: "ONLINE", deliveryType: "DELIVERY",
    paymentMethod: "PIX", fiscalStatus: "PENDING", fiscalInfo: null,
    franchisee: { password: "$2b$hash", resetToken: "TOKEN-DE-RESET", mpAccessToken: "MP", ifoodAccessToken: "IF", food99SecretKey: "99", jotajaClientSecret: "JJ", fiscalConfig: { tokens: {} }, ownerId: null },
  });
  sessaoEmail = "dono@loja.teste";
  const { PUT } = await import("../src/app/api/customer-order/status/route");
  const res = await PUT(new Request("http://teste/api/customer-order/status", {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderId: "p1", status: "ENTREGUE" }), // = ao atual → "sem mudança"
  }) as any);
  const txt = await res.json();
  confere("sem mudança: responde { success, semMudanca, status }", [txt.success, txt.semMudanca, txt.status], [true, true, "ENTREGUE"]);
  verdade("a resposta NÃO traz a chave `order`", !("order" in txt));
  const bruto = JSON.stringify(txt);
  const vazou = ["password", "$2b$hash", "resetToken", "TOKEN-DE-RESET", "mpAccessToken", "ifoodAccessToken", "food99SecretKey", "jotajaClientSecret", "fiscalConfig", "franchisee"].filter((k) => bruto.includes(k));
  confere("nenhum campo da loja na resposta", vazou, []);
  const fonte = leRota("customer-order/status/route.ts");
  // O findUnique usa SELECT, e o CAMPOS_DO_PEDIDO recorta a loja a `ownerId`.
  verdade("o findUnique usa SELECT (não include da loja)", fonte.includes("select: CAMPOS_DO_PEDIDO") && /franchisee:\s*\{\s*select:\s*\{\s*ownerId:\s*true\s*\}\s*\}/.test(fonte));
  // Nenhum NextResponse.json devolve a variável `order` como valor (bare
  // `order` cercado por `{`/`,` e `,`/`}`); `order.status` não casa.
  verdade("nenhum retorno devolve a variável `order`", !/NextResponse\.json\([^)]*[,{]\s*order\s*[,}]/.test(fonte));
}

// ── 2. IDOR: dispatch-whatsapp filtra por loja ───────────────────────────────
async function secaoDispatch() {
  console.log("\n[2] dispatch-whatsapp: IDOR (pedido de outra loja)");
  db.user.length = 0; db.customerOrder.length = 0; nfceDisparada.length = 0;
  db.user.push({ id: "dono", email: "dono@loja.teste", ownerId: null });
  db.customerOrder.push(
    { id: "meu", franchiseeId: "dono", status: "ACEITO" },
    { id: "alheio", franchiseeId: "OUTRA_LOJA", status: "ACEITO" },
  );
  sessaoEmail = "dono@loja.teste";
  const { POST } = await import("../src/app/api/motoboys/dispatch-whatsapp/route");
  const res = await POST(new Request("http://teste/api/motoboys/dispatch-whatsapp", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ motoboyPhone: "22998887766", routeText: "rota", orderIds: ["meu", "alheio"] }),
  }) as any);
  verdade("respondeu 200", res.status === 200);
  // O gancho fiscal é fire-and-forget (import().then): deixa o microtask rodar.
  await new Promise((r) => setTimeout(r, 20));
  const meu = db.customerOrder.find((o) => o.id === "meu")!;
  const alheio = db.customerOrder.find((o) => o.id === "alheio")!;
  confere("o pedido DA LOJA foi para SAIU_ENTREGA", meu.status, "SAIU_ENTREGA");
  confere("o pedido de OUTRA loja NÃO foi tocado", alheio.status, "ACEITO");
  const fonteDispatch = leRota("motoboys/dispatch-whatsapp/route.ts");
  verdade("o updateMany filtra por franchiseeId/OR da loja", /updateMany\(\{\s*where:\s*\{\s*id:\s*\{\s*in:\s*idsDaLoja\s*\},\s*\.\.\.daLojaEDespachavel/.test(fonteDispatch));
  const fonteRota = leRota("store/routes/dispatch/route.ts");
  verdade("routes/dispatch carrega o usuário e exige a rota da loja", fonteRota.includes("user.ownerId || user.id") && fonteRota.includes("routeSchedule.findFirst") && fonteRota.includes("...daLoja"));
  verdade("routes/dispatch exige o motoboy da loja", fonteRota.includes("motoboy.findFirst") && fonteRota.includes("String(finalMotoboyId), ...daLoja"));
}


(async () => {
  await secaoStatus();
  await secaoDispatch();
  console.log(falhas ? `\n❌ ${falhas} falha(s).` : "\n✅ Tudo certo.");
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
