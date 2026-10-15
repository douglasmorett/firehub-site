/**
 * scripts/teste-stone-connect.ts — Stone pela nuvem (Connect 2.0), sem banco e sem rede.
 *
 *   npx tsx scripts/teste-stone-connect.ts
 *
 * Banco em memória (o jeito de scripts/teste-keeta-fluxo.ts) e uma Stone/Pagar.me
 * FALSA no `fetch`, com duas contas (loja A e loja B), que recusa chamada sem o
 * Basic da secret key certa e sem o ServiceRefererName — como a de verdade.
 *
 *   - corpo do pedido (listado x direto, serial, valor em centavos, referência);
 *   - start do totem acende na Stone e NÃO carimba gatewayProvider;
 *   - webhook forjado antes de pagar não paga nada (corpo nunca é prova);
 *   - pagamento na POS + webhook → reconsulta → confirmOrderPayment uma vez só,
 *     e o pedido é FECHADO na Stone como "paid" (docs: obrigatório);
 *   - isolamento: referência de pedido da loja B com id de pedido da conta A
 *     não paga ninguém (a chave da B não enxerga o pedido da A);
 *   - cancelamento fecha como "canceled"; cartão aprovado no meio vira JA_PAGO;
 *   - recusa + "tentar de novo" derruba o pedido velho e manda outro;
 *   - cobrança abandonada há 20 min é derrubada pelo payment-status;
 *   - mesa: cobrança Stone com code "mesa:<id>" → pagamento → baixa na mesa;
 *   - nada disso pergunta ao Mercado Pago.
 */
export {}; // módulo: sem isto o `main` colide com o de outros scripts no tsc

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : `\n   esperado: ${JSON.stringify(esperado)}\n   obtido:   ${JSON.stringify(obtido)}`}`);
};

Object.assign(process.env, {
  STONE_CONNECT_SERVICE_REFERER_NAME: "parceiro-firehub-teste",
  NEXTAUTH_SECRET: "segredo-de-teste-do-cofre",
  NODE_ENV: "development",
});
delete process.env.COFRE_CHAVE;
delete process.env.STONE_CONNECT_WEBHOOK_TOKEN;
process.env.DATABASE_URL = "postgresql://banco-falso/teste";

// ── Banco em memória ─────────────────────────────────────────────────────────
type Linha = Record<string, any>;
const db: Record<string, Linha[]> = {
  user: [], customerOrder: [], posTerminal: [], totemLicense: [], cashSession: [], tableSession: [], tableGuest: [],
};
const cobrancasMesa: Linha[] = [];
const lojasStone: Linha[] = [];

const casaValor = (v: any, alvo: any): boolean => {
  if (alvo && typeof alvo === "object" && !(alvo instanceof Date)) {
    if ("in" in alvo) return alvo.in.includes(v);
    if ("startsWith" in alvo) return String(v ?? "").startsWith(alvo.startsWith);
    if ("gte" in alvo) return v instanceof Date && v >= alvo.gte;
    if ("increment" in alvo) return true;
  }
  return (v ?? null) === (alvo ?? null);
};
const casa = (l: Linha, where: any): boolean => !where || Object.entries(where).every(([k, v]) => casaValor(l[k], v));
const aplicar = (l: Linha, data: any) => {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === "object" && "increment" in (v as any)) l[k] = (l[k] || 0) + (v as any).increment;
    else if (v && typeof v === "object" && "decrement" in (v as any)) l[k] = (l[k] || 0) - (v as any).decrement;
    else l[k] = v;
  }
};
const pega = (tabela: string, l: Linha | undefined, select?: any) => {
  if (!l) return null;
  if (!select) return l;
  const out: Linha = {};
  for (const k of Object.keys(select)) {
    if (tabela === "totemLicense" && k === "posTerminal") {
      const t = db.posTerminal.find((x) => x.id === l.posTerminalId);
      out.posTerminal = t ? pega("posTerminal", t, select.posTerminal.select) : null;
    } else out[k] = l[k];
  }
  return out;
};
let seq = 1;
const delegado = (tabela: string) => ({
  findFirst: async ({ where, select }: any) => pega(tabela, db[tabela].find((l) => casa(l, where)), select),
  findUnique: async ({ where, select }: any) => {
    const w = where.franchiseeId_externalId ?? where;
    return pega(tabela, db[tabela].find((l) => casa(l, w)), select);
  },
  findMany: async ({ where, select, take }: any) =>
    db[tabela].filter((l) => casa(l, where)).slice(0, take ?? 1e9).map((l) => pega(tabela, l, select)),
  update: async ({ where, data, select }: any) => {
    const l = db[tabela].find((x) => casa(x, where));
    if (!l) throw new Error(`update sem linha em ${tabela}`);
    aplicar(l, data);
    return pega(tabela, l, select);
  },
  updateMany: async ({ where, data }: any) => {
    const ls = db[tabela].filter((x) => casa(x, where));
    ls.forEach((l) => aplicar(l, data));
    return { count: ls.length };
  },
  create: async ({ data, select }: any) => {
    const l = { id: `${tabela}${seq++}`, ...data };
    db[tabela].push(l);
    return pega(tabela, l, select);
  },
});

// SQL cru: só as instruções que as tabelas criadas no 1º uso usam.
const sql = (q: string) => q.replace(/\s+/g, " ").trim();
async function executar(qCru: string, ...p: any[]): Promise<number> {
  const q = sql(qCru);
  if (/^CREATE (TABLE|INDEX|UNIQUE INDEX)/.test(q)) return 0;
  if (q.startsWith(`INSERT INTO "StoneConnectLoja"`)) {
    const linha = { franchiseeId: p[0], chaveCifrada: p[1], finalDaChave: p[2], fluxo: p[3], tipoDireto: p[4], conectadaPor: p[5], conectadaEm: new Date() };
    const i = lojasStone.findIndex((l) => l.franchiseeId === p[0]);
    if (i >= 0) lojasStone[i] = linha; else lojasStone.push(linha);
    return 1;
  }
  if (q.startsWith(`INSERT INTO "CobrancaDaMesaNaMaquininha"`)) {
    cobrancasMesa.push({
      id: p[0], franchiseeId: p[1], tableSessionId: p[2], valorCentavos: p[3], status: p[4], terminalId: p[5], provedor: p[6],
      guestId: p[7], guestName: p[8], criadoPor: p[9], dados: JSON.parse(p[10]), tentativas: 0, mpOrderId: null, pagamentoUid: null,
      criadaEm: new Date(), atualizadaEm: new Date(),
    });
    return 1;
  }
  if (q.startsWith(`UPDATE "CobrancaDaMesaNaMaquininha"`)) {
    const c = cobrancasMesa.find((x) => x.id === p[0]);
    if (!c) return 0;
    if (q.includes(`SET "mpOrderId" = $2`)) {
      if (q.includes(`"mpOrderId" IS NULL`) && c.mpOrderId) return 0;
      c.mpOrderId = p[1];
    } else if (q.includes(`SET "status" = $2, "pagamentoUid" = $3`)) {
      c.status = p[1]; c.pagamentoUid = p[2]; c.dados = { ...c.dados, ...JSON.parse(p[3]) };
    } else if (q.includes(`SET "status" = $2, "dados"`)) {
      c.status = p[1]; c.dados = { ...c.dados, ...JSON.parse(p[2]) };
    } else if (!q.includes(`SET "atualizadaEm" = now() WHERE`)) {
      throw new Error(`UPDATE de mesa não emulado: ${q}`);
    }
    c.atualizadaEm = new Date();
    return 1;
  }
  throw new Error(`SQL não emulado: ${q}`);
}
async function consultar(qCru: string, ...p: any[]): Promise<any[]> {
  const q = sql(qCru);
  // TEF no totem (lib/tef-do-totem.ts): nenhuma licença deste teste tem TEF.
  if (q.startsWith(`SELECT * FROM "TefDoTotem"`)) return [];
  if (q.startsWith(`SELECT * FROM "StoneConnectLoja" WHERE "franchiseeId" = $1`)) return lojasStone.filter((l) => l.franchiseeId === p[0]);
  if (q.startsWith(`SELECT * FROM "CobrancaDaMesaNaMaquininha" WHERE "mpOrderId" = $1 AND "provedor" = $2`))
    return cobrancasMesa.filter((c) => c.mpOrderId === p[0] && c.provedor === p[1]);
  if (q.startsWith(`SELECT * FROM "CobrancaDaMesaNaMaquininha" WHERE "id" = $1 AND "provedor" = $2`))
    return cobrancasMesa.filter((c) => c.id === p[0] && c.provedor === p[1]);
  if (q.startsWith(`SELECT * FROM "CobrancaDaMesaNaMaquininha" WHERE "id" = $1`)) return cobrancasMesa.filter((c) => c.id === p[0]);
  if (q.startsWith(`SELECT "id" FROM "CobrancaDaMesaNaMaquininha" WHERE "tableSessionId" = $1`))
    return cobrancasMesa.filter((c) => c.tableSessionId === p[0] && [p[1], p[2]].includes(c.status));
  if (q.startsWith(`SELECT "paymentMethods", "status" FROM "TableSession"`))
    return db.tableSession.filter((t) => t.id === p[0]).map((t) => ({ paymentMethods: t.paymentMethods, status: t.status }));
  throw new Error(`SELECT não emulado: ${q}`);
}

const prismaFalso: any = {};
for (const t of Object.keys(db)) prismaFalso[t] = delegado(t);
prismaFalso.tableSession.findUnique = async ({ where }: any) => {
  const s = db.tableSession.find((x) => x.id === where.id);
  if (!s) return null;
  return { ...s, table: s.table, orders: s.orders };
};
prismaFalso.$executeRawUnsafe = executar;
prismaFalso.$queryRawUnsafe = consultar;
prismaFalso.$transaction = async (fn: any) => fn(prismaFalso);
(globalThis as any).prisma = prismaFalso;

// ── O que fica fora do teste ─────────────────────────────────────────────────
const stub = (caminho: string, exports: Record<string, unknown>) => {
  const arquivo = require.resolve(caminho);
  require.cache[arquivo] = { id: arquivo, filename: arquivo, loaded: true, exports: { __esModule: true, ...exports } } as any;
};
const confirmados: string[] = [];
stub("../src/lib/order-payment-confirm", {
  confirmOrderPayment: async (id: string) => {
    confirmados.push(id);
    const p = db.customerOrder.find((o) => o.id === id);
    if (p && !p.paymentPaidAt) p.paymentPaidAt = new Date();
    return p;
  },
});
stub("../src/lib/totem-auth", {
  autenticarTotem: async (token: string) => {
    const l = db.totemLicense.find((x) => x.token === token);
    return l ? { ok: true, licenca: { id: l.id, franchiseeId: l.franchiseeId } } : { ok: false, status: 401, erro: "token", codigo: "X" };
  },
});

// ── Stone/Pagar.me falsa ─────────────────────────────────────────────────────
const BASE = "https://api.pagar.me/core/v5";
const CHAVE_A = "sk_contaA1234567890abcd";
const CHAVE_B = "sk_contaB0987654321wxyz";
const contaDaChave: Record<string, string> = { [CHAVE_A]: "A", [CHAVE_B]: "B" };
type Chamada = { metodo: string; caminho: string; corpo: any; conta: string | null; refererOk: boolean };
const chamadas: Chamada[] = [];
const hostsTocados: string[] = [];
const pedidosStone: Record<string, Linha> = {};
let seqStone = 1;

(globalThis as any).fetch = async (url: string, init: any = {}) => {
  const u = new URL(String(url));
  hostsTocados.push(u.host);
  const resposta = (status: number, json?: unknown) => new Response(json === undefined ? null : JSON.stringify(json), { status });
  if (!String(url).startsWith(BASE)) return resposta(500, { message: `host inesperado ${u.host}` });
  const caminho = u.pathname.replace("/core/v5", "");
  const auth = String(init.headers?.Authorization || "");
  const chave = auth.startsWith("Basic ") ? Buffer.from(auth.slice(6), "base64").toString().replace(/:$/, "") : "";
  const conta = contaDaChave[chave] ?? null;
  const refererOk = init.headers?.ServiceRefererName === "parceiro-firehub-teste";
  const corpo = init.body ? JSON.parse(init.body) : undefined;
  chamadas.push({ metodo: init.method || "GET", caminho, corpo, conta, refererOk });
  if (!conta) return resposta(401, { message: "Authorization has been denied for this request." });
  if (!refererOk) return resposta(400, { message: "ServiceRefererName obrigatório" });

  if (init.method === "POST" && caminho === "/orders") {
    const id = `or_teste${seqStone++}`;
    pedidosStone[id] = {
      id, conta, code: corpo.code, metadata: corpo.metadata, amount: corpo.items.reduce((s: number, i: any) => s + i.amount * i.quantity, 0),
      closed: false, status: "pending", charges: [], created_at: new Date().toISOString(), poi_payment_settings: corpo.poi_payment_settings,
    };
    return resposta(200, pedidosStone[id]);
  }
  const m = caminho.match(/^\/orders\/([^/]+)(\/closed)?$/);
  if (m) {
    const p = pedidosStone[m[1]];
    if (!p || p.conta !== conta) return resposta(404, { message: "Order not found" });
    if (m[2] && init.method === "PATCH") {
      p.closed = true;
      p.status = corpo?.status || "paid";
      return resposta(200, p);
    }
    return resposta(200, p);
  }
  if (caminho === "/orders" && (init.method || "GET") === "GET") return resposta(200, { data: [] });
  return resposta(404, { message: "rota" });
};

const pagarNaPos = (id: string, funding = "Debit") => {
  const p = pedidosStone[id];
  p.charges.push({
    id: `ch_${id}`, code: "NSU123", amount: p.amount, paid_amount: p.amount, status: "paid", payment_method: "cash",
    metadata: { scheme_name: "Visa", account_funding_source: funding, authorization_code: "AUT9", terminal_serial_number: "6C582505" },
  });
  p.status = "paid";
};
const recusarNaPos = (id: string) => {
  pedidosStone[id].charges.push({ id: `chf_${id}`, status: "failed", amount: pedidosStone[id].amount, paid_amount: 0, metadata: {} });
};

// ── Cenário ──────────────────────────────────────────────────────────────────
db.user.push({ id: "lojaA", storeName: "Loja A", mpAccessToken: null }, { id: "lojaB", storeName: "Loja B", mpAccessToken: null });
db.cashSession.push({ id: "cx1", franchiseeId: "lojaA", status: "OPEN" }, { id: "cx2", franchiseeId: "lojaB", status: "OPEN" });
db.posTerminal.push(
  { id: "tA", franchiseeId: "lojaA", provider: "STONE_CONNECT", externalId: "6C582505", label: "Stone do totem", active: true, operatingMode: null, lastSeenAt: null },
  { id: "tB", franchiseeId: "lojaB", provider: "STONE_CONNECT", externalId: "6M000001", label: "Stone B", active: true, operatingMode: null, lastSeenAt: null },
);
db.totemLicense.push(
  { id: "licA", franchiseeId: "lojaA", token: "totem-a", posTerminalId: "tA" },
  { id: "licB", franchiseeId: "lojaB", token: "totem-b", posTerminalId: "tB" },
);
const novoPedido = (id: string, loja: string, total: number, numero: number) =>
  db.customerOrder.push({
    id, franchiseeId: loja, totalAmount: total, status: "AGUARDANDO_PAGAMENTO", dailyOrderNumber: numero, paymentPaidAt: null,
    posOrderId: null, posTerminalId: null, posStatus: null, posTentativas: 0, gatewayProvider: null, pagarmeStatus: null, updatedAt: new Date(),
  });
const pedido = (id: string) => db.customerOrder.find((o) => o.id === id)!;

async function main() {
  const { NextRequest } = await import("next/server");
  const stone = await import("../src/lib/stone-connect");
  const lojaLib = await import("../src/lib/stone-connect-loja");
  const { POST: start } = await import("../src/app/api/totem/payment/start/route");
  const { POST: cancelar } = await import("../src/app/api/totem/payment/cancel/route");
  const { GET: status } = await import("../src/app/api/totem/payment-status/route");
  const { POST: webhook } = await import("../src/app/api/webhooks/stone-connect/route");
  const mesa = await import("../src/lib/cobranca-da-mesa-na-maquininha");

  const post = (fn: any, corpo: unknown, url = "http://local/x") =>
    fn(new NextRequest(url, { method: "POST", body: JSON.stringify(corpo), headers: { "content-type": "application/json" } })).then(
      async (r: Response) => ({ status: r.status, corpo: await r.json() }),
    );
  const evento = (tipo: string, orderId: string, code?: string) => ({
    id: "hook_x", type: tipo, account: { id: "acc_x" },
    data: { id: `ch_${orderId}`, status: "paid", order: { id: orderId, code: code ?? "qualquer" } },
  });
  const consultaStatus = async (token: string, orderId: string) => {
    const r = await status(new NextRequest(`http://local/s?token=${token}&orderId=${orderId}`));
    return r.json();
  };

  // 1) Corpo do pedido
  const listado = stone.montarCorpoDoPedido({ serial: "6C582505", referencia: "ped1", valorEmCentavos: 4590, descricao: "Pedido 7", nomeNaTela: "Totem - Pedido 7" });
  confere("listado: sem payment_setup", listado.poi_payment_settings.payment_setup, undefined);
  confere("listado: serial, aberto, valor em centavos, referência", [listado.poi_payment_settings.devices_serial_number, listado.closed, listado.items[0].amount, listado.code, listado.metadata.firehub_ref], [["6C582505"], false, 4590, "ped1", "ped1"]);
  const direto = stone.montarCorpoDoPedido({ serial: "X1", referencia: "r", valorEmCentavos: 100, descricao: "d", nomeNaTela: "n", tipo: "debit" });
  confere("direto: payment_setup débito à vista", direto.poi_payment_settings.payment_setup, { type: "debit", installments: 1, installment_type: "merchant" });

  // 2) Chave cifrada no cofre
  await lojaLib.gravarChaveStone({ franchiseeId: "lojaA", chave: CHAVE_A, fluxo: "LISTADO", tipoDireto: "credit", por: "teste" });
  await lojaLib.gravarChaveStone({ franchiseeId: "lojaB", chave: CHAVE_B, fluxo: "DIRETO", tipoDireto: "debit", por: "teste" });
  confere("chave não fica em texto puro no banco", lojasStone.some((l) => String(l.chaveCifrada).includes("sk_")), false);
  confere("credencial abre a chave certa por loja", [(await lojaLib.credencialStone("lojaA"))?.chave, (await lojaLib.credencialStone("lojaB"))?.chave], [CHAVE_A, CHAVE_B]);

  // 3) Start do totem
  novoPedido("p1", "lojaA", 45.9, 7);
  let r = await post(start, { token: "totem-a", orderId: "p1" });
  confere("start: 200 pela Stone", [r.status, r.corpo.modo, r.corpo.status, r.corpo.terminal?.label], [200, "STONE_CONNECT", "NO_TERMINAL", "Stone do totem"]);
  const or1 = r.corpo.posOrderId;
  const criacao = chamadas.find((c) => c.metodo === "POST" && c.caminho === "/orders")!;
  confere("start: Basic da loja A + ServiceRefererName", [criacao.conta, criacao.refererOk], ["A", true]);
  confere("start: corpo vai para o serial do totem com o valor do pedido", [criacao.corpo.poi_payment_settings.devices_serial_number[0], criacao.corpo.items[0].amount, criacao.corpo.code], ["6C582505", 4590, "p1"]);
  confere("start: acender NÃO é pagamento (sem gatewayProvider)", [pedido("p1").gatewayProvider, pedido("p1").posOrderId, pedido("p1").posStatus], [null, or1, "NO_TERMINAL"]);

  // 3b) start de novo reaproveita
  r = await post(start, { token: "totem-a", orderId: "p1" });
  confere("start repetido reaproveita a cobrança viva", [r.corpo.reaproveitada, r.corpo.posOrderId], [true, or1]);

  // 4) Webhook forjado antes de pagar
  r = await post(webhook, evento("charge.paid", or1, "p1"));
  confere("webhook forjado: reconsulta e não paga", [r.status, pedido("p1").paymentPaidAt, confirmados.length], [200, null, 0]);

  // 5) Paga na POS + webhook
  pagarNaPos(or1, "Debit");
  r = await post(webhook, evento("charge.paid", or1, "p1"));
  confere("webhook real: confirma uma vez", [r.status, confirmados], [200, ["p1"]]);
  confere("pago: gatewayProvider, forma e NSU", [pedido("p1").gatewayProvider, pedido("p1").paymentMethod, pedido("p1").gatewayPaymentId, pedido("p1").posStatus], ["STONE_CONNECT", "Cartão Débito (maquininha)", "NSU123", "PAGO"]);
  confere("pago: pedido fechado na Stone como paid", [pedidosStone[or1].closed, chamadas.some((c) => c.caminho === `/orders/${or1}/closed` && c.corpo?.status === "paid")], [true, true]);
  await post(webhook, evento("charge.paid", or1, "p1"));
  confere("webhook repetido não confirma de novo", confirmados.length, 1);
  confere("payment-status diz pago", (await consultaStatus("totem-a", "p1")).paid, true);

  // 6) Isolamento entre lojas
  novoPedido("p2", "lojaB", 20, 1);
  r = await post(start, { token: "totem-b", orderId: "p2" });
  const or2 = r.corpo.posOrderId;
  const criacaoB = chamadas.filter((c) => c.metodo === "POST" && c.caminho === "/orders").pop()!;
  confere("loja B usa a chave B e o fluxo direto (débito)", [criacaoB.conta, criacaoB.corpo.poi_payment_settings.payment_setup?.type], ["B", "debit"]);
  novoPedido("p3", "lojaA", 10, 8);
  await post(start, { token: "totem-a", orderId: "p3" });
  const or3 = pedido("p3").posOrderId;
  pagarNaPos(or3);
  r = await post(webhook, evento("charge.paid", or3, "p2"));
  confere("id da conta A com referência da loja B: B não é paga", [pedido("p2").paymentPaidAt, r.corpo.ignorado ?? null], [null, null]);
  confere("…e o pedido da A (dono do id) é que é conferido e pago", pedido("p3").paymentPaidAt !== null, true);
  // Pedido PAGO na conta A que diz ser do pedido p2 (loja B): a busca pela
  // referência acha p2, mas a chave da B não enxerga pedido da conta A.
  pedidosStone["or_forjadoA"] = { ...pedidosStone[or3], id: "or_forjadoA", code: "p2", metadata: { firehub_ref: "p2" }, closed: false };
  r = await post(webhook, evento("charge.paid", "or_forjadoA", "p2"));
  confere("pedido pago da conta A com referência de B: B continua sem pagar", [r.status, r.corpo.ignorado, pedido("p2").paymentPaidAt], [200, "pedido não é desta conta", null]);
  r = await post(webhook, evento("charge.paid", "or_naoexiste", "p2"));
  confere("pedido Stone desconhecido: 200 ignorado (sem reenvio eterno)", [r.status, pedido("p2").paymentPaidAt], [200, null]);
  r = await post(webhook, { type: "charge.paid", data: { order: { id: or2 } } }, "http://local/x");
  confere("pedido B sem pagar na POS continua aguardando", pedido("p2").paymentPaidAt, null);

  // 7) Cancelar
  r = await post(cancelar, { token: "totem-b", orderId: "p2" });
  confere("cancelar: fecha como canceled", [r.status, r.corpo.status, pedidosStone[or2].status, pedido("p2").posStatus], [200, "CANCELADO", "canceled", "CANCELADO"]);
  novoPedido("p4", "lojaA", 12, 9);
  await post(start, { token: "totem-a", orderId: "p4" });
  pagarNaPos(pedido("p4").posOrderId);
  r = await post(cancelar, { token: "totem-a", orderId: "p4" });
  confere("cancelar com cartão aprovado no meio: JA_PAGO e confirmado", [r.status, r.corpo.code, r.corpo.pago, pedido("p4").paymentPaidAt !== null], [409, "JA_PAGO", true, true]);

  // 8) Recusa + tentar de novo
  novoPedido("p5", "lojaA", 30, 10);
  await post(start, { token: "totem-a", orderId: "p5" });
  const or5 = pedido("p5").posOrderId;
  recusarNaPos(or5);
  await post(webhook, { type: "charge.payment_failed", data: { order: { id: or5, code: "p5" } } });
  confere("recusa: posStatus RECUSADO (totem mostra tentar de novo)", pedido("p5").posStatus, "RECUSADO");
  r = await post(start, { token: "totem-a", orderId: "p5" });
  confere("tentar de novo: derruba o pedido recusado e manda outro", [pedidosStone[or5].status, r.corpo.posOrderId !== or5, r.corpo.status], ["canceled", true, "NO_TERMINAL"]);

  // 9) Abandonada há 20 min
  novoPedido("p6", "lojaA", 15, 11);
  await post(start, { token: "totem-a", orderId: "p6" });
  const or6 = pedido("p6").posOrderId;
  pedidosStone[or6].created_at = new Date(Date.now() - 20 * 60_000).toISOString();
  const st = await consultaStatus("totem-a", "p6");
  confere("abandonada: payment-status derruba na Stone e marca EXPIRADO", [pedidosStone[or6].status, st.cobranca, st.paid], ["canceled", "EXPIRADO", false]);

  // 10) Sem ServiceRefererName
  process.env.STONE_CONNECT_SERVICE_REFERER_NAME = "";
  novoPedido("p7", "lojaA", 9, 12);
  r = await post(start, { token: "totem-a", orderId: "p7" });
  confere("sem id de parceiro no servidor: 503 sem chamar a Stone", [r.status, r.corpo.code], [503, "STONE_SEM_PARCEIRO"]);
  process.env.STONE_CONNECT_SERVICE_REFERER_NAME = "parceiro-firehub-teste";

  // 11) Mesa
  db.tableSession.push({
    id: "mesa1", status: "OPEN", paymentMethods: [], waiterTip: 0, totalPaid: 0,
    table: { franchiseeId: "lojaA", number: 3 }, orders: [{ status: "ENTREGUE", totalAmount: 80 }],
  });
  const criada = await mesa.criarCobrancaDaMesa({ lojaId: "lojaA", tableSessionId: "mesa1", valorCentavos: 5000, terminalId: "tA", por: "Garçom Zé" });
  confere("mesa: cobrança criada na Stone", criada.ok, true);
  const cob = cobrancasMesa[0];
  const orMesa = cob.mpOrderId;
  confere("mesa: pedido Stone com code mesa:<id> e 5000 centavos", [pedidosStone[orMesa]?.code, pedidosStone[orMesa]?.amount, cob.status], [`mesa:${cob.id}`, 5000, "NO_TERMINAL"]);
  r = await post(webhook, evento("charge.paid", orMesa, `mesa:${cob.id}`));
  confere("mesa: webhook sem pagamento não dá baixa", db.tableSession[0].paymentMethods.length, 0);
  pagarNaPos(orMesa, "Credit");
  r = await post(webhook, evento("charge.paid", orMesa, `mesa:${cob.id}`));
  const baixa = db.tableSession[0].paymentMethods[0];
  confere("mesa: baixa de R$ 50 no crédito e cobrança PAGO", [baixa?.method, baixa?.amount, cob.status, pedidosStone[orMesa].closed], ["Crédito", 50, "PAGO", true]);
  await post(webhook, evento("charge.paid", orMesa, `mesa:${cob.id}`));
  confere("mesa: webhook repetido não lança duas vezes", db.tableSession[0].paymentMethods.length, 1);

  // 12) Nunca o Mercado Pago
  confere("nenhuma chamada ao Mercado Pago", hostsTocados.filter((h) => h.includes("mercadopago")).length, 0);
  confere("toda chamada à Stone levou ServiceRefererName", chamadas.every((c) => c.refererOk), true);

  console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo certo.");
  process.exit(falhas ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
