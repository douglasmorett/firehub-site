import assert from "node:assert/strict";
import Module from "node:module";
import { NextRequest } from "next/server";
import { lerPagamentos } from "../src/lib/pagamentos-da-mesa";
import { quitadaSomentePorPos } from "../src/lib/fechamento-pos-da-mesa";

let mesa: any, charges: Map<string, any>, writes = 0, fiscais = 0, falhar = false;
let fila = Promise.resolve();
const terminal = { id: "t1", franchiseeId: "A", label: "POS teste", provider: "CIELO_APP" };
function reset(valor = 220) {
  writes = fiscais = 0; falhar = false;
  mesa = { id: "s1", tableId: "mesa1", franchiseeId: "A", status: "OPEN", paymentMethods: [], totalPaid: 0, waiterTip: null, waiterId: "w1", waiter: { commissionRate: 5 }, table: { number: 1, label: null, franchiseeId: "A" }, orders: [{ id: "p1", dailyOrderNumber: 25, tableSessionId: "s1", status: "PREPARANDO", totalAmount: 2, editHistory: null, items: [] }] };
  charges = new Map([["c1", { id: "c1", tableSessionId: "s1", franchiseeId: "A", terminalId: "t1", valorCentavos: valor, status: "NO_TERMINAL", provedor: "CIELO_APP", tentativas: 0, guestId: null, guestName: null, dados: { conta: { taxa: 10, gorjeta: 0, desconto: null } } }]]);
}
const db: any = {
  tableSession: {
    findUnique: async ({ where }: any) => where.id === mesa.id ? structuredClone(mesa) : null,
    update: async ({ where, data }: any) => { assert.equal(where.id, mesa.id); if (falhar && data.status === "CLOSED") throw Error("falha fechamento"); Object.assign(mesa, structuredClone(data)); writes++; return structuredClone(mesa); },
  },
  user: { findUnique: async () => ({ taxaServicoPadrao: 10 }) },
  tableGuest: { findMany: async () => [] },
  posTerminal: { findFirst: async ({ where }: any) => where.id === "t1" && where.franchiseeId === "A" ? { ...terminal, active: true, lastSeenAt: new Date() } : null },
  customerOrder: {
    updateMany: async ({ where, data }: any) => { assert.equal(where.tableSessionId, "s1"); assert.deepEqual(Object.keys(data), ["updatedAt"], "autofecho não altera produção nem forma individual"); for (const o of mesa.orders) Object.assign(o, data); },
    update: async ({ where, data }: any) => { Object.assign(mesa.orders.find((o: any) => o.id === where.id), data); },
  },
  $queryRawUnsafe: async (sql: string, ...args: any[]) => {
    if (sql.includes('FROM "TableSession"')) {
      assert.match(sql, /FOR UPDATE/); assert.equal(args[1], "A");
      return args[0] === mesa.id && mesa.franchiseeId === args[1] && mesa.table.franchiseeId === args[1] ? [{ status: mesa.status, paymentMethods: structuredClone(mesa.paymentMethods) }] : [];
    }
    if (sql.includes('FROM "User"')) return [{ id: "A" }];
    if (sql.includes('AS "aprovado"')) return [...charges.values()].filter(c => c.tableSessionId === args[0] && c.franchiseeId === args[1] && c.status === "PAGO").map(c => ({ pagamentoUid: c.pagamentoUid, valorCentavos: c.valorCentavos, aprovado: c.dados.aprovado === true }));
    if (sql.includes('SELECT "status"') && sql.includes('FOR UPDATE')) return charges.has(args[0]) ? [{ status: charges.get(args[0]).status }] : [];
    if (sql.includes('WHERE "tableSessionId"')) return [...charges.values()].filter(c => c.tableSessionId === args[0]);
    if (sql.includes('CobrancaDaMesaNaMaquininha')) return charges.has(args[0]) ? [structuredClone(charges.get(args[0]))] : [];
    throw Error("SQL não previsto no banco fictício");
  },
  $executeRawUnsafe: async (sql: string, ...args: any[]) => {
    if (/CREATE/.test(sql)) return 0;
    const c = charges.get(args[0]); assert.ok(c, "cobrança existe");
    if (c.status === "PAGO" && sql.includes('"status" <>')) return 0;
    c.status = args[1];
    if (sql.includes('"pagamentoUid" = $3')) c.pagamentoUid = args[2]; else c.tentativas = args[2];
    c.dados = { ...c.dados, ...JSON.parse(args[3]) }; return 1;
  },
  $transaction: (fn: any) => {
    const run = fila.then(async () => { const antes = structuredClone({ mesa, charges }); try { return await fn(db); } catch (e) { mesa = antes.mesa; charges = antes.charges; throw e; } });
    fila = run.then(() => {}, () => {}); return run;
  },
};
const carregar = (Module as any)._load;
(Module as any)._load = function(id: string, ...args: any[]) {
  if (id === "@/lib/prisma") return { prisma: db };
  if (id === "@/lib/fiscal-automatico") return { emitirNfceDaMesa: async () => { fiscais++; } };
  if (id === "@/lib/garcom-auth") return { resolverOperadorDaMesa: async () => ({ tipo: "loja", franchiseeId: "A" }), rotuloDoOperador: () => "Operador teste", idDoOperadorDaMesa: () => "operador" };
  if (id === "@/lib/caixa-aberto-servidor") return { recusaSeCaixaFechado: async () => null };
  return carregar.call(this, id, ...args);
};
globalThis.fetch = async () => { throw Error("rede proibida no teste"); };

async function main() {
  const { registrarResultadoDaMesa, criarCobrancaDaMesa } = await import("../src/lib/cobranca-da-mesa-na-maquininha");
  const confirmar = (extra: any = {}) => registrarResultadoDaMesa({ terminal, cobrancaId: "c1", aprovado: true, dados: { tipo: "CREDITO" }, ...extra });
  reset();
  assert.equal((await confirmar()).corpo.mesaFechada, true);
  assert.equal(mesa.status, "CLOSED"); assert.equal(mesa.serviceFee, 0.2); assert.equal(mesa.waiterCommission, 0.1);
  assert.equal(mesa.orders[0].status, "PREPARANDO"); assert.equal(mesa.paymentMethods.length, 1); assert.equal(mesa.totalPaid, 2.2);
  assert.equal((await confirmar()).corpo.jaConfirmado, true); assert.equal(mesa.paymentMethods.length, 1);
  reset(); const concorrentes = await Promise.all([confirmar(), confirmar(), confirmar()]); assert.equal(mesa.paymentMethods.length, 1); assert.equal(concorrentes.filter(r => r.corpo.mesaFechada).length, 1);
  reset(110); assert.equal((await confirmar()).corpo.mesaFechada, false); assert.equal(mesa.status, "OPEN");
  charges.set("c2", { ...structuredClone(charges.get("c1")), id: "c2", status: "NO_TERMINAL", pagamentoUid: null });
  assert.equal((await confirmar({ cobrancaId: "c2" })).corpo.mesaFechada, true); assert.equal(mesa.totalPaid, 2.2);
  reset(110); mesa.paymentMethods = [{ uid: "manual1", method: "Dinheiro", amount: 1.1 }]; await confirmar(); assert.equal(mesa.status, "OPEN"); assert.equal(mesa.totalPaid, 2.2);
  reset(); mesa.orders.push({ id: "p2", dailyOrderNumber: 26, status: "ACEITO", totalAmount: 1 }); await confirmar(); assert.equal(mesa.status, "OPEN", "novo item antes do lock impede autofecho");
  reset(); await confirmar({ aprovado: false }); assert.equal(mesa.status, "OPEN"); assert.equal(mesa.paymentMethods.length, 0);
  reset(); charges.get("c1").status = "CANCELADO"; await confirmar(); assert.equal(mesa.status, "OPEN", "aprovação tardia de cobrança cancelada registra valor, sem fechar");
  reset(); assert.equal((await confirmar({ terminal: { ...terminal, franchiseeId: "B" } })).status, 403); assert.equal(mesa.paymentMethods.length, 0);
  assert.equal((await confirmar({ terminal: { ...terminal, id: "t2" } })).status, 409); assert.equal(mesa.paymentMethods.length, 0);
  reset(); charges.get("c1").status = "PAGO"; mesa.paymentMethods = [{ uid: "maquininha-c1", method: "Crédito", amount: 2.2 }]; await confirmar(); assert.equal(mesa.status, "OPEN", "não reconcilia retroativamente pagamento antigo");
  reset(120); charges.get("c1").dados.conta = { taxa: 10, gorjeta: 0.1, desconto: { tipo: "valor", valor: 1, motivo: "teste" } }; await confirmar();
  assert.equal(mesa.status, "CLOSED"); assert.equal(mesa.serviceFee, 0.1); assert.equal(mesa.waiterTip, 0.1); assert.match(JSON.stringify(mesa.orders[0].editHistory), /DESCONTO/); assert.equal(mesa.orders[0].totalAmount, 2);
  reset(); falhar = true; await assert.rejects(confirmar(), /falha fechamento/); assert.equal(mesa.paymentMethods.length, 0); assert.equal(charges.get("c1").status, "NO_TERMINAL");
  reset(); charges.clear();
  const pedido = { lojaId: "A", tableSessionId: "s1", valorCentavos: 300, terminalId: "t1", por: "teste" };
  const alto = await criarCobrancaDaMesa(pedido); assert.equal(alto.ok, false); if (!alto.ok) assert.equal(alto.codigo, "VALOR_ACIMA_DA_CONTA");
  assert.equal((await criarCobrancaDaMesa({ ...pedido, valorCentavos: 99 })).ok, false);
  assert.equal((await criarCobrancaDaMesa({ ...pedido, lojaId: "B" })).ok, false);
  assert.equal((await criarCobrancaDaMesa({ ...pedido, terminalId: "t2" })).ok, false);
  const lista = lerPagamentos([{ uid: "maquininha-x", method: "Crédito", amount: 2.2 }]);
  assert.equal(quitadaSomentePorPos(2.2, lista, [{ pagamentoUid: "maquininha-x", valorCentavos: 219, aprovado: true }]), false);
  assert.equal(quitadaSomentePorPos(2.2, lista, [{ pagamentoUid: "maquininha-x", valorCentavos: 220, aprovado: false }]), false);
  assert.equal(quitadaSomentePorPos(2.2, [...lista, ...lista], [{ pagamentoUid: "maquininha-x", valorCentavos: 220, aprovado: true }]), false);
  const pagamentos = await import("../src/app/api/store/table-sessions/[id]/pagamentos/route");
  const manual = () => pagamentos.POST(new NextRequest("http://fixture.local/pagamentos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ valor: 1.1, metodo: "Dinheiro" }) }), { params: Promise.resolve({ id: "s1" }) });
  reset(110); await Promise.all([confirmar(), manual()]); assert.equal(mesa.paymentMethods.length, 2, "manual concorrente não apaga POS"); assert.equal(mesa.totalPaid, 2.2); assert.equal(mesa.status, "OPEN");
  const apagar = await pagamentos.DELETE(new NextRequest("http://fixture.local/pagamentos?uid=maquininha-c1", { method: "DELETE" }), { params: Promise.resolve({ id: "s1" }) });
  assert.equal(apagar.status, 409); assert.equal(mesa.paymentMethods.length, 2, "baixa POS aprovada não some por exclusão manual");
  reset(); charges.clear(); mesa.paymentMethods = [{ uid: "maquininha-anterior", method: "Crédito", amount: 0.5, conta: { taxa: 0, gorjeta: 0.5, desconto: { tipo: "valor", valor: 1, motivo: "teste" } } }];
  const conta = await import("../src/app/api/store/table-sessions/[id]/conta/route");
  const nativa = await conta.GET(new NextRequest("http://fixture.local/conta?taxa=10"), { params: Promise.resolve({ id: "s1" }) });
  const contaNativa = await nativa.json(); assert.equal(contaNativa.total, 1.5); assert.equal(contaNativa.desconto.valor, 1); assert.equal(contaNativa.taxaServico.valor, 0);
  const web = await conta.GET(new NextRequest("http://fixture.local/conta?taxa=10&gorjeta=0&descontoValor=0"), { params: Promise.resolve({ id: "s1" }) });
  assert.equal((await web.json()).total, 2.2, "formulário web pode simular outra regra explicitamente");
  const limiteParcial = await criarCobrancaDaMesa({ lojaId: "A", tableSessionId: "s1", terminalId: "t1", valorCentavos: 101, por: "teste" });
  assert.equal(limiteParcial.ok, false); if (!limiteParcial.ok) assert.equal(limiteParcial.codigo, "VALOR_ACIMA_DA_CONTA", "cobrança seguinte usa contexto da conta, não a taxa padrão nova");
  console.log("PASS callback real: integral POS, parcial, misto manual, duplicado concorrente, novo item, cancelado/recusado, tenant/terminal, desconto/taxa/gorjeta/comissão, rollback e valores inválidos");
}
main().catch(e => { console.error(e); process.exitCode = 1; });
