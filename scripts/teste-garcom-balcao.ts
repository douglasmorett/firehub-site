/**
 * PEDIDO DE BALCÃO PELO LINK DO GARÇOM (api/garcom/balcao).
 *
 *   npx tsx scripts/teste-garcom-balcao.ts
 *
 * Delicias de Casa (Allan), decidido pelo Douglas em 17/10/2026: "na opção do
 * garçom ter a opção de liberar fazer pedido como balcão ao invés de mesa,
 * mas fica desabilitado de cara, com o dono podendo habilitar".
 *
 * Sem banco: a rota roda de verdade contra um Prisma em memória (o mesmo
 * jeito de scripts/teste-motivo-do-cancelamento.ts). A sessão do garçom passa
 * pelo autenticarGarcom VERDADEIRO — só o cookie e o JWE são falsos —, então
 * o que se confere é a leitura do banco a cada pedido:
 *
 *   1. Desligado (o padrão, e a linha antiga sem a coluna): 403, nada gravado.
 *   2. Ligado: o pedido entra como o balcão do PDV (PRESENCIAL, RETIRADA,
 *      ACEITO), com o preço do SALÃO calculado no servidor, e o corpo não
 *      consegue trocar preço, tipo, desconto nem conta de funcionário.
 *   3. As travas do balcão valem para o garçom: forma de pagamento, produto
 *      de outra loja, caixa fechado, pager obrigatório, loja bloqueada.
 *   4. O dono desmarca com a tela do garçom aberta: o próximo pedido cai.
 *   5. O PDV do painel (api/store/orders/presencial) segue igual depois de a
 *      regra ter saído para lib/venda-presencial.ts.
 */
let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

Object.assign(process.env, { NODE_ENV: "development", NEXTAUTH_SECRET: "segredo-de-teste" });
process.env.DATABASE_URL ||= "postgresql://banco-falso/teste";

// ── Banco em memória ─────────────────────────────────────────────────────────
type Linha = Record<string, any>;
const db: { user: Linha[]; waiter: Linha[]; menuProduct: Linha[]; customerOrder: Linha[]; cashSession: Linha[] } = {
  user: [], waiter: [], menuProduct: [], customerOrder: [], cashSession: [],
};
const copia = <T,>(v: T): T => (v == null ? v : structuredClone(v));
/** Só o que estas rotas usam: igualdade, `in`, e o NOT/AND do filtro de integração (ignorado). */
function casa(linha: Linha, where: any): boolean {
  if (!where) return true;
  for (const [k, v] of Object.entries(where)) {
    if (k === "NOT" || k === "AND" || k === "OR") continue;
    if (v && typeof v === "object" && !Array.isArray(v) && "in" in (v as any)) {
      if (!(v as any).in.includes(linha[k])) return false;
    } else if (linha[k] !== v) return false;
  }
  return true;
}
function projetar(linha: Linha, select?: Record<string, any>): Linha {
  if (!select) return copia(linha);
  const saida: Linha = {};
  for (const [k, v] of Object.entries(select)) {
    if (!v) continue;
    if (k === "franchisee") {
      const loja = db.user.find((u) => u.id === linha.franchiseeId);
      saida[k] = loja ? projetar(loja, (v as any).select) : null;
    } else saida[k] = copia(linha[k]) ?? null;
  }
  return saida;
}
const delegado = (modelo: keyof typeof db) => ({
  findUnique: async (a: any) => { const l = db[modelo].find((x) => casa(x, a.where)); return l ? projetar(l, a.select) : null; },
  findFirst: async (a: any) => { const l = db[modelo].find((x) => casa(x, a.where)); return l ? projetar(l, a.select) : null; },
  findMany: async (a: any = {}) => db[modelo].filter((x) => casa(x, a.where)).map((l) => (a.include ? copia(l) : projetar(l, a.select))),
  update: async (a: any) => { const l = db[modelo].find((x) => casa(x, a.where)); if (!l) throw new Error(`update ${modelo}`); Object.assign(l, copia(a.data)); return projetar(l, a.select); },
});
let proximoPedido = 1;
(globalThis as any).prisma = {
  user: delegado("user"),
  waiter: delegado("waiter"),
  menuProduct: delegado("menuProduct"),
  cashSession: delegado("cashSession"),
  customerOrder: {
    ...delegado("customerOrder"),
    create: async ({ data }: any) => {
      const { items, ...resto } = data;
      const pedido = { id: `ped${proximoPedido++}`, ...copia(resto), items: copia(items?.create || []) };
      db.customerOrder.push(pedido);
      return copia(pedido);
    },
  },
};

// ── Módulos de fora do teste ─────────────────────────────────────────────────
const stub = (caminho: string, exports: Record<string, unknown>) => {
  const arquivo = require.resolve(caminho);
  require.cache[arquivo] = { id: arquivo, filename: arquivo, loaded: true, exports: { __esModule: true, ...exports } } as any;
};
// O cookie do garçom: presente ou não. O JWE é trocado por um token já lido.
let tokenDoGarcom: { tipo: string; gid: string; lid: string; iat: number } | null = null;
stub("next/headers", {
  cookies: async () => ({ get: () => (tokenDoGarcom ? { value: "cookie" } : undefined) }),
  headers: async () => new Headers(),
});
stub("next-auth/jwt", { decode: async () => tokenDoGarcom, encode: async () => "cookie" });
// A sessão do PAINEL (só a rota do PDV usa).
let sessaoDoPainel: { user: { email: string; role?: string } } | null = null;
stub("next-auth", { getServerSession: async () => sessaoDoPainel });
stub("next-auth/next", { getServerSession: async () => sessaoDoPainel });
stub("../src/lib/auth", { authOptions: {} });
let lojaBloqueada = false;
stub("../src/lib/loja-bloqueada", {
  lojaBloqueadaPorMensalidade: async () => lojaBloqueada,
  MENSAGEM_CONTA_BLOQUEADA: "Conta bloqueada pela mensalidade.",
  MENSAGEM_LOJA_INDISPONIVEL: "Loja indisponível.",
});
stub("../src/lib/fuso-da-loja", { fusoDaLoja: async () => "America/Sao_Paulo" });
let numeroDoDia = 40;
stub("../src/lib/order-number", { generateDailyOrderNumber: async () => ++numeroDoDia });
stub("../src/lib/estoque-restante", { conferirEstoque: async () => ({ ok: true }) });
stub("../src/lib/stock", { deductStockForOrder: async () => {}, restoreStockForOrder: async () => {} });
const impressos: string[] = [];
stub("../src/app/api/store/print-queue/route", { pushJobToPrintQueue: (_loja: string, pedido: any) => { impressos.push(pedido.id); } });
stub("../src/lib/order-notifications", { sendOrderNotification: async () => {} });

// ── A loja ───────────────────────────────────────────────────────────────────
const LOJA = "delicias";
function montarLoja() {
  db.user.length = 0; db.waiter.length = 0; db.menuProduct.length = 0; db.customerOrder.length = 0; db.cashSession.length = 0;
  impressos.length = 0;
  db.user.push({ id: LOJA, email: "allan@delicias.teste", ownerId: null, role: "FRANCHISEE", cashClosedAt: null, balcaoConfig: null, fiscalConfig: null });
  db.user.push({ id: "outra", email: "dono@outra.teste", ownerId: null, role: "FRANCHISEE", cashClosedAt: null });
  db.cashSession.push({ id: "cx1", franchiseeId: LOJA, status: "OPEN" });
  db.menuProduct.push({ id: "coxinha", franchiseeId: LOJA, name: "Coxinha", price: 8.9, active: true, activeGarcom: true, comboGroups: [] });
  db.menuProduct.push({ id: "suco", franchiseeId: LOJA, name: "Suco de laranja", price: 9.9, active: true, activeGarcom: true, comboGroups: [] });
  db.menuProduct.push({ id: "alheio", franchiseeId: "outra", name: "Pizza da outra loja", price: 59.9, active: true, activeGarcom: true, comboGroups: [] });
  // Três garçons: o que nasceu depois da coluna (false), o liberado, e a
  // linha antiga, de antes da coluna existir (nulo).
  const base = { franchiseeId: LOJA, active: true, login: "x", credentialsUpdatedAt: null, commissionRate: 10,
    podeFecharConta: true, podeDarDesconto: true, podeLiberarMesa: true, podeTirarTaxa: true, podeRemoverItem: true };
  db.waiter.push({ ...base, id: "w-novo", name: "Bia", login: "bia", podeFazerBalcao: false });
  db.waiter.push({ ...base, id: "w-liberado", name: "João", login: "joao", podeFazerBalcao: true });
  db.waiter.push({ ...base, id: "w-antigo", name: "Rui", login: "rui", podeFazerBalcao: null });
}
const comoGarcom = (id: string) => { tokenDoGarcom = { tipo: "garcom", gid: id, lid: LOJA, iat: Math.floor(Date.now() / 1000) }; };

const PEDIDO = {
  customerName: "Juliana",
  paymentMethod: "PIX",
  items: [
    { menuProductId: "coxinha", quantity: 2, price: 0.01 },
    { menuProductId: "suco", quantity: 1, price: 9.9, notes: "sem gelo" },
  ],
};

async function main() {
  const { POST } = await import("../src/app/api/garcom/balcao/route");
  const enviar = async (corpo: unknown) => {
    const r = await POST(new Request("http://t/api/garcom/balcao", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) }));
    return { status: r.status, json: await r.json() };
  };

  // ── 1. Desligado ───────────────────────────────────────────────────────────
  console.log("\n— 1. Nasce desligado: a rota recusa —");
  montarLoja();
  tokenDoGarcom = null;
  let r = await enviar(PEDIDO);
  confere("sem login de garçom: 401", r.status, 401);
  comoGarcom("w-novo");
  r = await enviar(PEDIDO);
  confere("garçom com a caixinha desmarcada: 403", r.status, 403);
  confere("…com o código que a tela entende", r.json.codigo, "BALCAO_NAO_LIBERADO");
  comoGarcom("w-antigo");
  r = await enviar(PEDIDO);
  confere("linha antiga, sem a coluna (nulo): também 403", r.status, 403);
  confere("nenhum pedido gravado, nada na impressora", [db.customerOrder.length, impressos.length], [0, 0]);

  // ── 2. Ligado ──────────────────────────────────────────────────────────────
  console.log("\n— 2. Ligado: entra como o balcão do PDV —");
  comoGarcom("w-liberado");
  r = await enviar({
    ...PEDIDO,
    // O que o garçom NÃO pode mandar, e a rota tem de ignorar:
    deliveryType: "DELIVERY", totalAmount: 1, discountTotal: 30, employeeId: "e1", employeeName: "Fulano",
    paymentMethods: [{ method: "PIX", amount: 1 }], deliveryFee: 15, tableSessionId: "s1",
  });
  confere("200", r.status, 200);
  confere("devolve o número do pedido do dia (o garçom diz ao cliente)", r.json.dailyOrderNumber, 41);
  const p = db.customerOrder[0] || {};
  confere("canal do balcão do PDV: PRESENCIAL · RETIRADA · ACEITO", [p.source, p.deliveryType, p.status], ["PRESENCIAL", "RETIRADA", "ACEITO"]);
  confere("da loja do garçom", p.franchiseeId, LOJA);
  confere("preço do SALÃO no servidor, não o R$ 0,01 do corpo", p.items?.map((i: any) => [i.menuProductId, i.quantity, i.price]), [["coxinha", 2, 8.9], ["suco", 1, 9.9]]);
  confere("total = soma dos preços do servidor (27,70), não o do corpo", p.totalAmount, 27.7);
  confere("forma de pagamento escolhida, sem divisão", [p.paymentMethod, p.paymentMethods ?? null], ["PIX", null]);
  confere("sem desconto, sem conta de funcionário, sem taxa", [p.discountTotal ?? null, p.employeeId, p.employeeName, p.deliveryFee], [null, null, null, 0]);
  confere("nem mesa", p.tableSessionId ?? null, null);
  confere("nome do cliente e observação do item", [p.customerName, p.items?.[1]?.notes], ["Juliana", "sem gelo"]);
  confere("o nome do garçom vai na observação (sai na comanda)", /Garçom: João/.test(p.notes || ""), true);
  confere("foi para a fila de impressão", impressos, [p.id]);

  r = await enviar({ paymentMethod: "Dinheiro", items: [{ menuProductId: "suco", quantity: 1 }] });
  confere("sem nome: grava \"Balcão\", como o PDV", [r.status, db.customerOrder[1]?.customerName], [200, "Balcão"]);

  // ── 3. As travas do balcão ─────────────────────────────────────────────────
  console.log("\n— 3. As travas do balcão valem para o garçom —");
  const antes = db.customerOrder.length;
  r = await enviar({ ...PEDIDO, paymentMethod: "" });
  confere("sem forma de pagamento: 400", r.status, 400);
  r = await enviar({ ...PEDIDO, paymentMethod: "Conta Funcionário" });
  confere("\"Conta Funcionário\" não é do garçom: 400", r.status, 400);
  r = await enviar({ ...PEDIDO, items: [] });
  confere("sem item: 400", r.status, 400);
  r = await enviar({ ...PEDIDO, items: [{ menuProductId: "alheio", quantity: 1 }] });
  confere("produto de outra loja: 400", r.status, 400);
  confere("…dizendo que não está no cardápio do balcão", /cardápio do balcão/.test(r.json.error || ""), true);
  db.cashSession[0].status = "CLOSED";
  r = await enviar(PEDIDO);
  confere("caixa fechado: 409 (a mesma trava do PDV)", [r.status, r.json.codigo], [409, "caixa_fechado"]);
  db.cashSession[0].status = "OPEN";
  db.user[0].balcaoConfig = { pagerObrigatorioBalcao: true };
  r = await enviar(PEDIDO);
  confere("loja com pager obrigatório no balcão, sem pager: 400", r.status, 400);
  r = await enviar({ ...PEDIDO, pagerNumber: "12" });
  confere("…com o pager: 200 e o pager no campo próprio", [r.status, db.customerOrder.at(-1)?.pagerNumber], [200, "12"]);
  db.user[0].balcaoConfig = null;
  lojaBloqueada = true;
  r = await enviar(PEDIDO);
  confere("loja bloqueada pela mensalidade: 403 (garçom não passa)", r.status, 403);
  lojaBloqueada = false;
  confere("nenhuma recusa gravou pedido", db.customerOrder.length, antes + 1);

  // ── 4. O dono desmarca com a tela aberta ───────────────────────────────────
  console.log("\n— 4. Desmarcou: o próximo pedido daquele celular cai —");
  db.waiter.find((w) => w.id === "w-liberado")!.podeFazerBalcao = false;
  r = await enviar(PEDIDO);
  confere("mesmo cookie, caixinha desmarcada: 403", r.status, 403);
  db.waiter.find((w) => w.id === "w-liberado")!.active = false;
  r = await enviar(PEDIDO);
  confere("garçom desativado: 403 do login, antes de tudo", [r.status, r.json.codigo], [403, "GARCOM_DESATIVADO"]);

  // ── 5. O PDV do painel continua igual ──────────────────────────────────────
  console.log("\n— 5. PDV do painel (api/store/orders/presencial) depois da mudança —");
  montarLoja();
  tokenDoGarcom = null;
  const pdv = await import("../src/app/api/store/orders/presencial/route");
  const vender = async (corpo: unknown) => {
    const resp = await pdv.POST(new Request("http://t/api/store/orders/presencial", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) }));
    return { status: resp.status, json: await resp.json() };
  };
  sessaoDoPainel = null;
  r = await vender({ items: [{ menuProductId: "coxinha", quantity: 1, price: 8.9 }] });
  confere("sem sessão do painel: 401", r.status, 401);
  sessaoDoPainel = { user: { email: "allan@delicias.teste" } };
  r = await vender({
    customerName: "Balcão", deliveryType: "RETIRADA", paymentMethod: "Dinheiro", totalAmount: 7.9,
    discountTotal: 1, items: [{ menuProductId: "coxinha", quantity: 1, price: 8.9 }],
  });
  confere("venda do PDV: 200", r.status, 200);
  const v = db.customerOrder[0] || {};
  confere("grava como antes: PRESENCIAL · RETIRADA · total e desconto do atendente", [v.source, v.deliveryType, v.totalAmount, v.discountTotal], ["PRESENCIAL", "RETIRADA", 7.9, 1]);
  r = await vender({ paymentMethod: "Dinheiro", items: [{ menuProductId: "alheio", quantity: 1, price: 59.9 }] });
  confere("PDV: produto de outra loja continua recusado", r.status, 400);
  db.cashSession[0].status = "CLOSED";
  r = await vender({ paymentMethod: "Dinheiro", items: [{ menuProductId: "coxinha", quantity: 1, price: 8.9 }] });
  confere("PDV: caixa fechado continua 409", r.status, 409);
  db.cashSession[0].status = "OPEN";
  lojaBloqueada = true;
  r = await vender({ paymentMethod: "Dinheiro", items: [{ menuProductId: "coxinha", quantity: 1, price: 8.9 }] });
  confere("PDV: loja bloqueada continua 403", r.status, 403);
  sessaoDoPainel = { user: { email: "allan@delicias.teste", role: "ADMIN" } };
  r = await vender({ paymentMethod: "Dinheiro", items: [{ menuProductId: "coxinha", quantity: 1, price: 8.9 }] });
  confere("PDV: ADMIN dentro da loja passa pelo bloqueio, como antes", r.status, 200);
  lojaBloqueada = false;

  console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ Tudo certo");
  process.exit(falhas ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
