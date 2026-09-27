/**
 * A opção escolhida dentro do combo sai na impressora da categoria DELA
 * (lib/categoria-do-item.ts → opcoesComCategoria; lib/roteamento-de-impressao.ts).
 *
 *   npx tsx scripts/teste-opcao-do-combo-na-impressora.ts
 *
 * O caso da Ragnar (27/09/2026): "Combo Heimdall" é da categoria Combos
 * (cozinha do burger), e o cliente escolheu dentro dele "Suco de Morango
 * Natural 500Ml", produto da categoria Sucos — que sai na COZINHA PIZZA, onde
 * fica quem faz o suco. Antes, o suco só aparecia no papel do burger.
 */
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://127.0.0.1:5432/nao-existe";
import { montarMapa, opcoesComCategoria } from "../src/lib/categoria-do-item";
import { destinosDoPedido, itensDaImpressora, categoriasPedidas } from "../src/lib/roteamento-de-impressao";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

// O cardápio da Ragnar, na parte que importa.
const mapa = montarMapa([
  { id: "p1", name: "Combo Heimdall", category: "Combos", active: true },
  { id: "p2", name: "Batata Frita", category: "Entradas", active: true },
  { id: "p3", name: "Suco de Morango Natural 500Ml", category: "Sucos", active: true },
  { id: "p4", name: "Purunn MilkShake de Oreo 300ml", category: "Sobremesas", active: true },
  { id: "p5", name: "Coca-Cola Lata 350ml", category: "Refrigerantes", active: true },
  { id: "ifood-x", name: "Suco de Morango Natural 500ml", category: "iFood", active: false },
]);

console.log("\n— As escolhas ganham a categoria do produto —");
const heimdall = {
  productName: "Combo Heimdall",
  menuProduct: { id: "p1", name: "Combo Heimdall", category: "Combos", active: true },
  comboSelections: [{ name: "Batata Frita", quantity: 1 }, { name: "Suco de Morango Natural 500Ml", quantity: 1 }],
};
confere("batata → Entradas, suco → Sucos", opcoesComCategoria(heimdall, mapa), [
  { name: "Batata Frita", quantity: 1, category: "Entradas" },
  { name: "Suco de Morango Natural 500Ml", quantity: 1, category: "Sucos" },
]);
confere(
  "formato do cardápio online ({ grupo: { nome: qtd } }) também",
  opcoesComCategoria({ comboSelections: { g1: { "Purunn MilkShake de Oreo 300ml": 2 } } }, mapa),
  [{ name: "Purunn MilkShake de Oreo 300ml", quantity: 2, category: "Sobremesas" }]
);
confere("escolha que não é produto (\"Bem passado\") fica de fora", opcoesComCategoria({ comboSelections: [{ name: "Bem passado", quantity: 1 }] }, mapa), []);
confere("item sem escolhas → nada", opcoesComCategoria({ comboSelections: null }, mapa), []);

console.log("\n— O roteamento da Ragnar com o Combo Heimdall —");
const RAGNAR = [
  { id: "balcao", name: "BALCÃO RAGNA", modulos: ["salao"], categories: ["Cerveja", "Entretenimento e Presentes"] },
  { id: "pizza", name: "COZINHA PIZZA", modulos: ["delivery", "salao"], categories: ["Pizzas Tradicionais", "Sucos", "Sobremesas", "Refrigerantes"] },
  { id: "burger", name: "COZINHA ENTREGA RAGNA", modulos: ["delivery", "salao"], categories: ["Burgers", "Entradas", "Combos", "Refrigerantes"] },
  { id: "bar", name: "BAR", modulos: ["salao", "delivery"], categories: ["Drinks", "Refrigerantes"] },
];
const pedido8 = {
  source: "PRESENCIAL",
  items: [
    { name: "Combo Heimdall", category: "Combos", quantity: 1, opcoesParaImpressao: opcoesComCategoria(heimdall, mapa) },
    { name: "Thor", category: "Burgers", quantity: 1 },
  ],
};
const papel = (p: any) =>
  destinosDoPedido(RAGNAR as any, p).map((d) => `${d.impressora.name}: ${d.itens.map((i: any) => `${i.quantity}x ${i.name}`).join(" | ")}`);
confere("pedido #8 (mesa 56): o combo inteiro na cozinha do burger E o suco na cozinha da pizza; BAR e BALCÃO nada", papel(pedido8), [
  "COZINHA PIZZA: 1x Suco de Morango Natural 500Ml  (do Combo Heimdall)",
  "COZINHA ENTREGA RAGNA: 1x Combo Heimdall | 1x Thor",
]);
confere(
  "2 combos com milkshake dentro: a sobremesa sai 2x na cozinha da pizza",
  papel({ source: "PRESENCIAL", items: [{ name: "Combo Heimdall", category: "Combos", quantity: 2, opcoesParaImpressao: [{ name: "Purunn MilkShake de Oreo 300ml", quantity: 1, category: "Sobremesas" }] }] }),
  ["COZINHA PIZZA: 2x Purunn MilkShake de Oreo 300ml  (do Combo Heimdall)", "COZINHA ENTREGA RAGNA: 2x Combo Heimdall"]
);
confere(
  "opção da MESMA cozinha do combo (batata) não vira linha extra: já está dentro do combo",
  papel({ source: "PRESENCIAL", items: [{ name: "Combo Heimdall", category: "Combos", quantity: 1, opcoesParaImpressao: [{ name: "Batata Frita", quantity: 1, category: "Entradas" }] }] }),
  ["COZINHA ENTREGA RAGNA: 1x Combo Heimdall"]
);
confere(
  "refrigerante do combo: sai também no BAR e na pizza (as duas listam Refrigerantes), como já sai o refrigerante avulso",
  papel({ source: "PRESENCIAL", items: [{ name: "Combo Heimdall", category: "Combos", quantity: 1, opcoesParaImpressao: [{ name: "Coca-Cola Lata 350ml", quantity: 1, category: "Refrigerantes" }] }] }),
  [
    "COZINHA PIZZA: 1x Coca-Cola Lata 350ml  (do Combo Heimdall)",
    "COZINHA ENTREGA RAGNA: 1x Combo Heimdall",
    "BAR: 1x Coca-Cola Lata 350ml  (do Combo Heimdall)",
  ]
);

console.log("\n— O embrulho do navegador (lib/print.ts) —");
const embrulho = {
  source: "PRESENCIAL",
  items: [
    { item: { name: "Combo Heimdall", qty: 3, price: 82, comboSelections: [{ name: "Suco de Morango Natural 500Ml", quantity: 1 }] }, category: "Combos", name: "Combo Heimdall", opcoesParaImpressao: [{ name: "Suco de Morango Natural 500Ml", quantity: 1, category: "Sucos" }] },
  ],
};
const pedidas = categoriasPedidas(RAGNAR as any, embrulho);
const naPizza = itensDaImpressora(RAGNAR[1] as any, embrulho as any, pedidas) as any[];
confere("a linha derivada leva o papel dentro de `item`, com qty 3 e sem escolhas", naPizza.map((w) => ({ name: w.item.name, qty: w.item.qty, price: w.item.price, sel: w.item.comboSelections })), [
  { name: "Suco de Morango Natural 500Ml  (do Combo Heimdall)", qty: 3, price: 0, sel: null },
]);

console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ tudo certo");
process.exit(falhas ? 1 : 0);
