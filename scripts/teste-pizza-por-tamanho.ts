/**
 * Pizza por tamanho (src/lib/pizza-por-tamanho.ts): o que o passo a passo
 * "Cadastrar pizza" monta, conferido pelo MESMO motor de preço do site, do
 * balcão e do robô (lib/preco-combo.ts) — e a volta (edição) reconstruindo a
 * montagem a partir do que ficou gravado.
 *
 *   npx tsx scripts/teste-pizza-por-tamanho.ts
 */
import {
  errosDaMontagem, lerPreco, limparMontagem, perguntasDoTamanho, pizzasJaMontadas, precoDoMeio,
  precoInicialDoTamanho, nomeDoTamanho, descricaoDoTamanho, tamanhoDoNome, type MontagemDaPizza,
} from "../src/lib/pizza-por-tamanho";
import { precoMinimoDoProduto, precoUnitarioDoItem } from "../src/lib/preco-combo";

let ok = 0, falhas = 0;
function confere(nome: string, cond: boolean, detalhe?: unknown) {
  if (cond) ok++;
  else { falhas++; console.log(`✖ ${nome}`, detalhe === undefined ? "" : JSON.stringify(detalhe)); }
}

// ── preço digitado ─────────────────────────────────────────────────────────
for (const [txt, esperado] of [
  ["45", 45], ["45,9", 45.9], ["45,90", 45.9], ["R$ 45,90", 45.9], ["1.200,00", 1200], ["1.200", 1200],
  ["45.90", 45.9], ["", null], ["abc", null], ["-3", null], ["0", 0],
] as [string, number | null][]) {
  confere(`lerPreco("${txt}")`, lerPreco(txt) === esperado, lerPreco(txt));
}

// ── uma pizzaria ───────────────────────────────────────────────────────────
const base: MontagemDaPizza = {
  categoria: "Pizzas",
  regra: "MAIOR",
  tamanhos: [
    { nome: "Broto", fatias: 4, sabores: 1 },
    { nome: "Grande", fatias: 8, sabores: 2 },
  ],
  sabores: [
    { nome: "Calabresa", descricao: "Calabresa e cebola", precos: [30, 50] },
    { nome: "Camarão", descricao: "Camarão e catupiry", precos: [null, 70] },
    { nome: "Marguerita", descricao: "", precos: [32, 55] },
    { nome: "  ", descricao: "", precos: [null, null] }, // linha em branco da tela
  ],
  bordas: [{ nome: "Catupiry", precos: [5, 10] }],
};
const m = limparMontagem(base);
confere("linha em branco não vira sabor", m.sabores.length === 3, m.sabores.map((s) => s.nome));
confere("montagem certa não tem erro", errosDaMontagem(m).length === 0, errosDaMontagem(m));

const idsSabores = ["s-cal", "s-cam", "s-mar"];
const idsBordas = ["b-cat"];
const gBroto = perguntasDoTamanho(m, 0, idsSabores, idsBordas);
const gGrande = perguntasDoTamanho(m, 1, idsSabores, idsBordas);
confere("Broto: 1 sabor", gBroto[0].title === "Escolha o sabor" && gBroto[0].maxQty === 1 && gBroto[0].minQty === 1, gBroto[0]);
confere("Broto: Camarão não existe nele", gBroto[0].items.map((i) => i.id).join() === "s-cal,s-mar", gBroto[0].items);
confere("Grande: até 2 sabores com a regra", gGrande[0].title === "Escolha até 2 sabores" && gGrande[0].maxQty === 2 && gGrande[0].priceRule === "MAIOR", gGrande[0]);
confere("Grande: preço cheio de cada sabor", gGrande[0].items.map((i) => i.additionalPrice).join() === "50,70,55", gGrande[0].items);
confere("borda opcional que soma", gGrande[1]?.title === "Borda recheada?" && gGrande[1].minQty === 0 && gGrande[1].maxQty === 1 && gGrande[1].priceRule === null, gGrande[1]);
confere("sem borda = sem pergunta de borda", perguntasDoTamanho({ ...m, bordas: [] }, 1, idsSabores, []).length === 1);

// O produto como a vitrine e o pedido o leem (preço 0, opções com nome).
const nomes: Record<string, string> = { "s-cal": "Calabresa", "s-cam": "Camarão", "s-mar": "Marguerita", "b-cat": "Catupiry" };
const produto = (grupos: ReturnType<typeof perguntasDoTamanho>) => ({
  price: 0,
  comboGroups: grupos.map((g, gi) => ({
    id: `g${gi}`, title: g.title, minQty: g.minQty, maxQty: g.maxQty, priceRule: g.priceRule,
    items: g.items.map((it) => ({ additionalPrice: it.additionalPrice, menuProduct: { name: nomes[it.id] } })),
  })),
});
const grande = produto(gGrande);
const broto = produto(gBroto);
const preco = (p: ReturnType<typeof produto>, escolhas: Record<string, Record<string, number>>) => precoUnitarioDoItem(p, escolhas);

confere("Grande meia Calabresa + meia Camarão (mais caro) = 70", preco(grande, { g0: { Calabresa: 1, "Camarão": 1 } }) === 70, preco(grande, { g0: { Calabresa: 1, "Camarão": 1 } }));
confere("Grande inteira de Calabresa = 50", preco(grande, { g0: { Calabresa: 1 } }) === 50);
confere("Grande meio a meio + borda = 80", preco(grande, { g0: { Calabresa: 1, "Camarão": 1 }, g1: { Catupiry: 1 } }) === 80);
confere("Broto Marguerita + borda = 37", preco(broto, { g0: { Marguerita: 1 }, g1: { Catupiry: 1 } }) === 37);
confere("'a partir de' da Grande = sabor mais barato", precoMinimoDoProduto(grande) === 50 && precoInicialDoTamanho(m, 1) === 50, precoMinimoDoProduto(grande));
confere("'a partir de' do Broto = 30", precoMinimoDoProduto(broto) === 30);

const media = produto(perguntasDoTamanho({ ...m, regra: "MEDIA" }, 1, idsSabores, idsBordas));
confere("metade de cada: Calabresa + Camarão = 60", preco(media, { g0: { Calabresa: 1, "Camarão": 1 } }) === 60, preco(media, { g0: { Calabresa: 1, "Camarão": 1 } }));
confere("precoDoMeio bate com o motor", precoDoMeio("MAIOR", [50, 70]) === 70 && precoDoMeio("MEDIA", [50, 70]) === 60 && precoDoMeio("MEDIA", [49.9, 55]) === 52.45);

// ── o que não pode salvar ──────────────────────────────────────────────────
const erro = (mm: Partial<MontagemDaPizza>) => errosDaMontagem({ ...m, ...mm });
confere("sem tamanho", erro({ tamanhos: [], sabores: [] }).some((e) => /tamanho/.test(e)));
confere("sem sabor", erro({ sabores: [] }).some((e) => /pelo menos um sabor/.test(e)));
confere("sabor repetido (sem acento/caixa)", erro({ sabores: [...m.sabores, { nome: "calabresa", descricao: "", precos: [1, 2] }] }).some((e) => /duas vezes/.test(e)));
confere("sabor sem preço", erro({ sabores: [...m.sabores, { nome: "Atum", descricao: "", precos: [null, null] }] }).some((e) => /Atum.*sem preço/.test(e)));
confere("preço zero no sabor", erro({ sabores: [{ nome: "Atum", descricao: "", precos: [0, 40] }] }).some((e) => /maior que zero/.test(e)));
confere("tamanho sem nenhum sabor com preço", erro({ sabores: [{ nome: "Atum", descricao: "", precos: [null, 40] }] }).some((e) => /pizza Broto/.test(e)));
confere("5 sabores não pode", erro({ tamanhos: [{ nome: "Grande", fatias: 8, sabores: 5 }], sabores: [{ nome: "A", descricao: "", precos: [10] }], bordas: [] }).some((e) => /1 a 4/.test(e)));
confere("sem categoria", erro({ categoria: " " }).some((e) => /categoria/.test(e)));
confere("borda grátis vale", erro({ bordas: [{ nome: "Cheddar", precos: [0, 0] }] }).length === 0);
confere("borda sem preço não", erro({ bordas: [{ nome: "Cheddar", precos: [null, null] }] }).some((e) => /Cheddar/.test(e)));

// ── nomes ──────────────────────────────────────────────────────────────────
confere("nome do tamanho", nomeDoTamanho("Grande") === "Pizza Grande" && nomeDoTamanho("Pizza Broto") === "Pizza Broto" && tamanhoDoNome("Pizza Grande") === "Grande");
confere("descrição do tamanho", descricaoDoTamanho({ fatias: 8, sabores: 2 }) === "8 fatias · até 2 sabores" && descricaoDoTamanho({ fatias: null, sabores: 1 }) === "1 sabor");

// ── a volta: do banco para a tela de edição ────────────────────────────────
const gravados = [
  { id: "s-cal", name: "Calabresa", description: "Calabresa e cebola", category: "Pizzas", apenasEmCombo: true, comboGroups: [] },
  { id: "s-cam", name: "Camarão", description: "Camarão e catupiry", category: "Pizzas", apenasEmCombo: true, comboGroups: [] },
  { id: "s-mar", name: "Marguerita", description: "Marguerita", category: "Pizzas", apenasEmCombo: true, comboGroups: [] },
  { id: "b-cat", name: "Catupiry", description: "Borda recheada de Catupiry", category: "Pizzas", apenasEmCombo: true, comboGroups: [] },
  ...[0, 1].map((i) => ({
    id: `t${i}`, name: nomeDoTamanho(m.tamanhos[i].nome), description: descricaoDoTamanho(m.tamanhos[i]), category: "Pizzas",
    isCombo: false, apenasEmCombo: false, active: i === 0 ? false : true, sortOrder: i,
    comboGroups: perguntasDoTamanho(m, i, idsSabores, idsBordas).map((g, gi) => ({
      title: g.title, maxQty: g.maxQty, priceRule: g.priceRule, sortOrder: gi,
      items: g.items.map((it, k) => ({ additionalPrice: it.additionalPrice, sortOrder: k, menuProduct: { id: it.id } })),
    })),
  })),
  // Um X-Bacon com pergunta de adicionais NÃO é pizza.
  { id: "xb", name: "X-Bacon", description: "", category: "Lanches", isCombo: false, comboGroups: [{ title: "Adicionais", maxQty: 3, priceRule: null, items: [{ additionalPrice: 4, menuProduct: { id: "s-cal" } }] }] },
  // Pizza com sabor que é produto de venda (não opção): fora — a edição não mexe no que não montou.
  { id: "pz", name: "Pizza Doce", description: "", category: "Doces", isCombo: false, comboGroups: [{ title: "Escolha o sabor", maxQty: 1, priceRule: "MAIOR", items: [{ additionalPrice: 40, menuProduct: { id: "xb" } }] }] },
];
const lidas = pizzasJaMontadas(gravados);
confere("acha uma montagem só (a de Pizzas)", lidas.length === 1 && lidas[0].categoria === "Pizzas", lidas.map((l) => l.categoria));
const l = lidas[0];
confere("tamanhos na ordem, com fatias e sabores", l.tamanhos.map((t) => `${t.nome}/${t.fatias}/${t.sabores}`).join() === "Broto/4/1,Grande/8/2", l.tamanhos);
confere("regra lida do tamanho de 2 sabores", l.regra === "MAIOR");
confere("sabores com preço por tamanho", JSON.stringify(l.sabores.map((s) => [s.nome, s.precos])) === JSON.stringify([["Calabresa", [30, 50]], ["Camarão", [null, 70]], ["Marguerita", [32, 55]]]), l.sabores);
confere("descrição igual ao nome volta vazia", l.sabores[2].descricao === "" && l.sabores[0].descricao === "Calabresa e cebola");
confere("borda lida", l.bordas.length === 1 && l.bordas[0].nome === "Catupiry" && l.bordas[0].precos.join() === "5,10", l.bordas);
confere("tamanho pausado vem marcado", l.ativos.join() === "false,true", l.ativos);
confere("a montagem lida salva sem erro", errosDaMontagem(limparMontagem(l)).length === 0, errosDaMontagem(limparMontagem(l)));
const regravado = perguntasDoTamanho(limparMontagem(l), 1, l.sabores.map((s) => s.id!), l.bordas.map((b) => b.id!));
confere("ida e volta dá as mesmas perguntas", JSON.stringify(regravado) === JSON.stringify(gGrande), regravado);

console.log(`\n${ok} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
