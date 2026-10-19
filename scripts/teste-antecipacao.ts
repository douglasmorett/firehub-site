/**
 * Trava a conta da aba Antecipação (lib/antecipacao.ts) nos casos reais do
 * Hakim (pedidos de 11/10/2026) e na regra das 4 bases do Douglas (18/10/2026).
 *
 *   npx tsx scripts/teste-antecipacao.ts
 */
import { montarCatalogo, type ProdutoDoCatalogo } from "../src/lib/relatorios/catalogo";
import {
  baseDoHakim, contarDia, juntarNomesCurtos, lanchesDoPedido, preverBases, preverLinhas, FATOR_DO_FERIADO,
  type CatalogoDaAntecipacao, type PedidoDaAntecipacao,
} from "../src/lib/antecipacao";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

// ── As bases ──
const bases: [string, string | null][] = [
  ["Esfirra de Carne", "carne"],
  ["Esfirra de Carne c/ Mussarela", "carne"],
  ["Carne c/ Queijo", "carne"],
  ["Esfirra de Carne c/ Catupiry", "carne"],
  ["Esfirra de Calabresa com Mussarela", "calabresa"],
  ["Calabresa c/ Cheddar", "calabresa"],
  ["Esfirra de Queijo Temperado (Promo)", "queijo temperado"],
  ["Esfirra de Queijo", "mussarela"],
  ["Esfirra de 4 queijos", "mussarela"],
  ["Esfirra de Bacon c/ Catupiry", "mussarela"],
  ["Esfirra Peperoni c/ Catupiry", "mussarela"],
  ["Esfirra de Frango", "mussarela"],
  ["Esfirra de Banana Nevada", "doce"],
  ["Esfirra Duo", "doce"],
  ["Esfirra de M&M", "doce"],
  ["Esfirra de Kitkat", "doce"],
  ["Guaravita 280ml", null],
  ["Pastel de Nata", null],
  ["Doguinho", null],
  ["Batata Frita c/ Cheddar e Bacon", null],
];
for (const [nome, esperado] of bases) confere(`base de "${nome}"`, baseDoHakim(nome), esperado);

// ── O cardápio (recorte do Hakim) ──
const L = "hakim";
const p = (id: string, name: string, category: string, extra: Partial<ProdutoDoCatalogo> = {}): ProdutoDoCatalogo =>
  ({ id, franchiseeId: L, name, category, price: 5.98, cost: 0, active: true, ...extra });
const PRODUTOS: ProdutoDoCatalogo[] = [
  p("carne", "Esfirra de Carne", "Esfirras Salgadas"),
  p("calmus", "Esfirra de Calabresa com Mussarela", "Esfirras Salgadas"),
  p("qt", "Esfirra de Queijo Temperado", "Esfirras Salgadas"),
  p("kitkat", "Esfirra de Kitkat", "Esfirras Doces"),
  p("choc", "Esfirra de Chocolate ao Leite", "Esfirras Doces"),
  p("guara", "Guaravita 280ml", "Bebidas"),
  p("pizzacal", "Pizza Calabresa", "Pizzas", { active: false }),
  p("c4carne", "4 Esfirras de Carne", "Combos"),
  p("c10", "Combo 10 Esfirras Simples", "Combos", {
    comboGroups: [{ id: "g10", title: "Escolha suas 10 Esfirras", maxQty: 10, items: [{ menuProductId: "carne" }, { menuProductId: "calmus" }, { menuProductId: "qt" }] }],
  }),
];
const base = montarCatalogo(PRODUTOS);
const catalogo: CatalogoDaAntecipacao = { ...base, ativos: new Set(PRODUTOS.filter((x) => x.active).map((x) => x.id)) };
const item = (nome: string, quantidade: number, comboSelections: unknown = null, extra: Record<string, unknown> = {}) =>
  ({ quantity: quantidade, price: 0, productName: nome, menuProductId: null, comboSelections, menuProduct: { id: `ifood-${nome}`, name: nome, category: "iFood", active: false }, ...extra });
const pedido = (items: any[], createdAt = "2026-10-11T22:00:00.000Z"): PedidoDaAntecipacao => ({ franchiseeId: L, canal: "IFOOD", createdAt, items });
const resumo = (ped: PedidoDaAntecipacao) => lanchesDoPedido(ped, catalogo).map((c) => `${c.combo ? "[combo] " : ""}${c.nome} ${c.quantidade}`);

// iFood: nome curto dentro do combo, combo ×2 (a escolha é por unidade).
confere("iFood: \"Carne\" e \"Guaravita\" dentro do combo ×2",
  resumo(pedido([item("Combo Imperial Mix", 2, JSON.stringify([{ name: "Carne", quantity: 5, price: 0 }, { name: "Guaravita", quantity: 1, price: 0 }]), { menuProduct: { id: "ifood-x", name: "Combo Imperial Mix", category: "Combos", active: false } })])),
  ["[combo] Combo Imperial Mix 2", "Esfirra de Carne 10", "Guaravita 280ml 2"]);

// "4 Esfirras de Carne" sem escolha.
confere("\"4 Esfirras de Carne\" ×2 sem escolha = 8 Esfirra de Carne",
  resumo(pedido([item("4 Esfirras de Carne", 2, null, { menuProduct: { id: "ifood-4c", name: "4 Esfirras de Carne", category: "Combos", active: false } })])),
  ["Esfirra de Carne 8"]);

// Recheio de esfiha doce não vira outra esfiha.
confere("\"Esfirra de Kitkat\" com a opção \"Chocolate ao Leite\" = só a Kitkat",
  resumo(pedido([item("Esfirra de Kitkat", 2, JSON.stringify([{ name: "Chocolate ao Leite", quantity: 1, price: 0 }]))])),
  ["Esfirra de Kitkat 2"]);

// Site: { grupo: { opção: qtd } }.
confere("site: Combo 10 com as esfihas do grupo",
  resumo(pedido([{ quantity: 1, price: 39.9, productName: "Combo 10 Esfirras Simples", menuProductId: "c10", comboSelections: { g10: { "Esfirra de Carne": 2, "Esfirra de Calabresa com Mussarela": 8 } }, menuProduct: { id: "c10", name: "Combo 10 Esfirras Simples", category: "Combos", active: true, isCombo: true } }])),
  ["[combo] Combo 10 Esfirras Simples 1", "Esfirra de Carne 2", "Esfirra de Calabresa com Mussarela 8"]);

// Produto desligado não recebe o nome curto.
confere("\"Calabresa\" não vira a \"Pizza Calabresa\" desligada",
  resumo(pedido([item("Combo 10 Esfirras Simples", 1, JSON.stringify([{ name: "Calabresa", quantity: 10 }]), { menuProduct: { id: "ifood-c10", name: "Combo 10 Esfirras Simples", category: "Combos", active: false } })])),
  ["[combo] Combo 10 Esfirras Simples 1", "Calabresa 10"]);

// Observação dentro do combo não é lanche.
confere("\"Sem cebola\" dentro do combo fica de fora",
  resumo(pedido([item("Combo Imperial Mix", 1, JSON.stringify([{ name: "Carne", quantity: 5 }, { name: "Sem cebola", quantity: 1 }]), { menuProduct: { id: "ifood-x", name: "Combo Imperial Mix", category: "Combos", active: false } })])),
  ["[combo] Combo Imperial Mix 1", "Esfirra de Carne 5"]);

// ── Dois dias, faixa de horas, nome curto, feriado ──
// 11/10: 22:00Z = 19:00 em SP; 01:30Z do dia 12 = 22:30 do dia 11.
const dia1 = contarDia("2026-10-11", [
  pedido([item("Esfirra de Carne", 3)], "2026-10-11T22:00:00.000Z"),
  pedido([item("Combo 10 Esfirras Simples", 1, JSON.stringify([{ name: "Calabresa", quantity: 4 }, { name: "Queijo Temperado", quantity: 6 }]), { menuProduct: { id: "ifood-c10", name: "Combo 10 Esfirras Simples", category: "Combos", active: false } })], "2026-10-12T01:30:00.000Z"),
  pedido([item("Esfirra de Calabresa", 2)], "2026-10-11T23:10:00.000Z"),
], catalogo, "America/Sao_Paulo", "", "");
const dia2 = contarDia("2026-10-04", [
  pedido([item("Esfirra de Carne c/ Queijo", 1), item("Esfirra de Kitkat", 1)], "2026-10-04T22:30:00.000Z"),
], catalogo, "America/Sao_Paulo", "", "");
juntarNomesCurtos([dia1, dia2]);
confere("nome curto \"Calabresa\" junta na \"Esfirra de Calabresa\" do período",
  [...dia1.linhas.values()].filter((l) => !l.combo).map((l) => `${l.nome} ${l.quantidade}`).sort(),
  ["Esfirra de Calabresa 6", "Esfirra de Carne 3", "Esfirra de Queijo Temperado 6"]);
confere("hora a hora no relógio da loja (19h e 22h)", [dia1.linhas.get("p:esfirra de carne")!.porHora[19], dia1.linhas.get("p:esfirra de queijo temperado")!.porHora[22]], [3, 6]);

const linhas = preverLinhas([dia1, dia2], 1);
confere("média de dois dias, arredondada para cima", linhas.filter((l) => !l.combo).map((l) => [l.nome, l.porDia, l.media, l.sugerido]), [
  ["Esfirra de Calabresa", [6, 0], 3, 3],
  ["Esfirra de Queijo Temperado", [6, 0], 3, 3],
  ["Esfirra de Carne", [3, 0], 1.5, 2],
  ["Esfirra de Carne c/ Queijo", [0, 1], 0.5, 1],
  ["Esfirra de Kitkat", [0, 1], 0.5, 1],
]);
const comFeriado = preverBases([dia1, dia2], FATOR_DO_FERIADO);
confere("bases (com feriado, +20%)", comFeriado.bases.map((b) => [b.chave, b.porDia, b.media, b.sugerido]), [
  ["carne", [3, 1], 2, 3],
  ["calabresa", [6, 0], 3, 4],
  ["queijo temperado", [6, 0], 3, 4],
  ["mussarela", [0, 0], 0, 0],
]);
confere("doce fica fora das bases", comFeriado.doces, 0.5);

const faixa = contarDia("2026-10-11", [
  pedido([item("Esfirra de Carne", 3)], "2026-10-11T22:00:00.000Z"),
  pedido([item("Esfirra de Carne", 1)], "2026-10-12T04:30:00.000Z"),
], catalogo, "America/Sao_Paulo", "22:00", "02:00");
confere("faixa que passa da meia-noite (22:00–02:00): só o pedido da 01:30", [faixa.pedidosNoDia, faixa.pedidosNaFaixa], [2, 1]);

console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
