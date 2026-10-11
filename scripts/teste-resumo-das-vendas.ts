/**
 * Trava o "Resumo das vendas" do quadro de pedidos (src/lib/resumo-das-vendas.ts):
 * o TOTAL é o valor vendido dos Relatórios (sem o cupom do app, sem rascunho
 * do robô), PRONTO tem linha, as linhas somam o total, a mesa tem linha
 * própria, o cupom do iFood/99 fica à parte e o cupom da PRÓPRIA loja no site
 * não vira "cupom do app".
 *
 *   npx tsx scripts/teste-resumo-das-vendas.ts
 */
import { linhaDaVenda, resumoDasVendas, type PedidoDoResumo } from "../src/lib/resumo-das-vendas";
import { resumoDeVendas } from "../src/lib/relatorios/vendas";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

let seq = 0;
const p = (x: Partial<PedidoDoResumo> & { totalAmount: number; status: string }): PedidoDoResumo =>
  ({ id: `p${++seq}`, createdAt: "2026-10-10T22:00:00Z", items: [{ quantity: 1, price: x.totalAmount }], ...x }) as PedidoDoResumo;

const PEDIDOS: PedidoDoResumo[] = [
  // iFood entregue com cupom de R$ 10 bancado pelo iFood: o total do pedido é
  // o que o cliente pagou; o cupom fica na linha à parte.
  p({ status: "ENTREGUE", totalAmount: 50, source: "IFOOD", ifoodOrderId: "i1", discountTotal: 10, discountIfood: 10, discountMerchant: 0 }),
  // 99Food em transporte com cupom do 99 pelas colunas (total − loja).
  p({ status: "SAIU_ENTREGA", totalAmount: 40, source: "99FOOD", openDeliveryChannel: "99FOOD", discountTotal: 8, discountMerchant: 3 }),
  // Site com cupom da PRÓPRIA loja (sem discountMerchant): NÃO é cupom do app.
  // O resumo antigo somava estes R$ 15 no total ("desconto do canal").
  p({ status: "ENTREGUE", totalAmount: 60, source: "SITE", discountTotal: 15 }),
  p({ status: "NOVO", totalAmount: 25, source: "SITE" }),
  p({ status: "ACEITO", totalAmount: 30, source: "SITE" }),
  p({ status: "PREPARANDO", totalAmount: 35, source: "IFOOD", ifoodOrderId: "i2" }),
  // PRONTO: não tinha linha — o total tinha um pedaço que nenhuma linha mostrava.
  p({ status: "PRONTO", totalAmount: 45, source: "PRESENCIAL", deliveryType: "RETIRADA" }),
  // Mesa: duas rodadas "Aceito" (a conta está aberta) — não é "em preparo".
  p({ status: "ACEITO", totalAmount: 70, source: "PRESENCIAL", deliveryType: "MESA", tableSessionId: "s1" }),
  p({ status: "ACEITO", totalAmount: 30, source: "PRESENCIAL", deliveryType: "MESA", tableSessionId: "s1" }),
  // Pagamento dividido no balcão: sem cupom de app.
  p({ status: "ENTREGUE", totalAmount: 100, source: "PRESENCIAL", deliveryType: "RETIRADA", paymentMethods: [{ method: "Pix", amount: 60 }, { method: "Dinheiro", amount: 40 }] }),
  // Fora do total.
  p({ status: "AGUARDANDO_PAGAMENTO", totalAmount: 33, source: "TOTEM" }),
  p({ status: "CRIANDO_IA", totalAmount: 99, source: "WHATSAPP_IA" }),
  p({ status: "CANCELADO", totalAmount: 80, source: "IFOOD", ifoodOrderId: "i3", discountIfood: 5 }),
  p({ status: "ENTREGUE", totalAmount: 1e17, source: "SITE", items: [{ quantity: 1, price: 1e17 }] }),
];

const r = resumoDasVendas(PEDIDOS);
const VENDIDO = 50 + 40 + 60 + 25 + 30 + 35 + 45 + 70 + 30 + 100;
confere("TOTAL = valor vendido dos Relatórios (sem cupom do app, sem rascunho, sem pendente, sem valor impossível)", r.total.valor, VENDIDO);
const daRegua = resumoDeVendas(PEDIDOS.map((x) => ({ ...x, franchiseeId: "L", totalAmount: Number(x.totalAmount) })) as any);
confere("é o mesmo valor, as mesmas vendas e o mesmo ticket do Vendas por período", [r.total.valor, r.total.vendas, r.total.lancamentos, r.total.ticket],
  [daRegua.totalPedidos, daRegua.atendimentos, daRegua.pedidos, daRegua.ticketMedio]);
confere("vendas: a mesa de duas rodadas é uma (9 vendas, 10 lançamentos)", [r.total.vendas, r.total.lancamentos], [9, 10]);
confere("as linhas, com PRONTOS e a mesa na dela", r.linhas.map((l) => [l.chave, l.lancamentos, l.valor, l.contas ?? null]), [
  ["NOVOS", 1, 25, null], ["PREPARO", 2, 65, null], ["PRONTOS", 1, 45, null], ["TRANSPORTE", 1, 40, null], ["ENTREGUES", 3, 210, null], ["MESAS", 2, 100, 1],
]);
confere("as linhas SOMAM o total", [r.linhas.reduce((s, l) => s + l.valor, 0), r.linhas.reduce((s, l) => s + l.lancamentos, 0)], [r.total.valor, r.total.lancamentos]);
confere("cupom do iFood/99 à parte: R$ 10 do iFood + R$ 5 do 99 (o cupom da loja no site e o cancelado não entram)", r.cupomDaPlataforma, { pedidos: 2, valor: 15 });
confere("pendente, cancelado, rascunho e valor impossível no lugar deles", [r.pendentes, r.cancelados, r.rascunhos, r.valoresImpossiveis],
  [{ lancamentos: 1, valor: 33 }, { lancamentos: 1, valor: 80 }, 1, 1]);

// O resumo antigo (StoreOrdersDashboard até 11/10/2026), nos mesmos pedidos:
const canalAntigo = (o: any) => {
  if (typeof o.discountIfood === "number" && o.discountIfood > 0) return o.discountIfood;
  const t = Number(o.discountTotal || 0), m = Number(o.discountMerchant || 0);
  return t > m ? t - m : 0;
};
const totalAntigo = PEDIDOS.filter((o) => o.status !== "CANCELADO" && o.status !== "AGUARDANDO_PAGAMENTO" && Number(o.totalAmount) < 1e6)
  .reduce((s, o) => s + Number(o.totalAmount) + canalAntigo(o), 0);
confere("o antigo dava R$ 129 a mais que o vendido: cupom do iFood (10) e do 99 (5), o cupom da loja no site (15) e o rascunho do robô (99)", Math.round((totalAntigo - VENDIDO) * 100) / 100, 10 + 5 + 15 + 99);

confere("linha de cada status", ["NOVO", "ACEITO", "PREPARANDO", "PRONTO", "SAIU_ENTREGA", "ENTREGUE", "ENCERRADO", "XYZ"].map((s) => linhaDaVenda({ status: s })),
  ["NOVOS", "PREPARO", "PREPARO", "PRONTOS", "TRANSPORTE", "ENTREGUES", "ENTREGUES", "OUTROS"]);
confere("a mesa vai para NAS MESAS com qualquer status", linhaDaVenda({ status: "ENTREGUE", tableSessionId: "s9" }), "MESAS");
const soOutros = resumoDasVendas([p({ status: "EM_ROTA", totalAmount: 12 })]);
confere("status desconhecido ganha a linha OUTROS (as linhas continuam somando o total)", soOutros.linhas.map((l) => [l.chave, l.valor]),
  [["NOVOS", 0], ["PREPARO", 0], ["PRONTOS", 0], ["TRANSPORTE", 0], ["ENTREGUES", 0], ["OUTROS", 12]]);

console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
