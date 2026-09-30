/**
 * Trava o preço das opções no relatório de vendas (lib/itens-do-relatorio.ts)
 * e a conta dos cartões (lib/soma-do-relatorio.ts): quantas bordas e quanto
 * elas arrecadaram, em qualquer loja e em qualquer canal.
 *
 *   npx tsx scripts/teste-itens-do-relatorio.ts
 *
 * O cadastro abaixo imita o da NIK em 23/09/2026: a pizza tem um grupo
 * "Bordas" com o preço de cada borda, e as bordas são complementos de preço
 * zero. O balcão não grava o preço da opção no pedido; o iFood grava.
 */
import { montarMapasDoRelatorio, opcoesDoItem, categoriaDoItem, categoriaDoProduto, escolhasDoItem } from "../src/lib/itens-do-relatorio";
import { somarVendas, itensVendidosPorCategoria } from "../src/lib/soma-do-relatorio";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

const LOJA = "loja1";
const borda = (id: string, name: string) => ({ id, franchiseeId: LOJA, name, category: "Bordas", price: 0, cost: 1, active: true });
const PRODUTOS = [
  {
    id: "pizza", franchiseeId: LOJA, name: "Pizza Calabresa", category: "Pizzas Tradicionais", price: 56.9, cost: 20, active: true,
    comboGroups: [{
      items: [
        { menuProductId: "cat", additionalPrice: 12, additionalPriceSalao: null, additionalPriceDelivery: 15, additionalPriceTotem: null },
        { menuProductId: "choc", additionalPrice: 13, additionalPriceSalao: 10, additionalPriceDelivery: null, additionalPriceTotem: null },
        { menuProductId: "trad", additionalPrice: 0 },
      ],
    }],
  },
  borda("cat", "Borda de Catupiry"),
  borda("choc", "Borda de Chocolate"),
  borda("trad", "Borda tradicional"),
];
const mapas = montarMapasDoRelatorio(PRODUTOS as any)(LOJA);
const PIZZA = { id: "pizza", name: "Pizza Calabresa", category: "Pizzas Tradicionais", active: true };

const precos = (item: any, canal: string) => opcoesDoItem(item, mapas, canal).map((o) => [o.nome, o.quantidade, o.preco]);

console.log("\n1) O canal que MANDA o preço (iFood): vale como veio");
confere("Borda Catupiry a R$ 14 no iFood",
  precos({ quantity: 1, menuProduct: { id: "ifood-x", name: "GRANDE", category: "iFood" },
    comboSelections: JSON.stringify([{ name: "Massa Tradicional + Borda Catupiry", quantity: 1, price: 14 }]) }, "IFOOD"),
  [["Borda de Catupiry", 1, 14]]);
confere("borda tradicional com preço ZERO é grátis, não cai no cadastro",
  precos({ quantity: 1, menuProduct: PIZZA,
    comboSelections: JSON.stringify([{ name: "Massa Tradicional + Borda Tradicional", quantity: 1, price: 0 }]) }, "IFOOD"),
  [["Borda tradicional", 1, 0]]);

console.log("\n2) O canal que NÃO guarda o preço: o do cadastro, na coluna do canal");
confere("balcão: salão vazio → additionalPrice 12",
  precos({ quantity: 1, menuProduct: PIZZA, comboSelections: JSON.stringify([{ name: "Borda de Catupiry", quantity: 1 }]) }, "PDV"),
  [["Borda de Catupiry", 1, 12]]);
confere("balcão: salão preenchido → 10",
  precos({ quantity: 1, menuProduct: PIZZA, comboSelections: JSON.stringify([{ name: "Borda de Chocolate", quantity: 1 }]) }, "PDV"),
  [["Borda de Chocolate", 1, 10]]);
confere("site: coluna delivery → 15",
  precos({ quantity: 1, menuProduct: PIZZA, comboSelections: { g1: { "Borda de Catupiry": 1 } } }, "SITE"),
  [["Borda de Catupiry", 1, 15]]);
confere("mesa usa o salão, como o balcão",
  precos({ quantity: 1, menuProduct: PIZZA, comboSelections: JSON.stringify([{ name: "Borda de Chocolate", quantity: 1 }]) }, "MESA"),
  [["Borda de Chocolate", 1, 10]]);
confere("2 pizzas com borda = 2 bordas",
  precos({ quantity: 2, menuProduct: PIZZA, comboSelections: JSON.stringify([{ name: "Borda de Catupiry", quantity: 1 }]) }, "PDV"),
  [["Borda de Catupiry", 2, 12]]);
confere("produto sem a borda no grupo e canal sem preço: não inventa",
  precos({ quantity: 1, menuProduct: { id: "outro", name: "Outro", category: "X", active: true },
    comboSelections: JSON.stringify([{ name: "Borda de Catupiry", quantity: 1 }]) }, "PDV"),
  [["Borda de Catupiry", 1, null]]);

console.log("\n3) A conta dos cartões: quantidade e valor arrecadado");
const item = (preco: number, qtd: number, opcoes: any[]) => ({
  productId: "pizza", productCategory: "Pizzas Tradicionais", quantity: qtd, price: preco, productCost: 20, opcoes,
});
const PEDIDOS = [
  // iFood: pizza 83,90 já com a borda de 14 dentro.
  { id: "p1", items: [item(83.9, 1, opcoesDoItem({ quantity: 1, menuProduct: PIZZA,
    comboSelections: JSON.stringify([{ name: "Massa Tradicional + Borda Catupiry", quantity: 1, price: 14 }]) }, mapas, "IFOOD"))] },
  // iFood: borda tradicional grátis.
  { id: "p2", items: [item(69.9, 1, opcoesDoItem({ quantity: 1, menuProduct: PIZZA,
    comboSelections: JSON.stringify([{ name: "Massa Tradicional + Borda Tradicional", quantity: 1, price: 0 }]) }, mapas, "IFOOD"))] },
  // Balcão: pizza 74,90 com a borda de 12 do cadastro dentro.
  { id: "p3", items: [item(74.9, 1, opcoesDoItem({ quantity: 1, menuProduct: PIZZA,
    comboSelections: JSON.stringify([{ name: "Borda de Catupiry", quantity: 1 }]) }, mapas, "PDV"))] },
];
const so = (cats: string[]) => ({ produtos: new Set<string>(), categorias: new Set(cats) });
const bordas = somarVendas(PEDIDOS as any, so(["Bordas"]));
confere("só Bordas: 3 bordas, R$ 26 arrecadados (14 + 0 + 12)", [bordas.unidades, bordas.receita, bordas.pedidos], [3, 26, 3]);
const semFiltro = somarVendas(PEDIDOS as any, so([]));
confere("sem filtro: o de sempre, só os itens (3 pizzas, 228,70)", [semFiltro.unidades, Math.round(semFiltro.receita * 100) / 100], [3, 228.7]);
const juntas = somarVendas(PEDIDOS as any, so(["Pizzas Tradicionais", "Bordas"]));
confere("Pizzas + Bordas: a borda conta na quantidade, o dinheiro não dobra",
  [juntas.unidades, Math.round(juntas.receita * 100) / 100], [6, 228.7]);

console.log("\n4) A categoria do item");
confere("categoria de produto real", categoriaDoItem({ quantity: 1, menuProduct: PIZZA }, mapas), "Pizzas Tradicionais");

// O cadastro da Brazza Burguer em 23/09/2026: a única coisa em "Adicionais" é
// a batata carregada, que só existe dentro de combo.
const BRAZZA = montarMapasDoRelatorio([
  { id: "bm", franchiseeId: "b", name: "Batata Maluca M", category: "Adicionais", price: 0, cost: 0, active: true, apenasEmCombo: true },
  { id: "ec", franchiseeId: "b", name: "Esfiha Calabresa", category: "Esfihas Tradicionais", price: 5.9, cost: 1, active: true },
  { id: "ef", franchiseeId: "b", name: "Esfiha Frango", category: "Esfihas Tradicionais", price: 5.9, cost: 1, active: true },
  { id: "xb", franchiseeId: "b", name: "X-Bacon", category: "Burgers", price: 29.9, cost: 9, active: true },
] as any)("b");
const espelho99 = (nome: string) => ({ id: "99food_1", name: nome, category: "99Food", active: false });
confere("combo do 99 cuja única opção reconhecida é a batata: NÃO vira Adicionais",
  categoriaDoItem({ quantity: 1, productName: "Burguer + Batata P  + Guaravita", menuProduct: espelho99("Burguer + Batata P  + Guaravita"),
    comboSelections: JSON.stringify([
      { name: "Brazza", quantity: 1, price: 19.9 },
      { name: "Batata Maluca M ( ~250g) cheddar, Catupiry e Bacon", quantity: 1, price: 19.9 },
      { name: "Refrigerante Guaravita Original", quantity: 1, price: 0 },
    ]) }, BRAZZA),
  "Outros");
confere("combo cujas opções são produtos de verdade (esfihas): vale a categoria delas",
  categoriaDoItem({ quantity: 1, productName: "Combo 1", menuProduct: espelho99("Combo 1"),
    comboSelections: JSON.stringify([{ name: "Esfiha Calabresa", quantity: 2 }, { name: "Esfiha Frango", quantity: 1 }]) }, BRAZZA),
  "Esfihas Tradicionais");
confere("item de plataforma com o nome do cadastro: a categoria do cadastro",
  categoriaDoItem({ quantity: 1, productName: "X-Bacon", menuProduct: espelho99("X-Bacon") }, BRAZZA),
  "Burgers");

// O cadastro da NIK em 24/09/2026: a pizza inteira "Pizza Portuguesa" e o
// SABOR "Portuguesa" (preço zero, só dentro do combo). A Wabiz manda a pizza
// inteira só com o nome do sabor.
console.log("\n5) A pizza inteira com nome de sabor");
const NIK = montarMapasDoRelatorio([
  { id: "pp", franchiseeId: "n", name: "Pizza Portuguesa", category: "Pizzas Tradicionais", price: 57.9, cost: 0, active: true,
    comboGroups: [{ items: [{ menuProductId: "sp", additionalPrice: 0 }] }] },
  { id: "sp", franchiseeId: "n", name: "Portuguesa", category: "Sabores de Pizza", price: 0, cost: 0, active: true, apenasEmCombo: true },
  { id: "wabiz-n-1", franchiseeId: "n", name: "Portuguesa", category: "Pizzas Grande", price: 57.9, cost: 0, active: false },
] as any)("n");
const espelhoWabiz = { id: "wabiz-n-1", name: "Portuguesa", category: "Pizzas Grande", active: false };
confere("Portuguesa da Wabiz (R$ 57,90) é pizza, não sabor",
  categoriaDoItem({ quantity: 1, productName: "Portuguesa", menuProduct: espelhoWabiz }, NIK),
  "Pizzas Tradicionais");
confere("a linha do espelho no ranking também",
  categoriaDoProduto(espelhoWabiz as any, NIK).categoria,
  "Pizzas Tradicionais");
confere("o sabor escolhido dentro da pizza continua contando em Sabores de Pizza",
  opcoesDoItem({ quantity: 1, menuProduct: { id: "ifood-x", name: "GRANDE 2 SABORES", category: "iFood" },
    comboSelections: JSON.stringify([{ name: "1/2 Portuguesa", quantity: 1, price: 29.95 }]) }, NIK, "IFOOD")
    .map((o) => [o.nome, o.categoria, o.quantidade]),
  [["Portuguesa", "Sabores de Pizza", 1]]);

console.log("\n6) Itens vendidos: categoria → produto → escolhas");
confere("escolhas somam pelo nome, a meia é o mesmo sabor, multiplicadas pelo item",
  escolhasDoItem({ quantity: 2, comboSelections: JSON.stringify([
    { name: "1/2 Portuguesa", quantity: 1, price: 29.95 }, { name: "1/2 Calabresa", quantity: 1 }, { name: "Borda Catupiry", quantity: 1 },
  ]) }),
  [["Portuguesa", 2], ["Calabresa", 2], ["Borda Catupiry", 2]]);
const arvore = itensVendidosPorCategoria([
  { items: [
    { productId: "g", productName: "PIZZA GRANDE", productCategory: "Pizzas", quantity: 1, price: 59.9, productCost: 0,
      escolhas: [["Portuguesa", 1], ["Calabresa", 1]] },
    { productId: "g", productName: "PIZZA GRANDE", productCategory: "Pizzas", quantity: 1, price: 69.9, productCost: 0,
      escolhas: [["Calabresa", 1], ["Borda Catupiry", 1]] },
    { productId: "c", productName: "Coca 2L", productCategory: "Bebidas", quantity: 3, price: 14, productCost: 0 },
  ] },
] as any, so([]));
confere("categorias por quantidade, valor só no produto",
  arvore.categorias.map((c) => [c.categoria, c.quantidade, Math.round(c.valor * 100) / 100]),
  [["Bebidas", 3, 42], ["Pizzas", 2, 129.8]]);
confere("as escolhas dentro da pizza, da mais pedida para a menos",
  arvore.categorias[1].produtos[0].escolhas.map((e) => [e.nome, e.quantidade]),
  [["Calabresa", 2], ["Borda Catupiry", 1], ["Portuguesa", 1]]);
confere("o mesmo produto vindo de dois canais (ids diferentes) é uma linha só",
  itensVendidosPorCategoria([{ items: [
    { productId: "ifood-1", productName: "Combo 1", productCategory: "Combos Esfihas", quantity: 14, price: 31.9, productCost: 0 },
    { productId: "wabiz-1", productName: "Combo  1", productCategory: "Combos Esfihas", quantity: 8, price: 31.9, productCost: 0 },
  ] }] as any, so([])).categorias[0].produtos.map((p) => [p.nome, p.quantidade]),
  [["Combo 1", 22]]);
confere("filtro de categoria vale para o item",
  itensVendidosPorCategoria([{ items: [
    { productId: "c", productName: "Coca 2L", productCategory: "Bebidas", quantity: 3, price: 14, productCost: 0 },
  ] }] as any, so(["Pizzas"])).quantidade,
  0);

console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
