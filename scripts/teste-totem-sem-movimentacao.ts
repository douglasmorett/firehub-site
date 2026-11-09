/** Mano, 09/11: duas licenças ativas sem pedido geravam R$100 + R$200.
 * Executa funções REAIS de billing com ORM em memória; sem rede/boot/Asaas.
 * npx --no-install tsx scripts/teste-totem-sem-movimentacao.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { calcMensalidade, FIREHUB_PLAN, percentualDoMes, MES_DOS_2_POR_CENTO, VIRADA_DOS_2_POR_CENTO } from "../src/lib/firehub-billing";
import { fimDoTeste } from "../src/lib/fim-do-teste";

type Linha = Record<string, any>;
const mes = "2026-11", ini = new Date("2026-11-01T03:00:00Z"), fim = new Date("2026-12-01T03:00:00Z");
const noMes = new Date("2026-11-05T12:00:00Z");
let orders: Linha[], licenses: Linha[], events: Linha[], bills: Linha[], cash: Linha[], invoices: Linha[];
let cycle: Linha | null, user: Linha, writes = 0;

// Interpreta o subconjunto de filtros usado pelas funções reais; os critérios
// são lidos do produto, não reescritos pelo teste.
function matches(row: Linha, where: Linha = {}): boolean {
  return Object.entries(where).every(([k, v]: [string, any]) => {
    const arr = (x: any) => Array.isArray(x) ? x : [x];
    if (k === "AND") return arr(v).every(x => matches(row, x));
    if (k === "OR") return arr(v).some(x => matches(row, x));
    if (k === "NOT") return !arr(v).some(x => matches(row, x));
    const value = row[k] ?? null;
    if (v instanceof Date) return value instanceof Date && +value === +v;
    if (v === null || typeof v !== "object") return value === v;
    if (v.path) return v.path.reduce((a: any, p: string) => a?.[p], value) === v.equals;
    return Object.entries(v).every(([op, target]: [string, any]) => {
      if (op === "not") return value !== target;
      if (op === "in") return target.includes(value);
      if (op === "notIn") return !target.includes(value);
      if (op === "gte") return value >= target;
      if (op === "gt") return value > target;
      if (op === "lt") return value < target;
      throw new Error("Filtro não implementado no ORM de teste: " + op);
    });
  });
}
const count = (rows: () => Linha[]) => ({ count: async ({ where }: any) => rows().filter(r => matches(r, where)).length });
const prisma: any = {
  user: { findUnique: async () => user },
  customerOrder: {
    count: async ({ where }: any) => orders.filter(o => matches(o, where)).length,
    findMany: async ({ where, distinct }: any) => {
      const rows = orders.filter(o => matches(o, where));
      return distinct ? [...new Map(rows.map(o => [distinct.map((k: string) => o[k]).join("|"), o])).values()] : rows;
    },
    aggregate: async ({ where }: any) => ({ _sum: orders.filter(o => matches(o, where)).reduce((a, o) => ({ totalAmount: a.totalAmount + o.totalAmount, discountTotal: a.discountTotal + (o.discountTotal || 0) }), { totalAmount: 0, discountTotal: 0 }) }),
  },
  totemLicense: {
    ...count(() => licenses),
    groupBy: async () => [...new Set(licenses.map(l => l.franchiseeId))].map(franchiseeId => ({ franchiseeId })),
  }, usageLog: count(() => events),
  payable: count(() => bills), cashSession: count(() => cash), purchaseInvoice: count(() => invoices),
  franchiseeBillingCycle: {
    findUnique: async ({ include }: any) => cycle && ({ ...cycle, ...(include ? { franchisee: user } : {}) }),
    findMany: async ({ where }: any) => cycle && matches(cycle, where) ? [cycle] : [],
    count: async ({ where }: any) => cycle && matches(cycle, where) ? 1 : 0,
    update: async ({ data }: any) => { assert.ok(cycle); Object.assign(cycle, data); writes++; return cycle; },
    updateMany: async ({ where, data }: any) => {
      if (!cycle || !matches(cycle, where)) return { count: 0 };
      Object.assign(cycle, data); writes++; return { count: 1 };
    },
    createMany: async ({ data }: any) => {
      if (cycle) return { count: 0 };
      cycle = { ...data[0] }; writes++; return { count: 1 };
    },
  },
};
function setup() {
  user = { id: "loja", storeTimezone: "America/Sao_Paulo", planPercent: 2, trialEndsAt: null, accountGroupId: null };
  cycle = { id: "ciclo", franchiseeId: "loja", yearMonth: mes, status: "OPEN", totalSales: 0, amountDue: 100, amountPending: 300, amountOffset: 0, totemFee: 200, metaAdsFee: 0, asaasPaymentId: null };
  orders = []; events = []; bills = []; cash = []; invoices = []; writes = 0;
  licenses = [{ id: "t1", franchiseeId: "loja", active: true }, { id: "t2", franchiseeId: "loja", active: true }, { id: "fora", franchiseeId: "outra", active: true }];
}
const order = (extra: Linha = {}) => ({ id: "pedido", franchiseeId: "loja", source: "TOTEM", totemLicenseId: "t1", status: "ACEITO", paymentPaidAt: noMes, dailyOrderNumber: 1, totalAmount: 25, discountTotal: 0, createdAt: noMes, ...extra });

function loadBilling(source: string) {
  const ast = ts.createSourceFile("billing.ts", source, ts.ScriptTarget.Latest, true);
  const fns = ["cobrancaDosTotensNoMes", "atualizarTaxaDosTotensNoMes", "detectarUsoDaLoja", "offsetDoFuso", "intervaloDoMes", "inicioDaCobranca", "faturamentoBruto", "vendasAntesDaVirada", "closeBillingCycle", "getCurrentCycleView", "previsaoDoFechamento", "recalcularCiclo"];
  const vars = ["VENDAS_QUE_CONTAM", "CAMPOS_DO_BRUTO", "CAMPOS_DA_ISENCAO", "SEM_INDIQUE"];
  const pieces: string[] = [];
  for (const name of [...vars, ...fns]) {
    let found: ts.Node | undefined;
    const visit = (n: ts.Node) => {
      if (ts.isFunctionDeclaration(n) && n.name?.text === name || ts.isVariableDeclaration(n) && n.name.getText(ast) === name) found = n;
      ts.forEachChild(n, visit);
    };
    visit(ast); assert.ok(found, "função/constante real encontrada: " + name);
    pieces.push(ts.isVariableDeclaration(found!) ? `const ${found!.getText(ast)};` : found!.getText(ast).replace(/^export\s+/, ""));
  }
  const deps = {
    prisma, calcMensalidade, FIREHUB_PLAN, percentualDoMes, MES_DOS_2_POR_CENTO, VIRADA_DOS_2_POR_CENTO, fimDoTeste,
    lojaIsenta: (u: Linha) => u.planPercent === 0,
    getCurrentYearMonth: () => mes, faturasEmAbertoDaLoja: async () => [],
    previsaoDoIndiqueEGanhe: async () => ({ isenta: false, ativosPagantes: 0, saldo: 0, abate: 0 }),
    indiqueEGanheDaLoja: async () => ({ isenta: false, principal: false, saldo: 0 }), INDICADOS_PARA_ISENCAO: 10,
    aplicarCreditosNoCiclo: async () => { throw new Error("Sem crédito neste teste"); },
    lojasExtrasDeMarketplace: async () => ({ lojasIfood: 0, lojas99: 0, total: 0, linhas: [] }),
    getAsaasKey: () => null, bloqueioDaMensalidade: () => fim,
    ensureCycle: async () => { assert.ok(cycle); return cycle; },
    require: (_name: string) => new Proxy({ __esModule: true }, { get: (o: any, k) => k === "then" ? undefined : k in o ? o[k] : async () => 0 }),
    fetch: () => { throw new Error("Rede proibida no teste"); },
  };
  const js = ts.transpileModule(`function carregar(deps:any){const {${Object.keys(deps).join(",")}}=deps;${pieces.join("\n")};return {${fns.join(",")}};}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  return new Function(js + ";return carregar;")()(deps);
}

async function main() {
  const src = readFileSync("src/lib/billing.ts", "utf8");
  const b = loadBilling(src);
  setup();
  assert.equal((await b.detectarUsoDaLoja("loja", ini, fim)).usou, false, "Mano: duas licenças ativas não são uso real");
  assert.equal(await b.cobrancaDosTotensNoMes("loja", ini, fim), 0);
  const view = await b.getCurrentCycleView("loja");
  assert.equal(view.amountPending, 0, "previsão ignora mínimo/taxa antigos sem movimentação");
  assert.equal(view.taxas.totem, 0);
  assert.equal((await b.previsaoDoFechamento("loja", mes)).custo, 0);
  await b.atualizarTaxaDosTotensNoMes("loja", mes);
  assert.equal(cycle!.totemFee, 0, "cron remove taxa antiga de R$200");
  await b.recalcularCiclo("loja", mes);
  assert.equal(cycle!.amountDue, 0); assert.equal(cycle!.amountPending, 0);
  cycle!.totemFee = 200;
  const closed = await b.closeBillingCycle("loja", mes);
  assert.equal(closed.charged, false); assert.equal(cycle!.amountPending, 0); assert.equal(cycle!.totemFee, 0);

  setup(); cycle = null;
  await b.atualizarTaxaDosTotensNoMes("loja", mes);
  assert.equal(cycle, null, "não cria ciclo só porque existe licença");
  assert.equal(writes, 0);

  setup();
  orders = [order({ status: "AGUARDANDO_PAGAMENTO", paymentPaidAt: null })];
  assert.equal(await b.cobrancaDosTotensNoMes("loja", ini, fim), 0, "abandono com senha/heartbeat não é serviço faturável");
  orders = [order({ status: "CANCELADO", paymentPaidAt: null })];
  assert.equal(await b.cobrancaDosTotensNoMes("loja", ini, fim), 0, "cancelamento sem confirmação/pagamento não cria taxa");

  setup(); orders = [order(), order({ id: "repetido" }), order({ id: "outro-dono", franchiseeId: "outra" }), order({ id: "id-fora", totemLicenseId: "fora" })];
  assert.equal(await b.cobrancaDosTotensNoMes("loja", ini, fim), 100, "cobra só dispositivo usado da mesma loja, uma vez");
  licenses[0].active = false;
  assert.equal(await b.cobrancaDosTotensNoMes("loja", ini, fim), 100, "pausa posterior não apaga serviço prestado");
  orders.push(order({ id: "segundo", totemLicenseId: "t2" }));
  assert.equal(await b.cobrancaDosTotensNoMes("loja", ini, fim), 200);

  setup(); orders = [order({ createdAt: new Date(ini.getTime() - 1) }), order({ id: "fim", createdAt: fim })];
  assert.equal(await b.cobrancaDosTotensNoMes("loja", ini, fim), 0, "limites do mês são início inclusivo/fim exclusivo");
  orders = [order({ status: "CANCELADO" })];
  assert.equal(await b.cobrancaDosTotensNoMes("loja", ini, fim), 100, "pedido efetivamente pago cancelado depois mantém serviço");

  setup(); user.storeTimezone = "America/Campo_Grande";
  orders = [order({ createdAt: new Date("2026-11-01T03:30:00Z") })];
  await b.atualizarTaxaDosTotensNoMes("loja", mes);
  assert.equal(cycle!.totemFee, 0, "usa meia-noite local da loja, ainda outubro em Campo Grande");
  orders[0].createdAt = new Date("2026-11-01T04:00:00Z");
  await b.atualizarTaxaDosTotensNoMes("loja", mes);
  assert.equal(cycle!.totemFee, 100);

  for (const signal of ["ia", "robo", "financeiro", "caixa", "nota"]) {
    setup();
    if (signal === "ia") events = [{ franchiseeId: "loja", createdAt: noMes, category: "GEMINI_CHAT" }];
    if (signal === "robo") events = [{ franchiseeId: "loja", createdAt: noMes, category: "WHATSAPP_MSG", metadata: { direction: "OUTBOUND" } }];
    if (signal === "financeiro") bills = [{ franchiseeId: "loja", createdAt: noMes }];
    if (signal === "caixa") cash = [{ franchiseeId: "loja", createdAt: noMes }];
    if (signal === "nota") invoices = [{ franchiseeId: "loja", createdAt: noMes }];
    assert.equal((await b.detectarUsoDaLoja("loja", ini, fim)).usou, true, signal + " continua uso cobrável");
    const result = await b.closeBillingCycle("loja", mes);
    assert.equal(result.amountPending, 100, "mínimo de " + signal + " preservado, sem taxa de totem não usado");
  }
  setup(); cycle!.metaAdsFee = 50;
  assert.equal((await b.closeBillingCycle("loja", mes)).amountPending, 150, "campanha real mantém mínimo + serviço");

  setup(); user.trialEndsAt = new Date("2026-11-06T03:00:00Z");
  events = [{ franchiseeId: "loja", createdAt: noMes, category: "GEMINI_CHAT" }];
  assert.equal((await b.closeBillingCycle("loja", mes)).amountPending, 0, "uso de IA durante teste não gera mínimo");

  setup(); user.trialEndsAt = fim; orders = [order()];
  assert.equal((await b.closeBillingCycle("loja", mes)).amountPending, 100, "teste isenta plataforma, não serviço real de totem já prestado");
  assert.equal(cycle!.amountDue, 0);
  setup(); cycle!.status = "FORGIVEN"; orders = [order()]; const before = structuredClone(cycle);
  await b.atualizarTaxaDosTotensNoMes("loja", mes); await b.closeBillingCycle("loja", mes);
  assert.deepEqual(cycle, before, "cron/fechamento preservam dispensa administrativa");

  // Executa também o handler real do cron: autenticação preservada e a volta
  // inteira não repõe os R$200 que veio limpar no caso sem movimentação.
  const cronSource = readFileSync("src/app/api/cron/billing-close/route.ts", "utf8");
  const cronAst = ts.createSourceFile("cron.ts", cronSource, ts.ScriptTarget.Latest, true);
  const get = cronAst.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "GET")!;
  const cronDeps = {
    prisma, verifyCronAuth: (r: any) => r.authorized === true, pegarVez: async () => true,
    NextResponse: { json: (body: any, init?: any) => ({ body, status: init?.status || 200 }) },
    getCurrentYearMonth: (offset = 0) => offset < 0 ? "2026-10" : mes,
    garantirCiclosDoMes: async () => ({ lojasComVenda: 0, criados: 0, atualizados: 0, jaFechados: 0, erros: [] }),
    atualizarTaxaDosTotensNoMes: b.atualizarTaxaDosTotensNoMes, closeBillingCycle: b.closeBillingCycle,
  };
  const cronJs = ts.transpileModule(`function carregar(deps:any){const {${Object.keys(cronDeps).join(",")}}=deps;${get.getText(cronAst).replace(/^export\s+/, "")};return GET;}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const cron = new Function(cronJs + ";return carregar;")()(cronDeps);
  setup();
  assert.equal((await cron({ authorized: false })).status, 401); assert.equal(writes, 0);
  assert.equal((await cron({ authorized: true })).status, 200);
  assert.equal(cycle!.totemFee, 0, "cron real limpa a taxa antiga e não a recoloca por licença ativa");
  console.log("OK: Mano sem movimento=0; fechamento, previsão e cron reais; dispositivo usado, tenant, abandono, teste e outros usos preservados.");
}
main().catch(e => { console.error(e); process.exitCode = 1; });
