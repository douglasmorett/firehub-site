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
import { cartaoDeVendas, vendaDaRegua, resumoDaOperacao, tipoDaOperacao, diasNoPeriodo, vendasPorDiaDaSemana, diasDaMedia, periodoDoPainel, type PedidoDoPainel } from "../src/app/store/relatorios/painel/RelatoriosClient";
import { resumoDeVendas, type PedidoParaVendas } from "../src/lib/relatorios/vendas";
import { hojeNaLoja } from "../src/lib/relatorios/base";

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

console.log("\n6) Resumo da operação: mesa não é entrega, PICKUP não é entrega");
// Ragnar Burger, 01–11/10/2026: a tela dizia "Entrega 2063 — 99,4%"; tudo que
// não era RETIRADA caía em Entrega, inclusive a mesa.
confere("tipos", ["DELIVERY", "MESA", "RETIRADA", "PICKUP", "TAKEOUT", "BALCAO", ""].map((t) => tipoDaOperacao({ deliveryType: t })),
  ["ENTREGA", "MESA", "RETIRADA", "RETIRADA", "RETIRADA", "RETIRADA", "RETIRADA"]);
confere("rodada de mesa com sessão é MESA mesmo com outro deliveryType", tipoDaOperacao({ deliveryType: "DELIVERY", tableSessionId: "s9" }), "MESA");
const ENT = pedido({ totalAmount: 60, deliveryType: "DELIVERY", items: [item("Lanches", 60)] } as any);
const PICK = pedido({ totalAmount: 30, deliveryType: "PICKUP", items: [item("Lanches", 30)] } as any);
const MESA3 = [40, 25, 15].map((v) => pedido({ totalAmount: v, deliveryType: "MESA", tableSessionId: "s7", items: [item("Lanches", v)] } as any));
const CANC = pedido({ totalAmount: 99, deliveryType: "DELIVERY", status: "CANCELADO", items: [item("Lanches", 99)] } as any);
const op = resumoDaOperacao([ENT, PICK, ...MESA3, CANC] as any);
confere("1 entrega, 1 mesa (3 rodadas, R$ 80), 1 retirada; cancelado fora",
  [op.vendas, op.entrega.vendas, op.mesa.vendas, op.mesa.lancamentos, op.mesa.valor, op.retirada.vendas, op.entrega.valor],
  [3, 1, 1, 3, 80, 1, 60]);
confere("os três tipos somam as vendas da régua", op.entrega.vendas + op.mesa.vendas + op.retirada.vendas, vendaDaRegua([ENT, PICK, ...MESA3, CANC]).vendas);

console.log("\n7) Dias da semana: média por dia operacional, não soma");
// 01/10/2026 é quinta. De 01 a 11/10: 2 qui, 2 sex, 2 sáb, 2 dom, 1 seg, 1 ter, 1 qua.
const SP = "America/Sao_Paulo";
confere("ocorrências de 01 a 11/10/2026 (Dom..Sáb)", diasNoPeriodo("2026-10-01", "2026-10-11"), [2, 1, 1, 1, 2, 2, 2]);
// Horário de Brasília (UTC-3): 20h do dia X = 23h UTC.
const noDia = (dia: number, v: number, horaUtc = 23) => pedido({ createdAt: `2026-10-${String(dia).padStart(2, "0")}T${String(horaUtc).padStart(2, "0")}:00:00.000Z`, totalAmount: v, items: [item("Lanches", v)] } as any);
// Dois sábados de R$ 100 e uma quarta de R$ 150: somando, o sábado (200) ganha; pela média, a quarta (150 × 100).
const sem = vendasPorDiaDaSemana([noDia(3, 100), noDia(10, 100), noDia(7, 150)] as any, "2026-10-01", "2026-10-10", SP);
confere("sábado: 2 dias, 2 vendas, média R$ 100; quarta: média R$ 150 e é o dia mais forte",
  [sem.dias[6].dias, sem.dias[6].vendas, sem.dias[6].mediaValor, sem.dias[3].mediaValor, sem.pico?.dia], [2, 2, 100, 150, 3]);
const mesaNoSabado = [10, 20, 30].map((v, k) => pedido({ createdAt: `2026-10-03T23:0${k}:00.000Z`, totalAmount: v, tableSessionId: "s8", items: [item("Lanches", v)] } as any));
const sem2 = vendasPorDiaDaSemana(mesaNoSabado as any, "2026-10-01", "2026-10-10", SP);
confere("mesa de 3 rodadas no sábado: 1 venda, R$ 60 no dia (média 30 em 2 sábados)", [sem2.dias[6].vendas, sem2.dias[6].valor, sem2.dias[6].mediaValor], [1, 60, 30]);
// Sábado 03/10, 01h30 em Brasília = 04:30 UTC: ainda é a SEXTA operacional (vira às 5h).
const madrugada = vendasPorDiaDaSemana([pedido({ createdAt: "2026-10-03T04:30:00.000Z", totalAmount: 50, items: [item("Lanches", 50)] } as any)] as any, "2026-10-01", "2026-10-10", SP);
confere("pedido de 01h30 do sábado conta na sexta (dia operacional)", [madrugada.dias[5].vendas, madrugada.dias[6].vendas], [1, 0]);
confere("período invertido/vazio não divide por zero", vendasPorDiaDaSemana([], "2026-10-11", "2026-10-01", SP).pico, null);
// Domingo 11/10 (hoje): o "Este mês" vai até sábado na média.
confere("este mês no domingo 11/10: de 01/10 a 10/10, sem hoje", diasDaMedia("2026-10-01", "2026-10-11", "2026-09-03", "2026-10-11"), { de: "2026-10-01", ate: "2026-10-10", semHoje: true });
confere("período só de hoje: hoje mesmo", diasDaMedia("2026-10-11", "2026-10-11", null, "2026-10-11"), { de: "2026-10-11", ate: "2026-10-11", semHoje: false });
confere("Tudo (365 dias) numa loja de setembro: começa no primeiro pedido", diasDaMedia("2025-10-12", "2026-10-11", "2026-09-03", "2026-10-11").de, "2026-09-03");

console.log("\n8) Período: os atalhos e o dia operacional dos relatórios");
// Até 11/10/2026: "Últimos 7 dias" = hoje−7 até agora (8 dias), pela meia-noite do navegador.
confere("7 dias = hoje e os 6 anteriores", periodoDoPainel("7d", "2026-10-11"), { de: "2026-10-05", ate: "2026-10-11" });
confere("ontem", periodoDoPainel("ontem", "2026-10-11"), { de: "2026-10-10", ate: "2026-10-10" });
confere("este mês", periodoDoPainel("mes", "2026-10-11"), { de: "2026-10-01", ate: "2026-10-11" });
confere("tudo (365 dias)", periodoDoPainel("365d", "2026-10-11"), { de: "2025-10-12", ate: "2026-10-11" });
confere("datas escolhidas, invertidas, viram de/até", periodoDoPainel("7d", "2026-10-11", { de: "2026-10-09", ate: "2026-10-01" }), { de: "2026-10-01", ate: "2026-10-09" });
confere("data incompleta cai no atalho", periodoDoPainel("ontem", "2026-10-11", { de: "2026-10-01", ate: "" }), { de: "2026-10-10", ate: "2026-10-10" });
// Domingo 11/10 às 01:30 em Belém (04:30 UTC): o turno de sábado ainda está aberto — "hoje" é sábado.
confere("hoje às 01h30 de domingo ainda é sábado (dia operacional)", hojeNaLoja("America/Belem", new Date("2026-10-11T04:30:00Z")), "2026-10-10");
confere("hoje às 08h40 de domingo é domingo", hojeNaLoja("America/Belem", new Date("2026-10-11T11:40:00Z")), "2026-10-11");

console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
