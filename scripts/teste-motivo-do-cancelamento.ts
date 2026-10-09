/**
 * MOTIVO OBRIGATÓRIO AO CANCELAR (lib/motivo-do-cancelamento.ts) e os
 * cancelamentos na conferência do caixa (lib/cancelamentos-do-turno.ts).
 *
 *   npx tsx scripts/teste-motivo-do-cancelamento.ts
 *
 * Pizzaria 17 (Antonio, 09/10/2026): "quando cancelar qualquer coisa, preciso
 * que um campo obrigatório seja preenchido explicando o motivo" — e, por
 * áudio, o item tirado da mesa (a bebida) com o motivo na conferência do
 * fechamento. O papel dele mostrava "Cancelado na mesa pelo painel", "Cancelado
 * pelo painel ao editar o pedido" ou nada.
 *
 * Sem banco: as três rotas da loja rodam contra um Prisma em memória
 * (o mesmo jeito de scripts/teste-seguranca-da-rota-de-status.ts).
 *
 *   1. A régua do motivo (a tela e o servidor usam a mesma).
 *   2. PUT /api/customer-order/status — quadro de pedidos, arrastar, lote.
 *   3. PATCH/DELETE da mesa — tablet, celular e garçom.
 *   4. PATCH/DELETE da edição do pedido no painel.
 *   5. O fechamento: itens tirados no turno, quem cancelou, e o papel.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { limparMotivo, motivoValido, motivoDoCorpo } from "../src/lib/motivo-do-cancelamento";
import { itensCanceladosNoTurno, quemCancelouPeloRastro } from "../src/lib/cancelamentos-do-turno";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

Object.assign(process.env, { NODE_ENV: "development" });
process.env.DATABASE_URL ||= "postgresql://banco-falso/teste";

// ── Banco em memória ─────────────────────────────────────────────────────────
type Linha = Record<string, any>;
const db: { user: Linha[]; customerOrder: Linha[]; tableSession: Linha[] } = { user: [], customerOrder: [], tableSession: [] };
const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const copia = <T,>(v: T): T => (v == null ? v : structuredClone(v));
function casaCampo(valor: any, filtro: any): boolean {
  if (filtro === null) return valor == null;
  if (typeof filtro !== "object" || Array.isArray(filtro)) return igual(valor, filtro);
  for (const [op, alvo] of Object.entries(filtro)) {
    if (op === "equals") { if (!igual(valor, alvo)) return false; }
    else if (op === "in") { if (!(alvo as unknown[]).includes(valor)) return false; }
    else if (op === "notIn") { if ((alvo as unknown[]).includes(valor)) return false; }
    else return false;
  }
  return true;
}
function casa(linha: Linha, where: any): boolean {
  if (!where) return true;
  for (const [k, v] of Object.entries(where)) {
    if (k === "OR") { if (!(v as any[]).some((w) => casa(linha, w))) return false; }
    else if (k === "franchisee") { return false; }
    else if (!casaCampo(linha[k], v)) return false;
  }
  return true;
}
const projetar = (linha: Linha, select?: Record<string, any>): Linha => {
  const c = copia(linha);
  if (!select) return c;
  const saida: Linha = {};
  for (const [k, v] of Object.entries(select)) if (v) saida[k] = c[k] ?? null;
  return saida;
};
const delegado = (modelo: keyof typeof db) => ({
  findUnique: async (a: any) => { const l = db[modelo].find((x) => casa(x, a.where)); return l ? projetar(l, a.select) : null; },
  findFirst: async (a: any) => { const l = db[modelo].find((x) => casa(x, a.where)); return l ? projetar(l, a.select) : null; },
  findMany: async (a: any = {}) => db[modelo].filter((x) => casa(x, a.where)).map((l) => projetar(l, a.select)),
  update: async (a: any) => { const l = db[modelo].find((x) => casa(x, a.where)); if (!l) throw new Error(`update ${modelo}`); Object.assign(l, copia(a.data)); return projetar(l, a.select); },
  updateMany: async (a: any) => { const alvos = db[modelo].filter((x) => casa(x, a.where)); for (const l of alvos) Object.assign(l, copia(a.data)); return { count: alvos.length }; },
});
// Os itens moram dentro do pedido (o banco falso não tem relação).
const itens = {
  delete: async ({ where }: any) => { for (const o of db.customerOrder) o.items = (o.items || []).filter((i: any) => i.id !== where.id); return {}; },
  update: async ({ where, data }: any) => { for (const o of db.customerOrder) for (const i of o.items || []) if (i.id === where.id) Object.assign(i, data); return {}; },
  create: async () => ({}),
  findMany: async () => [],
};
(globalThis as any).prisma = {
  user: delegado("user"), customerOrder: delegado("customerOrder"), tableSession: delegado("tableSession"),
  customerOrderItem: itens,
  $transaction: async (arg: any) => (Array.isArray(arg) ? Promise.all(arg) : arg((globalThis as any).prisma)),
};

const stub = (caminho: string, exports: Record<string, unknown>) => {
  const arquivo = require.resolve(caminho);
  require.cache[arquivo] = { id: arquivo, filename: arquivo, loaded: true, exports: { __esModule: true, ...exports } } as any;
};
let sessaoEmail: string | null = "caixa@p17.teste";
stub("next-auth/next", { getServerSession: async () => (sessaoEmail ? { user: { email: sessaoEmail, name: "Maria" } } : null) });
stub("../src/lib/auth", { authOptions: {} });
stub("../src/lib/whatsapp-evolution", { sendEvolutionMessage: async () => true });
stub("../src/lib/order-notifications", { sendOrderNotification: async () => {} });
stub("../src/lib/fiscal-automatico", { emitirNfceDosPedidos: async () => {}, emitirNfceAutomatica: async () => {} });
stub("../src/lib/stock", { restoreStockForOrder: async () => {}, deductStockForOrder: async () => {} });
stub("../src/lib/estoque-restante", { conferirEstoque: async () => ({ ok: true }) });
// O operador da mesa: o caixa pelo painel.
stub("../src/lib/garcom-auth", {
  resolverOperadorDaMesa: async () => ({ tipo: "loja", franchiseeId: "p17", userId: "u1", ownerId: null, name: "Maria" }),
  rotuloDoOperador: (op: any) => (op.tipo === "garcom" ? `Garçom ${op.garcom.name}` : op.name),
});

const corpo = (b: unknown) => ({ method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
const pedido = (id: string) => db.customerOrder.find((o) => o.id === id)!;

// ── 1. A régua ──────────────────────────────────────────────────────────────
function secaoRegua() {
  console.log("\n— 1. A régua do motivo —");
  confere("vazio não serve", motivoValido(""), false);
  confere("\"ok\" (2 letras) não serve", motivoValido("ok"), false);
  confere("\"...\" e \"123\" não servem", [motivoValido("..."), motivoValido("123")], [false, false]);
  confere("sugestão serve", motivoValido("Cliente desistiu"), true);
  confere("espaços juntados", limparMotivo("  Erro   de\nlançamento "), "Erro de lançamento");
  confere("corpo: aceita motivo, cancelReason ou motivoDoCancelamento", [motivoDoCorpo({ motivo: "Falta de produto" }), motivoDoCorpo({ cancelReason: "Pedido duplicado" })], ["Falta de produto", "Pedido duplicado"]);
}

// ── 2. Quadro de pedidos ────────────────────────────────────────────────────
async function secaoStatus() {
  console.log("\n— 2. PUT /api/customer-order/status (quadro, arrastar, lote) —");
  db.user.length = 0; db.customerOrder.length = 0;
  db.user.push({ id: "p17", email: "caixa@p17.teste", ownerId: null, name: "Maria", role: "FRANCHISEE" });
  db.customerOrder.push({ id: "p4", franchiseeId: "p17", status: "ACEITO", source: "PRESENCIAL", deliveryType: "RETIRADA", paymentMethod: "Dinheiro", totalAmount: 45, fiscalStatus: null, fiscalInfo: null, editHistory: null, dailyOrderNumber: 4 });
  const { PUT } = await import("../src/app/api/customer-order/status/route");
  const chamar = async (b: unknown) => { const r = await PUT(new Request("http://t/api/customer-order/status", corpo(b)) as any); return { status: r.status, json: await r.json() }; };

  let r = await chamar({ orderId: "p4", status: "CANCELADO" });
  confere("#4 sem motivo: 400", r.status, 400);
  confere("…com a mensagem clara", /motivo/i.test(r.json.error || ""), true);
  confere("…e o pedido não mudou", pedido("p4").status, "ACEITO");
  r = await chamar({ orderId: "p4", status: "CANCELADO", cancelReason: "ok" });
  confere("motivo de 2 letras: 400", r.status, 400);
  r = await chamar({ orderId: "p4", status: "PREPARANDO" });
  confere("mudar para Em Produção não pede motivo", r.status, 200);
  r = await chamar({ orderId: "p4", status: "CANCELADO", cancelReason: "  Cliente desistiu,  esperou demais " });
  confere("com motivo: 200", r.status, 200);
  confere("grava o motivo digitado (limpo)", pedido("p4").cancelReason, "Cliente desistiu, esperou demais");
  confere("cancelledBy LOJA", pedido("p4").cancelledBy, "LOJA");
  const ultimo = (pedido("p4").editHistory || []).slice(-1)[0] || {};
  confere("rastro: CANCELOU com quem e o motivo", [ultimo.acao, ultimo.quem, ultimo.motivo], ["CANCELOU", "Maria (dono)", "Cliente desistiu, esperou demais"]);
}

// ── 3. Mesa ─────────────────────────────────────────────────────────────────
async function secaoMesa() {
  console.log("\n— 3. Mesa (tablet, celular, garçom): tirar item e cancelar —");
  db.customerOrder.length = 0; db.tableSession.length = 0;
  db.tableSession.push({ id: "s7", status: "OPEN", franchiseeId: "p17", table: { number: 7 } });
  db.customerOrder.push({
    id: "m1", franchiseeId: "p17", tableSessionId: "s7", status: "ACEITO", totalAmount: 79, fiscalStatus: null, editHistory: null, dailyOrderNumber: 12,
    items: [
      { id: "i1", quantity: 1, price: 59, menuProductId: "pz", productName: "Pizza Calabresa G", menuProduct: { name: "Pizza Calabresa G" } },
      { id: "i2", quantity: 2, price: 10, menuProductId: "cc", productName: "Coca-Cola Lata", menuProduct: { name: "Coca-Cola Lata" } },
    ],
  });
  const rota = await import("../src/app/api/store/table-sessions/[id]/orders/[orderId]/route");
  const { NextRequest } = await import("next/server");
  const params = Promise.resolve({ id: "s7", orderId: "m1" });
  const patch = async (b: unknown) => { const r = await rota.PATCH(new NextRequest("http://t/x", { ...corpo(b), method: "PATCH" }), { params }); return { status: r!.status, json: await r!.json() }; };

  let r = await patch({ removerItemIds: ["i2"] });
  confere("tirar a Coca sem motivo: 400", r.status, 400);
  confere("…a Coca continua na conta", pedido("m1").items.length, 2);
  r = await patch({ itens: [{ itemId: "i2", quantity: 1 }] });
  confere("diminuir 2→1 sem motivo: 400", r.status, 400);
  r = await patch({ itens: [{ itemId: "i2", quantity: 3 }] });
  confere("aumentar 2→3 não pede motivo", r.status, 200);
  r = await patch({ itens: [{ itemId: "i2", quantity: 1 }], motivo: "Erro de lançamento" });
  confere("diminuir 3→1 com motivo: 200", r.status, 200);
  let rastro = pedido("m1").editHistory.slice(-1)[0];
  confere("rastro: 2x Coca retiradas, R$ 20, com o motivo", [rastro.acao, rastro.itensRetirados, rastro.motivo, rastro.quem], ["MUDOU_QTD", [{ nome: "Coca-Cola Lata", quantidade: 2, valor: 20 }], "Erro de lançamento", "Maria"]);
  r = await patch({ removerItemIds: ["i2"], motivo: "Cliente desistiu da bebida" });
  confere("tirar a Coca com motivo: 200 e o total cai para 59", [r.status, pedido("m1").totalAmount], [200, 59]);
  rastro = pedido("m1").editHistory.slice(-1)[0];
  confere("rastro: REMOVEU 1x Coca R$ 10", [rastro.acao, rastro.itensRetirados], ["REMOVEU", [{ nome: "Coca-Cola Lata", quantidade: 1, valor: 10 }]]);

  const del = async (b?: unknown, query = "") => {
    const r = await rota.DELETE(new NextRequest(`http://t/x${query}`, b ? { ...corpo(b), method: "DELETE" } : { method: "DELETE" }), { params });
    return { status: r!.status, json: await r!.json() };
  };
  r = await del();
  confere("cancelar o pedido da mesa sem motivo: 400", r.status, 400);
  confere("…continua valendo", pedido("m1").status, "ACEITO");
  r = await del(undefined, "?motivo=Pedido%20duplicado");
  confere("cancelar com ?motivo=: 200", r.status, 200);
  confere("grava status, quem e motivo (não mais \"Cancelado na mesa pelo painel\")", [pedido("m1").status, pedido("m1").cancelledBy, pedido("m1").cancelReason], ["CANCELADO", "LOJA", "Pedido duplicado"]);
  confere("quem cancelou, pelo rastro", quemCancelouPeloRastro(pedido("m1").editHistory), "Maria");
}

// ── 4. Edição do pedido no painel ───────────────────────────────────────────
async function secaoEdicao() {
  console.log("\n— 4. Editar pedido no painel —");
  db.customerOrder.length = 0;
  db.customerOrder.push({
    id: "e1", franchiseeId: "p17", status: "ACEITO", source: "PRESENCIAL", deliveryType: "DELIVERY", paymentMethod: "Dinheiro",
    totalAmount: 79, deliveryFee: 0, discountTotal: 0, tableSessionId: null, editHistory: null, fiscalStatus: null, dailyOrderNumber: 5,
    items: [
      { id: "a1", quantity: 1, price: 59, productName: "Pizza Calabresa G", menuProductId: "pz" },
      { id: "a2", quantity: 2, price: 10, productName: "Coca-Cola Lata", menuProductId: "cc" },
    ],
  });
  const rota = await import("../src/app/api/store/orders/[id]/itens/route");
  const { NextRequest } = await import("next/server");
  const params = Promise.resolve({ id: "e1" });
  const patch = async (b: unknown) => { const r = await rota.PATCH(new NextRequest("http://t/x", { ...corpo(b), method: "PATCH" }), { params }); return { status: r!.status, json: await r!.json() }; };

  let r = await patch({ removerItemIds: ["a2"] });
  confere("tirar a Coca sem motivo: 400", r.status, 400);
  confere("…nada mudou", pedido("e1").items.length, 2);
  r = await patch({ removerItemIds: ["a2"], motivo: "Falta de produto" });
  confere("com motivo: 200", r.status, 200);
  const rastro = pedido("e1").editHistory.slice(-1)[0];
  confere("rastro: REMOVEU com itensRetirados e motivo; o texto de sempre (−Nome)", [rastro.acao, rastro.descricao, rastro.motivo, rastro.itensRetirados], ["REMOVEU", "−Coca-Cola Lata", "Falta de produto", [{ nome: "Coca-Cola Lata", quantidade: 2, valor: 20 }]]);
  r = await patch({ removerItemIds: ["a1"] });
  confere("tirar o último item (cancela) sem motivo: 400", [r.status, pedido("e1").status], [400, "ACEITO"]);
  const r2 = await rota.DELETE(new NextRequest("http://t/x", { ...corpo({ motivo: "Cliente desistiu" }), method: "DELETE" }), { params });
  confere("DELETE com motivo cancela e grava o motivo (não mais \"Cancelado pelo painel ao editar o pedido\")", [r2!.status, pedido("e1").status, pedido("e1").cancelReason], [200, "CANCELADO", "Cliente desistiu"]);
}

// ── 5. O fechamento ─────────────────────────────────────────────────────────
async function secaoFechamento() {
  console.log("\n— 5. Fechamento do caixa: itens tirados e quem cancelou —");
  const abriu = new Date("2026-10-09T21:00:00.000Z");
  const pedidos = [
    { dailyOrderNumber: 12, onde: "Mesa 7", editHistory: [
      { quando: "2026-10-09T22:10:00.000Z", quem: "Maria", acao: "REMOVEU", descricao: "−Coca-Cola Lata", totalAntes: 79, totalDepois: 59, motivo: "Cliente desistiu da bebida", itensRetirados: [{ nome: "Coca-Cola Lata", quantidade: 2, valor: 20 }] },
      // Antes de o caixa abrir: fica de fora.
      { quando: "2026-10-09T20:00:00.000Z", quem: "Maria", acao: "REMOVEU", descricao: "−Água", totalAntes: 5, totalDepois: 0, motivo: "x", itensRetirados: [{ nome: "Água", quantidade: 1, valor: 5 }] },
      // Registro antigo, sem itensRetirados: fica de fora.
      { quando: "2026-10-09T22:20:00.000Z", quem: "João", acao: "REMOVEU", descricao: "−Guaraná", totalAntes: 59, totalDepois: 52 },
    ] },
    // Cancelado inteiro: sai em Cancelados, não aqui.
    { dailyOrderNumber: 5, onde: "Delivery", status: "CANCELADO", editHistory: [
      { quando: "2026-10-09T22:30:00.000Z", quem: "Maria (dono)", acao: "CANCELOU", descricao: "x", totalAntes: 59, totalDepois: 0, motivo: "Cliente desistiu", itensRetirados: [{ nome: "Pizza", quantidade: 1, valor: 59 }] },
    ] },
  ];
  const lista = itensCanceladosNoTurno(pedidos, { de: abriu });
  confere("uma linha: a Coca da mesa 7, com quem, valor e motivo", lista.map((i) => [i.numero, i.onde, i.item, i.quem, i.valor, i.motivo]), [["#12", "Mesa 7", "2x Coca-Cola Lata", "Maria", 20, "Cliente desistiu da bebida"]]);
  confere("quem cancelou o #5", quemCancelouPeloRastro(pedidos[1].editHistory), "Maria (dono)");

  // O papel: o mesmo cupom que vai para o Assistente.
  const { cupomDeFechamentoDeCaixa } = await import("../src/lib/cupom-do-caixa");
  const { apurarVendasDoTurno } = await import("../src/lib/apuracao-do-turno");
  const { retrato } = apurarVendasDoTurno([], []) as any;
  const zero = { cash: 0, debit: 0, credit: 0, pix: 0, voucher: 0 };
  const cupom = cupomDeFechamentoDeCaixa({
    sessionId: "c1", loja: "PIZZARIA 17", fuso: "America/Sao_Paulo", operador: "Maria",
    abertoEm: abriu, fechadoEm: new Date("2026-10-10T02:00:00.000Z"), trocoInicial: 100,
    valores: {
      esperado: { ...zero, total: 0 }, contado: zero, diferenca: 0,
      detalhe: {
        ...retrato,
        gaveta: { vendasEmDinheiro: 0, reforcosQtd: 0, sangriasQtd: 0 }, movimentacoes: [], fiado: retrato.fiado || [],
        cancelados: { qtd: 1, valor: 59, lista: [{ hora: "2026-10-09T22:30:00.000Z", numero: "#5", canal: "Balcao", referencia: null, valor: 59, motivo: "Cliente desistiu", quem: "loja", operador: "Maria (dono)" }] },
        itensCancelados: lista,
        entregadores: [], entregaParceira: { qtd: 0, valor: 0 }, semEntregador: { qtd: 0, valor: 0 }, maisVendidos: [],
      },
    } as any,
  } as any);
  const texto = JSON.stringify(cupom);
  confere("papel: o #5 sai com o nome e o motivo", texto.includes("cancelado pela loja (Maria (dono)): Cliente desistiu"), true);
  confere("papel: bloco Itens cancelados", /Itens cancelados/i.test(texto), true);
  confere("papel: a Coca da mesa 7 com quem e o motivo", texto.includes("#12 Mesa 7 2x Coca-Cola Lata") && texto.includes("por Maria: Cliente desistiu da bebida"), true);
  confere("papel: total dos itens cancelados", texto.includes("Total de itens cancelados (1)"), true);

  // A tela do fechamento recebe o mesmo, pela GET do caixa.
  const rotaDoCaixa = readFileSync(join(__dirname, "..", "src", "app", "api", "cash-session", "route.ts"), "utf8");
  confere("GET do caixa devolve `cancelamentos` (pedidos e itens)", /cancelamentos:\s*detalhe/.test(rotaDoCaixa) && rotaDoCaixa.includes("itensCancelados"), true);
}

(async () => {
  secaoRegua();
  await secaoStatus();
  await secaoMesa();
  await secaoEdicao();
  await secaoFechamento();
  console.log(falhas ? `\n❌ ${falhas} falha(s).` : "\n✅ Tudo certo.");
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
