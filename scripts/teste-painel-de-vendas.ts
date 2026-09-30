/**
 * Trava as VENDAS e o TICKET do Painel de vendas (/store/relatorios/painel):
 * o cartão "Vendas no filtro" e o "Ticket médio do período" do Movimento.
 *
 *   npx tsx scripts/teste-painel-de-vendas.ts
 *
 * O painel filtra no navegador; a conta das vendas e do ticket está em duas
 * funções puras exportadas de RelatoriosClient.tsx (vendaDaRegua e
 * cartaoDeVendas), as mesmas que a tela chama. A régua é
 * lib/relatorios/regua-da-venda.ts — e a seção 4 confere contra o resumo do
 * Vendas por período (lib/relatorios/vendas.ts) nos mesmos pedidos.
 *
 * Por que existe (revisão de 24/09/2026): o cartão dividia a soma dos ITENS
 * pelas vendas e o Movimento dividia o valor vendido pelas vendas. Dois
 * "ticket médio" na mesma tela, sem filtro nenhum: NIK, 09–16/09/2026, R$ 62,99
 * no cartão × R$ 55,00 no Movimento e no Vendas por período; Pastel da
 * Paulista, 67,99 × 70,16.
 */
import { cartaoDeVendas, vendaDaRegua, type PedidoDoPainel } from "../src/app/store/relatorios/painel/RelatoriosClient";
import { resumoDeVendas, type PedidoParaVendas } from "../src/lib/relatorios/vendas";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

const SEM_FILTRO = { produtos: new Set<string>(), categorias: new Set<string>() };
const SO_BEBIDAS = { produtos: new Set<string>(), categorias: new Set(["Bebidas"]) };

let seq = 0;
const item = (categoria: string, preco: number, qtd = 1) => ({
  productId: `${categoria}-${preco}`, productCategory: categoria, quantity: qtd, price: preco, productCost: 0,
});
const pedido = (x: Partial<PedidoDoPainel> & { items: PedidoDoPainel["items"] }): PedidoDoPainel => ({
  id: `p${String(++seq).padStart(3, "0")}`, createdAt: `2026-09-12T23:${String(seq).padStart(2, "0")}:00.000Z`,
  status: "ENTREGUE", totalAmount: 0, tableSessionId: null, parentOrderId: null, ...x,
});
/** A receita dos itens que a tela passa (somarVendas), para o caso com filtro. */
const receitaDosItens = (ps: PedidoDoPainel[], cat: string | null) =>
  ps.reduce((s, p) => s + p.items.filter((i) => !cat || i.productCategory === cat).reduce((t, i) => t + i.price * i.quantity, 0), 0);

console.log("\n1) Sem filtro de item: o ticket é o da régua, não o dos itens");
// Um pedido do iFood com R$ 70 de itens, R$ 15 de desconto e R$ 0 de taxa: o
// cliente pagou R$ 55. Um de balcão de R$ 40 (itens 40). Itens ÷ vendas =
// (70 + 40) ÷ 2 = 55,00; valor vendido ÷ vendas = (55 + 40) ÷ 2 = 47,50.
const IFOOD = pedido({ totalAmount: 55, items: [item("Pizzas", 60), item("Bebidas", 10)] });
const BALCAO = pedido({ totalAmount: 40, items: [item("Pizzas", 40)] });
const c1 = cartaoDeVendas([IFOOD, BALCAO], SEM_FILTRO, receitaDosItens([IFOOD, BALCAO], null));
confere("cartão: 2 vendas, ticket R$ 47,50 (valor vendido ÷ vendas) — não R$ 55,00 (itens ÷ vendas)",
  [c1.vendas, c1.ticket, c1.dosItens], [2, 47.5, false]);
confere("…o mesmo ticket do Movimento (vendaDaRegua), na mesma tela", c1.ticket, vendaDaRegua([IFOOD, BALCAO]).ticket);

console.log("\n2) A mesa de três rodadas é uma venda");
const RODADAS = [50, 50, 50].map((v) => pedido({ totalAmount: v, tableSessionId: "s1", items: [item("Pizzas", v - 5), item("Bebidas", 5)] }));
const ACRESCIMO = pedido({ totalAmount: 8, parentOrderId: IFOOD.id, items: [item("Bebidas", 8)] });
const todos = [IFOOD, BALCAO, ...RODADAS, ACRESCIMO];
const r2 = vendaDaRegua(todos);
confere("valor 253, vendas 3 (iFood + balcão + a mesa; o acréscimo é do iFood), 6 lançamentos, ticket 84,33",
  [r2.valor, r2.vendas, r2.lancamentos, r2.ticket], [253, 3, 6, 84.33]);
const c2 = cartaoDeVendas(todos, SEM_FILTRO, receitaDosItens(todos, null));
confere("o cartão sem filtro é o mesmo número", [c2.vendas, c2.lancamentos, c2.ticket, c2.dosItens], [3, 6, 84.33, false]);

console.log("\n3) Com filtro de item: vendas com algum item marcado, e o ticket é o dos ITENS");
// Bebidas: iFood (10), as três rodadas (5 cada, uma venda só) e o acréscimo
// (8, do iFood). O balcão não tem bebida. 10 + 15 + 8 = 33 em 2 vendas.
const c3 = cartaoDeVendas(todos, SO_BEBIDAS, receitaDosItens(todos, "Bebidas"));
confere("Bebidas: 2 vendas, 5 lançamentos, ticket dos itens R$ 16,50 — e a tela diz que é dos itens",
  [c3.vendas, c3.lancamentos, c3.ticket, c3.dosItens], [2, 5, 16.5, true]);

console.log("\n4) O mesmo número do Vendas por período");
// Os mesmos pedidos no resumo do Vendas por período: valor vendido, vendas e
// ticket têm de ser os do painel, centavo a centavo.
const comoVenda = (p: PedidoDoPainel): PedidoParaVendas => ({
  id: p.id, franchiseeId: "loja", createdAt: p.createdAt, status: String(p.status), totalAmount: Number(p.totalAmount),
  tableSessionId: p.tableSessionId, parentOrderId: p.parentOrderId, source: "PRESENCIAL", deliveryType: "PICKUP",
  items: p.items.map((i) => ({ quantity: i.quantity, price: i.price })),
} as unknown as PedidoParaVendas);
// Um ticket que não fecha no centavo: 100 ÷ 3 = 33,33.
const TRES = [33.33, 33.33, 33.34].map((v) => pedido({ totalAmount: v, items: [item("Pizzas", v)] }));
for (const [nome, ps] of [["os pedidos de cima", todos], ["três pedidos que somam R$ 100", TRES]] as const) {
  const rv = resumoDeVendas(ps.map(comoVenda));
  const rp = vendaDaRegua(ps as PedidoDoPainel[]);
  confere(`${nome}: painel = Vendas por período (valor, vendas, lançamentos, ticket)`,
    [rp.valor, rp.vendas, rp.lancamentos, rp.ticket], [rv.totalPedidos, rv.atendimentos, rv.pedidos, rv.ticketMedio]);
}

console.log("\n5) O que a régua tira da venda, o painel também tira");
// O painel só deixava de fora o "CANCELADO". O cancelado em inglês e o pedido
// de valor impossível (R$ 1 milhão ou mais) entravam no faturamento dele.
const CANCELLED = pedido({ status: "CANCELLED", totalAmount: 90, items: [item("Pizzas", 90)] });
const IMPOSSIVEL = pedido({ totalAmount: 1e17, items: [item("Pizzas", 1e17)] });
const r5 = vendaDaRegua([BALCAO, CANCELLED, IMPOSSIVEL]);
confere("cancelado em inglês e valor impossível: fora do valor e das vendas", [r5.valor, r5.vendas, r5.ticket], [40, 1, 40]);
const SEM_ITENS = pedido({ totalAmount: 12, items: [] });
confere("pedido sem item, sem filtro de item: é venda (como no Vendas por período)",
  [cartaoDeVendas([BALCAO, SEM_ITENS], SEM_FILTRO, 40).vendas, vendaDaRegua([BALCAO, SEM_ITENS]).valor], [2, 52]);
confere("sem venda nenhuma: ticket zero, sem dividir por zero", vendaDaRegua([]), { valor: 0, vendas: 0, lancamentos: 0, ticket: 0 });

console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
