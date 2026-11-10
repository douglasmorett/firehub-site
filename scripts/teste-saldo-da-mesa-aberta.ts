import assert from "node:assert/strict";
import { anexarSaldoDasMesas, saldoDaContaDaMesa, saldoDaMesa, saldoDaMesaDoQuadro } from "../src/lib/saldo-da-mesa";
import { pagamentoDaMesaNoPedido, camposDoPagamentoDaMesaParaImpressao } from "../src/lib/pagamento-da-mesa-no-pedido";
import { idsQueMudaram, soOQueMudou } from "../src/lib/filtro-do-feed";

async function main() {
  const credito = [{ uid: "maquininha-cobranca-1", method: "Crédito", amount: 2.2 }];
  const conta = {
    status: "OPEN", totalPaid: 999, paymentMethods: credito, waiterTip: null,
    table: { number: 1, label: null, franchisee: { taxaServicoPadrao: 10 } },
    orders: [{ status: "ACEITO", totalAmount: 2, dailyOrderNumber: 25 }],
  };
  const saldo = saldoDaMesaDoQuadro(conta);
  assert.deepEqual(saldo, { total: 2.2, recebido: 2.2, falta: 0, troco: 0, quitada: true });
  const pedido = { tableSessionId: "mesa-1", tableSession: { ...conta, saldo } };
  assert.equal(pagamentoDaMesaNoPedido(pedido)?.situacao, "paga");
  assert.match(camposDoPagamentoDaMesaParaImpressao(pedido).notes!, /Mesa paga: Crédito R\$ 2,20/);
  assert.equal(conta.totalPaid, 999, "o saldo usa o ledger; não corrige nem grava cache");

  for (const valor of [0.5, 1, 2, 2.19]) {
    const parcial = { ...conta, paymentMethods: [{ uid: "parte", method: "Crédito", amount: valor }] };
    const pg = pagamentoDaMesaNoPedido({ tableSessionId: "mesa-1", tableSession: { ...parcial, saldo: saldoDaMesaDoQuadro(parcial) } });
    assert.equal(pg?.situacao, "parcial");
    assert.match(pg!.resumo, /recebido.*falta/);
    assert.doesNotMatch(camposDoPagamentoDaMesaParaImpressao({ tableSessionId: "mesa-1", tableSession: { ...parcial, saldo: saldoDaMesaDoQuadro(parcial) } }).notes!, /Mesa paga/);
  }
  const novaRodada = { ...conta, orders: [...conta.orders, { status: "ACEITO", totalAmount: 3, dailyOrderNumber: 26 }] };
  assert.deepEqual(saldoDaMesaDoQuadro(novaRodada), { total: 5.5, recebido: 2.2, falta: 3.3, troco: 0, quitada: false });
  assert.equal(saldoDaMesaDoQuadro({ ...novaRodada, orders: [...novaRodada.orders, { status: "CANCELADO", totalAmount: 100 }] }).total, 5.5);
  assert.equal(saldoDaMesaDoQuadro({ ...conta, table: { ...conta.table, franchisee: { taxaServicoPadrao: 0 } } }).total, 2);
  assert.equal(saldoDaMesaDoQuadro({ ...conta, waiterTip: 1 }).total, 3.2);
  const dividida = saldoDaMesa(2.2, [{ uid: "pix", method: "Pix", amount: 1 }, { uid: "card", method: "Crédito", amount: 1.2 }]);
  assert.equal(dividida.quitada, true);
  assert.deepEqual(saldoDaMesa(0.3, [{ method: "Pix", amount: 0.1 }, { method: "Dinheiro", amount: 0.2 }]), { total: 0.3, recebido: 0.3, falta: 0, troco: 0, quitada: true });
  assert.equal(saldoDaMesa(0, []).quitada, false);
  assert.equal(saldoDaMesaDoQuadro({ ...conta, paymentMethods: [] }).quitada, false, "recusada/cancelada sem baixa não paga a conta");
  assert.equal(pagamentoDaMesaNoPedido({ tableSessionId: "mesa-1", tableSession: { ...conta, saldo: { ...saldo, recebido: 9 } } })?.situacao, "parcial", "snapshot inconsistente nunca declara pago");

  const mesa = { table: { number: 1, label: null }, waiterTip: 3, paymentMethods: [{ method: "Pix", amount: 92 }], orders: [{ status: "ACEITO", totalAmount: 100, dailyOrderNumber: 1, items: [] }] };
  assert.deepEqual(saldoDaContaDaMesa(mesa, 10, null, { tipo: "valor", valor: 20 }), { total: 91, recebido: 92, falta: 0, troco: 1, quitada: true });
  assert.equal(saldoDaContaDaMesa(mesa, 10, 0, { tipo: "percent", valor: 10 }).total, 99);

  const payload = anexarSaldoDasMesas([{ id: "p1", tableSession: structuredClone(conta) }, { id: "p2", tableSession: { ...structuredClone(conta), table: { number: 8, label: null, franchisee: { taxaServicoPadrao: 0 } } } }]);
  assert.equal((payload[0].tableSession as any).saldo.total, 2.2);
  assert.equal((payload[1].tableSession as any).saldo.total, 2, "cada loja usa sua taxa, sem cache cruzado");
  assert.equal((payload[0].tableSession as any).orders, undefined);
  assert.equal(payload[0].tableSession.table.franchisee, undefined);
  assert.equal(pagamentoDaMesaNoPedido(JSON.parse(JSON.stringify(payload[0]))), null, "pedido sem tableSessionId segue sem pagamento derivado");
  const persistido = JSON.parse(JSON.stringify(pedido));
  assert.equal(pagamentoDaMesaNoPedido(persistido)?.situacao, "paga", "refresh/reentrada preserva resultado derivado");

  let consulta: any;
  const desde = new Date("2026-11-10T10:00:00Z");
  const filtros = { validFranchiseeIds: ["tenant-A"], from: desde, ATIVO_SEM_PERIODO_DESDE: desde, desde, incluirMesasAbertas: true };
  await idsQueMudaram({ customerOrder: { findMany: async args => { consulta = args; return [{ id: "pedido-sem-update" }]; } } }, filtros);
  assert.deepEqual(consulta.where.franchiseeId, { in: ["tenant-A"] });
  assert.deepEqual(consulta.where.AND[0].OR[1], { tableSession: { status: "OPEN" } });
  assert.equal(consulta.take, 151);
  const delta = soOQueMudou({ franchiseeId: { in: ["tenant-A"] } }, desde, true) as any;
  assert.deepEqual(delta.AND[0], { franchiseeId: { in: ["tenant-A"] } });
  assert.deepEqual(delta.AND[1].AND[0].OR[1], { tableSession: { status: "OPEN" } });
  assert.deepEqual(soOQueMudou({}, desde), { AND: [{}, { updatedAt: { gte: desde } }] });
  console.log("PASS saldo mesa aberta: total/parcial, novas rodadas, taxas, gorjeta, desconto, centavos, formas, impressão, reload, delta e isolamento");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
