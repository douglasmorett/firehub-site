/**
 * Trava o relatório "Itens consumidos" (lib/relatorios/itens-consumidos.ts):
 * o consumo pelas baixas gravadas, as devoluções, o pedido de origem e os
 * filtros, o dia do pedido, a cobertura pela baixa, o CMV e a lista do que foi
 * vendido sem ficha técnica.
 *
 *   npx tsx scripts/teste-itens-consumidos.ts
 *
 * Os textos de nota e de sourceRef são os que lib/stock.ts grava de verdade
 * (deductStockForOrder / restoreStockForOrder).
 */
import {
  chavesDasEscolhas, fichaDoItem, itensConsumidos, montarFichas, pedidoDoMovimento, separarMovimentos, situacaoDoPedido,
  type InsumoDoCadastro, type MovimentoDeEstoque, type PedidoVendido, type SituacaoDoPedido,
} from "../src/lib/relatorios/itens-consumidos";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

const TZ = "America/Sao_Paulo";
const L = "nik";
const L2 = "nik-2";

// As notas exatamente como lib/stock.ts escreve.
const baixa = (pedido: string, insumo: string, qtd: number, quando = "2026-09-19T18:00:00Z", comRef = true): MovimentoDeEstoque => ({
  stockItemId: insumo, type: "SALE", quantity: -qtd, createdAt: quando,
  sourceRef: comRef ? `sale:${pedido}:${insumo}` : null,
  notes: `Baixa automática - Pedido #${pedido.slice(-6)} (id: ${pedido})`,
});
const devolucao = (pedido: string, insumo: string, qtd: number, quando = "2026-09-19T18:05:00Z"): MovimentoDeEstoque => ({
  stockItemId: insumo, type: "INPUT", quantity: qtd, createdAt: quando, sourceRef: null,
  notes: `Devolução por cancelamento - Pedido #${pedido.slice(-6)} (cancel id: ${pedido})`,
});

console.log("\n1) De qual pedido é a movimentação");
confere("baixa com sourceRef", pedidoDoMovimento(baixa("ped-1", "mus", 1)), { pedidoId: "ped-1", tipo: "baixa" });
confere("baixa já devolvida (sourceRef apagado pela devolução): o pedido sai da nota",
  pedidoDoMovimento(baixa("ped-3", "mus", 1, undefined, false)), { pedidoId: "ped-3", tipo: "baixa" });
confere("devolução por cancelamento", pedidoDoMovimento(devolucao("ped-3", "mus", 1)), { pedidoId: "ped-3", tipo: "devolucao" });
confere("entrada de nota fiscal não é consumo", pedidoDoMovimento({ type: "INPUT", notes: "Entrada NF 1234 - Atacadão", sourceRef: null }), null);
confere("perda não é consumo de venda", pedidoDoMovimento({ type: "WASTE", notes: "Queijo vencido", sourceRef: null }), null);
confere("saída manual não é consumo de venda", pedidoDoMovimento({ type: "OUTPUT", notes: "(id: ped-1)", sourceRef: null }), null);

console.log("\n2) A situação do pedido de origem (a régua única)");
confere("cancelado, em qualquer grafia", [situacaoDoPedido({ status: "CANCELADO" }, true), situacaoDoPedido({ status: "cancelled" }, true)], ["cancelado", "cancelado"]);
confere("totem esperando pagamento e rascunho do robô não são venda",
  [situacaoDoPedido({ status: "AGUARDANDO_PAGAMENTO" }, true), situacaoDoPedido({ status: "CRIANDO_IA" }, true)], ["foraDaVenda", "foraDaVenda"]);
confere("venda que não passa no filtro", situacaoDoPedido({ status: "ENTREGUE" }, false), "foraDoFiltro");
confere("pedido de antes do período (a baixa de hoje é a edição do pedido de ontem); cancelado continua cancelado",
  [situacaoDoPedido({ status: "ENTREGUE" }, true, false), situacaoDoPedido({ status: "CANCELADO" }, true, false)], ["antesDoPeriodo", "cancelado"]);
confere("pedido apagado", situacaoDoPedido(null, true), "semPedido");

console.log("\n3) As movimentações que o relatório usa (período + folga)");
const separadas = separarMovimentos([
  baixa("v1", "mus", 100, "2026-09-19T18:00:00Z"),
  // A edição do pedido vendido chega na folga, depois do fim: entra.
  devolucao("v1", "mus", 100, "2026-09-22T18:00:00Z"), baixa("v1", "mus", 50, "2026-09-22T18:00:01Z"),
  // Outro pedido, com baixa dentro do período: só para dizer por que ficou de fora.
  baixa("x1", "mus", 30, "2026-09-19T18:00:00Z"),
  // Outro pedido, com baixa na folga: é do período seguinte.
  baixa("x2", "mus", 30, "2026-09-22T18:00:00Z"),
  { stockItemId: "mus", type: "WASTE", quantity: -20, notes: "Caiu no chão", sourceRef: null, createdAt: "2026-09-19T12:00:00Z" },
], new Set(["v1"]), new Date("2026-09-21T08:00:00Z"));
confere("todas as do pedido vendido (inclusive a edição na folga) e a do outro pedido no período; a da folga de outro pedido e a perda saem",
  [separadas.movimentos.map((m) => pedidoDoMovimento(m)?.pedidoId), separadas.pedidosParaClassificar], [["v1", "v1", "v1", "x1"], ["x1"]]);

console.log("\n4) As escolhas do combo, como a baixa as lê");
confere("formato do cardápio { grupo: { opção: qtd } }", chavesDasEscolhas({ g1: { "Esfiha de Carne": 2, "Esfiha de Queijo": 0 } }), ["esfiha de carne"]);
confere("formato do PDV/iFood: ids e nome", chavesDasEscolhas(JSON.stringify([{ name: "Coca Lata", quantity: 1, menuProductId: "coca" }])), ["coca", "coca lata"]);
confere("texto antigo: '2x Esfiha' é Esfiha, mas '5 Queijos' é o nome do sabor",
  chavesDasEscolhas(["2x Esfiha de Carne", "5 Queijos"]), ["esfiha de carne", "5 queijos"]);

// ── O cadastro ──
const INSUMOS: InsumoDoCadastro[] = [
  { id: "mus", nome: "Mussarela", unidade: "g", custoUnitario: 0.05 },
  { id: "cal", nome: "Calabresa", unidade: "g", custoUnitario: 0.04 },
  { id: "mas", nome: "Massa de esfiha", unidade: "un", custoUnitario: 0.3 },
  { id: "coca-i", nome: "Coca lata", unidade: "un", custoUnitario: 3.2 },
  { id: "ore", nome: "Orégano", unidade: "g", custoUnitario: null },
  // A mesma mussarela na segunda loja da conta, cadastrada em "G" e mais cara.
  { id: "mus2", nome: "Mussarela", unidade: "G", custoUnitario: 0.06 },
  { id: "car", nome: "Carne moída", unidade: "g", custoUnitario: 0.05 },
];
const ativo = (id: string, name: string, category: string, franchiseeId = L) => ({ id, name, category, franchiseeId, active: true });
const FICHAS = montarFichas(
  [
    ativo("pc", "Pizza Calabresa", "Pizzas"), ativo("pcb", "Pizza Calabresa Broto", "Pizzas"),
    ativo("eq", "Esfiha de Queijo", "Esfihas"), ativo("coca", "Coca lata", "Bebidas"),
    ativo("gua", "Guaraná 2L", "Bebidas"), ativo("bat", "Batata frita", "Porções"),
    ativo("combo", "Combo 2 Esfihas", "Combos"), ativo("ec", "Esfiha de Carne", "Esfihas"), ativo("ep", "Esfiha de Palmito", "Esfihas"),
    // Espelho do iFood ativo, com ficha: a baixa NUNCA casa pelo nome com ele.
    ativo("ifood-xs", "X-Salada", "iFood"),
    ativo("pm2", "Pizza Mussarela", "Pizzas", L2),
  ],
  ["pc", "pcb", "eq", "coca", "ec", "pm2", "ifood-xs"],
  [{ id: "cgi-ec", menuProductId: "ec", produtoDoComboId: "combo", nomeDaOpcao: "Esfiha de Carne" }],
  ["combo"],
);

const ESPELHO = (id: string, name: string) => ({ id, name, category: "iFood", active: false });
const DO_CARDAPIO = (id: string, name: string) => ({ id, name, category: "X", active: true });

console.log("\n5) O item baixa estoque? (a mesma sequência de deductStockForOrder)");
confere("ficha própria", fichaDoItem({ quantity: 1, price: 1, menuProductId: "pc", menuProduct: DO_CARDAPIO("pc", "Pizza Calabresa") }, L, FICHAS), "propria");
confere("espelho do iFood pega a ficha do produto de mesmo nome (sem ligar maiúscula)",
  fichaDoItem({ quantity: 1, price: 1, menuProductId: "ifood-1", menuProduct: ESPELHO("ifood-1", "PIZZA CALABRESA") }, L, FICHAS), "peloNome");
confere("mas o nome é da loja: na loja 2 não há Pizza Calabresa",
  fichaDoItem({ quantity: 1, price: 1, menuProductId: "ifood-1", menuProduct: ESPELHO("ifood-1", "Pizza Calabresa") }, L2, FICHAS), "sem");
confere("nunca pelo nome de outro espelho (ifood-…) com ficha",
  fichaDoItem({ quantity: 1, price: 1, menuProductId: "ifood-2", menuProduct: ESPELHO("ifood-2", "X-Salada") }, L, FICHAS), "sem");
confere("combo sem ficha própria: baixa pelas opções escolhidas que têm ficha",
  fichaDoItem({ quantity: 1, price: 1, menuProductId: "combo", menuProduct: DO_CARDAPIO("combo", "Combo 2 Esfihas"), comboSelections: '[{"name":"Esfiha de Carne","quantity":2}]' }, L, FICHAS), "opcoes");
confere("combo com opção SEM ficha não baixa nada",
  fichaDoItem({ quantity: 1, price: 1, menuProductId: "combo", menuProduct: DO_CARDAPIO("combo", "Combo 2 Esfihas"), comboSelections: { g1: { "Esfiha de Palmito": 2 } } }, L, FICHAS), "sem");

// ── O período: 19 e 20/09 ──
// ped-1 site · ped-2 iFood (espelho) · ped-3 cancelado · ped-4 editado (devolve e baixa de novo)
// ped-5 fora do filtro · ped-6 mesa · ped-7 apagado · ped-8 loja 2 · ped-9 madrugada
const MOVIMENTOS: MovimentoDeEstoque[] = [
  baixa("ped-1", "mus", 200), baixa("ped-1", "cal", 150),
  baixa("ped-2", "mus", 100),
  baixa("ped-3", "mus", 300, undefined, false), devolucao("ped-3", "mus", 300),
  baixa("ped-4", "mus", 300, "2026-09-19T18:00:00Z", false), devolucao("ped-4", "mus", 300, "2026-09-19T18:10:00Z"), baixa("ped-4", "mus", 200, "2026-09-19T18:10:01Z"),
  baixa("ped-5", "coca-i", 1),
  baixa("ped-6", "mas", 10), baixa("ped-6", "coca-i", 2), baixa("ped-6", "ore", 5),
  baixa("ped-7", "mus", 50),
  baixa("ped-8", "mus2", 100, "2026-09-20T15:00:00Z"),
  // 01:30 de 20/09 em São Paulo: ainda é o expediente de 19/09.
  baixa("ped-9", "cal", 50, "2026-09-20T04:30:00Z"),
  // Entrada de nota e perda no mesmo período: não são venda.
  { stockItemId: "mus", type: "INPUT", quantity: 5000, notes: "Entrada NF 1234", sourceRef: null, createdAt: "2026-09-19T12:00:00Z" },
  { stockItemId: "mus", type: "WASTE", quantity: -20, notes: "Caiu no chão", sourceRef: null, createdAt: "2026-09-19T12:00:00Z" },
];
// Só os pedidos que NÃO são venda do período precisam de situação: os vendidos
// são os de `vendas`. O ped-7 (apagado) não tem nenhuma.
const SITUACAO = new Map<string, SituacaoDoPedido>([["ped-3", "cancelado"], ["ped-5", "foraDoFiltro"]]);

const pedido = (id: string, canal: string, totalAmount: number, items: PedidoVendido["items"], createdAt = "2026-09-19T17:55:00Z", franchiseeId = L): PedidoVendido =>
  ({ id, franchiseeId, canal, totalAmount, createdAt, items });
const VENDAS: PedidoVendido[] = [
  pedido("ped-1", "SITE", 60, [{ quantity: 1, price: 55, menuProductId: "pc", menuProduct: DO_CARDAPIO("pc", "Pizza Calabresa") }]),
  pedido("ped-2", "IFOOD", 45, [{ quantity: 1, price: 40, menuProductId: "ifood-1", menuProduct: ESPELHO("ifood-1", "Pizza Calabresa") }]),
  pedido("ped-4", "PDV", 30, [{ quantity: 1, price: 30, menuProductId: "combo", menuProduct: DO_CARDAPIO("combo", "Combo 2 Esfihas"), comboSelections: [{ name: "Esfiha de Carne", quantity: 2 }] }]),
  // Mesa: o totalAmount do lançamento (os itens). Os 10% e a gorjeta moram na
  // TableSession e ficam FORA do faturamento do CMV.
  pedido("ped-6", "MESA", 20, [
    { quantity: 1, price: 8, menuProductId: "eq", menuProduct: DO_CARDAPIO("eq", "Esfiha de Queijo") },
    { quantity: 2, price: 6, menuProductId: "coca", menuProduct: DO_CARDAPIO("coca", "Coca lata") },
  ]),
  pedido("ped-8", "SITE", 50, [{ quantity: 1, price: 50, menuProductId: "pm2", menuProduct: DO_CARDAPIO("pm2", "Pizza Mussarela") }], "2026-09-20T14:58:00Z", L2),
  pedido("ped-9", "SITE", 25, [{ quantity: 1, price: 25, menuProductId: "pcb", menuProduct: DO_CARDAPIO("pcb", "Pizza Calabresa Broto") }], "2026-09-20T04:28:00Z"),
  // Sem ficha nenhuma:
  pedido("ped-10", "IFOOD", 70, [{ quantity: 2, price: 35, menuProductId: "ifood-9", menuProduct: ESPELHO("ifood-9", "GRANDE 2 SABORES") }]),
  pedido("ped-11", "PDV", 18, [
    { quantity: 1, price: 12, menuProductId: "gua", menuProduct: DO_CARDAPIO("gua", "Guaraná 2L") },
    { quantity: 1, price: 6, menuProductId: "bat", menuProduct: DO_CARDAPIO("bat", "Batata frita") },
  ]),
  // Tem item com ficha (a pizza, pelo nome) e NÃO baixou: ficha cadastrada depois da venda.
  pedido("ped-12", "IFOOD", 30, [
    { quantity: 1, price: 12, menuProductId: "ifood-8", menuProduct: ESPELHO("ifood-8", "Guaraná 2L") },
    { quantity: 1, price: 18, menuProductId: "ifood-1", menuProduct: ESPELHO("ifood-1", "Pizza Calabresa") },
  ]),
  pedido("ped-13", "PDV", 30, [{ quantity: 1, price: 30, menuProductId: "combo", menuProduct: DO_CARDAPIO("combo", "Combo 2 Esfihas"), comboSelections: { g1: { "Esfiha de Palmito": 2 } } }]),
];

const r = itensConsumidos({
  movimentos: MOVIMENTOS, insumos: INSUMOS, situacaoDe: SITUACAO, vendas: VENDAS, fichas: FICHAS, tz: TZ,
  periodo: { de: "2026-09-19", ate: "2026-09-21" },
});
const linha = (nome: string) => r.insumos.find((i) => i.nome === nome);

console.log("\n6) O consumo pelas baixas");
confere("ordem pelo custo; orégano sem custo por último",
  r.insumos.map((i) => [i.nome, i.quantidade, i.custo]),
  [["Mussarela", 600, 31], ["Calabresa", 200, 8], ["Coca lata", 2, 6.4], ["Massa de esfiha", 10, 3], ["Orégano", 5, null]]);
confere("mussarela = 200 (site) + 100 (iFood) + 200 (a versão editada) + 100 (loja 2); o cancelado e o apagado ficam fora",
  linha("Mussarela")?.quantidade, 600);
confere("a mesma mussarela de duas lojas ('g' e 'G') numa linha, com o custo médio ponderado (31 ÷ 600)",
  [linha("Mussarela")?.unidade, linha("Mussarela")?.custoUnitario, linha("Mussarela")?.pedidos], ["g", 0.0517, 4]);
confere("custo unitário de uma loja só é o do cadastro", linha("Calabresa")?.custoUnitario, 0.04);
confere("a Coca do pedido fora do filtro não entra; a da mesa entra", linha("Coca lata")?.quantidade, 2);
confere("total: só o que tem custo; um insumo sem custo avisado", r.total, { custo: 48.4, insumos: 5, insumosSemCusto: 1, pedidosComBaixa: 6 });
confere("% do custo (31 ÷ 48,40)", linha("Mussarela")?.pct, 64.05);
confere("o que não entrou, em pedidos", r.foraDaConta, { cancelados: 1, foraDaVenda: 0, antesDoPeriodo: 0, foraDosFiltros: 1, semPedido: 1 });

console.log("\n7) O consumo conta no dia do PEDIDO, com as correções que chegam depois");
// Pedido do dia 19 (baixa 300 g) editado no dia 20: devolve 300 g e baixa 100 g.
const EDITADO = [
  baixa("ped-e", "mus", 300, "2026-09-19T18:00:05Z", false),
  devolucao("ped-e", "mus", 300, "2026-09-20T18:00:00Z"), baixa("ped-e", "mus", 100, "2026-09-20T18:00:01Z"),
];
const pedidoEditado = pedido("ped-e", "PDV", 50, [{ quantity: 1, price: 50, menuProductId: "pc", menuProduct: DO_CARDAPIO("pc", "Pizza Calabresa") }], "2026-09-19T18:00:00Z");
const dia19 = itensConsumidos({
  movimentos: EDITADO, insumos: INSUMOS, situacaoDe: new Map(), vendas: [pedidoEditado], fichas: FICHAS, tz: TZ, periodo: { de: "2026-09-19", ate: "2026-09-19" },
});
confere("relatório do dia 19 (a edição do dia 20 lida na folga): a versão que valeu, 100 g, no dia do pedido",
  [dia19.insumos.map((i) => [i.nome, i.quantidade, i.custo]), dia19.porDia], [[["Mussarela", 100, 5]], [{ dia: "2026-09-19", custo: 5, faturamento: 50, cmvPct: 10 }]]);
const dia20 = itensConsumidos({
  movimentos: EDITADO.slice(1), insumos: INSUMOS, situacaoDe: new Map([["ped-e", "antesDoPeriodo"]]), fichas: FICHAS, tz: TZ,
  vendas: [pedido("ped-f", "PDV", 50, [], "2026-09-20T18:00:00Z")], periodo: { de: "2026-09-20", ate: "2026-09-20" },
});
confere("relatório do dia 20: sem mussarela −200 g nem custo negativo — a edição é do pedido do dia 19",
  [dia20.insumos, dia20.total.custo, dia20.cmv.sobreFaturamento, dia20.porDia, dia20.foraDaConta.antesDoPeriodo],
  [[], 0, null, [{ dia: "2026-09-20", custo: 0, faturamento: 50, cmvPct: null }], 1]);
const devolucaoSemBaixa = itensConsumidos({
  movimentos: [devolucao("ped-e", "mus", 300, "2026-09-19T19:00:00Z")], insumos: INSUMOS, situacaoDe: new Map(), vendas: [pedidoEditado], fichas: FICHAS, tz: TZ,
});
confere("devolução sem a baixa que ela desfaz não vira consumo negativo", [devolucaoSemBaixa.insumos, devolucaoSemBaixa.total.custo], [[], 0]);
const madrugada = itensConsumidos({
  movimentos: [baixa("ped-m", "mus", 100, "2026-09-20T08:02:00Z")], insumos: INSUMOS, situacaoDe: new Map(), fichas: FICHAS, tz: TZ,
  vendas: [pedido("ped-m", "SITE", 50, [{ quantity: 1, price: 50, menuProductId: "pc", menuProduct: DO_CARDAPIO("pc", "Pizza Calabresa") }], "2026-09-20T07:58:00Z")],
  periodo: { de: "2026-09-19", ate: "2026-09-20" },
});
confere("pedido das 4h58 aceito às 5h02: custo e faturamento no mesmo dia (o do pedido)",
  madrugada.porDia, [{ dia: "2026-09-19", custo: 5, faturamento: 50, cmvPct: 10 }, { dia: "2026-09-20", custo: 0, faturamento: 0, cmvPct: null }]);
const cancelado = itensConsumidos({ movimentos: [baixa("ped-3", "mus", 300, undefined, false)], insumos: INSUMOS, situacaoDe: SITUACAO, vendas: [], fichas: FICHAS, tz: TZ });
confere("cancelado amanhã: a baixa de hoje já sai do relatório de hoje (pelo status)", [cancelado.insumos.length, cancelado.foraDaConta.cancelados], [0, 1]);

console.log("\n8) Vendas, cobertura pela baixa e CMV");
confere("faturamento = Σ totalAmount (mesa pelo lançamento); total dos itens; o que baixou; o que tem ficha e não baixou",
  [r.vendas.pedidos, r.vendas.faturamento, r.vendas.totalDosItens, r.vendas.valorComBaixa, r.vendas.valorComFichaSemBaixa], [10, 378, 368, 220, 18]);
confere("as três partes fecham o total dos itens (220 + 18 + 130 = 368)",
  r.vendas.valorComBaixa + r.vendas.valorComFichaSemBaixa + r.semFicha.valor, r.vendas.totalDosItens);
confere("cobertura: 220 de 368 dos itens baixaram estoque", r.vendas.coberturaPct, 59.78);
confere("CMV sobre o faturamento, sobre os itens e sobre o que baixou", r.cmv, { sobreFaturamento: 12.8, sobreItens: 13.15, sobreItensComBaixa: 22 });
confere("pedido com item de ficha e sem baixa (ficha cadastrada depois da venda)",
  [r.vendas.pedidosComFichaSemBaixa, r.vendas.pedidosComBaixaSemFichaHoje], [1, 0]);

console.log("\n9) A cobertura sai da baixa, não do cadastro de hoje");
// A Esfiha de Carne vendeu segunda, terça e quarta (R$ 50 cada); a ficha foi
// cadastrada na quarta e só a venda de quarta baixou (100 g × R$ 0,05).
const esfiha = (id: string, dia: string) => pedido(id, "PDV", 50, [{ quantity: 1, price: 50, menuProductId: "ec", menuProduct: DO_CARDAPIO("ec", "Esfiha de Carne") }], `${dia}T18:00:00Z`);
const TRES_DIAS = [esfiha("seg", "2026-09-21"), esfiha("ter", "2026-09-22"), esfiha("qua", "2026-09-23")];
const adocao = itensConsumidos({
  movimentos: [baixa("qua", "car", 100, "2026-09-23T18:00:05Z")], insumos: INSUMOS, situacaoDe: new Map(), vendas: TRES_DIAS, fichas: FICHAS, tz: TZ,
});
confere("adotando a ficha: as vendas de antes do cadastro não entram na base (cobertura 33%, CMV das vendas com baixa 10%, não 3,33%)",
  [adocao.vendas.valorComBaixa, adocao.vendas.valorComFichaSemBaixa, adocao.vendas.coberturaPct, adocao.cmv.sobreItensComBaixa, adocao.vendas.pedidosComFichaSemBaixa],
  [50, 100, 33.33, 10, 2]);
const semFichaHoje = montarFichas([ativo("ec", "Esfiha de Carne", "Esfihas")], [], []);
const fichaApagada = itensConsumidos({
  movimentos: TRES_DIAS.map((p) => baixa(p.id, "car", 100, String(p.createdAt).replace(":00Z", ":05Z"))),
  insumos: INSUMOS, situacaoDe: new Map(), vendas: TRES_DIAS, fichas: semFichaHoje, tz: TZ,
});
confere("ficha apagada depois das vendas: o custo das baixas fica e o valor também (e o produto não vai para 'sem ficha')",
  [fichaApagada.total.custo, fichaApagada.vendas.valorComBaixa, fichaApagada.vendas.coberturaPct, fichaApagada.cmv.sobreItensComBaixa,
    fichaApagada.semFicha.produtos.length, fichaApagada.vendas.pedidosComBaixaSemFichaHoje],
  [15, 150, 100, 10, 0, 3]);
const misto = itensConsumidos({
  movimentos: [baixa("pz", "cal", 150)], insumos: INSUMOS, situacaoDe: new Map(), fichas: FICHAS, tz: TZ,
  vendas: [pedido("pz", "PDV", 67, [
    { quantity: 1, price: 55, menuProductId: "pc", menuProduct: DO_CARDAPIO("pc", "Pizza Calabresa") },
    { quantity: 1, price: 12, menuProductId: "gua", menuProduct: DO_CARDAPIO("gua", "Guaraná 2L") },
  ])],
});
confere("pedido que baixou com um item sem ficha: a pizza é base do CMV, o guaraná vai para a lista",
  [misto.vendas.valorComBaixa, misto.semFicha.produtos.map((p) => [p.nome, p.valor]), misto.vendas.pedidosComBaixaSemFichaHoje], [55, [["Guaraná 2L", 12]], 0]);
const semVenda = itensConsumidos({ movimentos: [], insumos: INSUMOS, situacaoDe: new Map(), vendas: [], fichas: FICHAS, tz: TZ });
confere("sem venda no período, a cobertura não é '0%' (não há o que cobrir)", [semVenda.vendas.coberturaPct, semVenda.cmv.sobreItensComBaixa], [null, null]);

console.log("\n10) Os mais vendidos sem ficha técnica");
confere("ordem pela quantidade, desempate pelo valor",
  r.semFicha.produtos.map((p) => [p.nome, p.quantidade, p.valor]),
  [["GRANDE 2 SABORES", 2, 70], ["Guaraná 2L", 2, 24], ["Combo 2 Esfihas", 1, 30], ["Batata frita", 1, 6]]);
const grande = r.semFicha.produtos[0];
confere("o do iFood sem produto de mesmo nome no cardápio: a baixa não tem onde achar ficha",
  [grande.origem, grande.temNoCardapio, grande.canais, grande.produtoId], ["integracao", false, ["IFOOD"], null]);
const guarana = r.semFicha.produtos[1];
confere("o Guaraná do balcão e do iFood numa linha, com os dois canais", [guarana.origem, guarana.canais, guarana.produtoId], ["cardapio", ["IFOOD", "PDV"], "gua"]);
confere("total sem ficha", [r.semFicha.quantidade, r.semFicha.valor], [6, 130]);
confere("o combo sem ficha é marcado como produto com opções (a ficha vai também nas opções)",
  r.semFicha.produtos.map((p) => [p.nome, p.temOpcoes]), [["GRANDE 2 SABORES", false], ["Guaraná 2L", false], ["Combo 2 Esfihas", true], ["Batata frita", false]]);
confere("o conselho de cada linha segue o caminho da baixa",
  r.semFicha.produtos.map((p) => [p.nome, p.alerta, p.oQueFazer.split(":")[0]]),
  [["GRANDE 2 SABORES", true, "Nenhum produto ativo do cardápio tem este nome"],
   ["Guaraná 2L", false, "Cadastre a ficha técnica deste produto."],
   ["Combo 2 Esfihas", false, "Tem opções"],
   ["Batata frita", false, "Cadastre a ficha técnica deste produto."]]);
const comboDoIfood = itensConsumidos({
  movimentos: [], insumos: [], situacaoDe: new Map(), fichas: FICHAS, tz: TZ,
  vendas: [pedido("z1", "IFOOD", 30, [{ quantity: 1, price: 30, menuProductId: "ifood-c", menuProduct: ESPELHO("ifood-c", "Combo 2 Esfihas"), comboSelections: [{ name: "Esfiha de Carne", quantity: 2 }] }])],
}).semFicha.produtos[0];
confere("combo do iFood: acha a ficha do combo pelo nome, mas as esfihas escolhidas lá não baixam (alerta)",
  [comboDoIfood.origem, comboDoIfood.temNoCardapio, comboDoIfood.temOpcoes, comboDoIfood.alerta, comboDoIfood.oQueFazer],
  ["integracao", true, true, true, "A baixa usa a ficha do produto de mesmo nome do cardápio, e só a dele: as opções escolhidas no parceiro não baixam."]);
const doisCanais = itensConsumidos({
  movimentos: [], insumos: [], situacaoDe: new Map(), fichas: FICHAS, tz: TZ,
  vendas: [
    pedido("x1", "IFOOD", 12, [{ quantity: 1, price: 12, menuProductId: "ifood-8", menuProduct: ESPELHO("ifood-8", "GUARANÁ 2L") }]),
    pedido("x2", "PDV", 12, [{ quantity: 1, price: 12, menuProductId: "gua", menuProduct: DO_CARDAPIO("gua", "Guaraná 2L") }]),
  ],
});
confere("vendido primeiro pelo iFood e depois no balcão: a linha aponta para o produto do cardápio, com o nome dele",
  doisCanais.semFicha.produtos.map((p) => [p.nome, p.origem, p.produtoId, p.temNoCardapio, p.quantidade]), [["Guaraná 2L", "cardapio", "gua", true, 2]]);
const doisNomes = itensConsumidos({
  movimentos: [], insumos: [], situacaoDe: new Map(), tz: TZ,
  fichas: montarFichas([ativo("g6", "6 Esfihas + Guaraná", "Combos")], [], []),
  vendas: [
    pedido("y1", "WABIZ", 50, [{ quantity: 1, price: 50, menuProductId: "wabiz-g6", menuProduct: ESPELHO("wabiz-g6", "6 Esfihas + Guaraná") }]),
    pedido("y2", "IFOOD", 60, [{ quantity: 1, price: 60, menuProductId: "ifood-g6", menuProduct: ESPELHO("ifood-g6", "6 Esfihas + Guaraná por R$59,90") }]),
  ],
});
confere("nomes que a baixa não junta ficam em linhas separadas: só o da Wabiz tem produto de mesmo nome (NIK, 17 a 23/09)",
  doisNomes.semFicha.produtos.map((p) => [p.nome, p.temNoCardapio]), [["6 Esfihas + Guaraná por R$59,90", false], ["6 Esfihas + Guaraná", true]]);

console.log("\n11) Por dia operacional");
confere("o pedido da 01:28 de 20/09 é do dia 19; o dia sem nada aparece zerado",
  r.porDia, [
    { dia: "2026-09-19", custo: 42.4, faturamento: 328, cmvPct: 12.93 },
    { dia: "2026-09-20", custo: 6, faturamento: 50, cmvPct: 12 },
    { dia: "2026-09-21", custo: 0, faturamento: 0, cmvPct: null },
  ]);

console.log("\n12) Nada cadastrado (a realidade de hoje na maioria das lojas)");
const nada = itensConsumidos({ movimentos: [], insumos: [], situacaoDe: new Map(), vendas: VENDAS.slice(6, 8), fichas: montarFichas([], [], []), tz: TZ });
confere("sem consumo não há CMV (nem 0%); com venda e sem baixa, a cobertura é 0% de verdade; tudo vai para a lista de cadastrar",
  [nada.total.custo, nada.cmv, nada.vendas.coberturaPct, nada.semFicha.produtos.length],
  [0, { sobreFaturamento: null, sobreItens: null, sobreItensComBaixa: null }, 0, 3]);

console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
