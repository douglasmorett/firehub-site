/**
 * Pergunta × combo (src/lib/combo-e-pergunta.ts): item fixo do combo, quais
 * combos dependem de um item ao pausar, quais voltam ao reativar e o que
 * parece combo pelo nome.
 *
 *   npx tsx scripts/teste-combo-e-pergunta.ts
 */
import {
  combosOndeOItemEOpcao,
  combosParaReativar,
  combosQueDependemDoItem,
  itemFixoDoGrupo,
  pareceCombo,
  temPerguntas,
} from "../src/lib/combo-e-pergunta";

let ok = 0, falhas = 0;
function confere(nome: string, cond: boolean, detalhe?: unknown) {
  if (cond) ok++;
  else { falhas++; console.log(`✖ ${nome}`, detalhe === undefined ? "" : JSON.stringify(detalhe)); }
}

const op = (id: string, name: string, active = true, maxPerItem: number | null = null) =>
  ({ maxPerItem, menuProduct: { id, name, active } });
const fixo = (id: string, name: string, qtd: number, active = true) =>
  ({ title: "Vem no combo", minQty: qtd, maxQty: qtd, items: [op(id, name, active)] });

const xSalada = { id: "xs", name: "X Salada", isCombo: false, active: true, comboGroups: [] };
const combo1 = { id: "c1", name: "Combo 1", isCombo: true, active: true, comboGroups: [fixo("xs", "X Salada", 4)] };
const combo8 = { id: "c8", name: "Combo 8", isCombo: true, active: true, comboGroups: [fixo("xs", "X Salada", 4), fixo("bt", "Batata", 1)] };
const comboRefri = {
  id: "cr", name: "Combo Burger + Refri", isCombo: true, active: true,
  comboGroups: [fixo("xb", "X Bacon", 1), { title: "Bebida", minQty: 1, maxQty: 1, items: [op("coca", "Coca"), op("guara", "Guaraná")] }],
};
const comboSoCoca = {
  id: "cc", name: "Combo só Coca", isCombo: true, active: true,
  comboGroups: [{ title: "Bebida", minQty: 1, maxQty: 1, items: [op("coca", "Coca"), op("guara", "Guaraná", false)] }],
};
const pastel = { id: "pa", name: "Pastel", isCombo: false, active: true, comboGroups: [{ title: "Sabor", minQty: 1, maxQty: 1, items: [op("carne", "Carne")] }] };
const produtos = [xSalada, combo1, combo8, comboRefri, comboSoCoca, pastel];

// ── itemFixoDoGrupo ─────────────────────────────────────────────────────────
confere("4× X-Salada é item fixo", JSON.stringify(itemFixoDoGrupo(combo1.comboGroups[0])) === JSON.stringify({ id: "xs", nome: "X Salada", qtd: 4 }));
confere("escolha entre 2 não é fixo", itemFixoDoGrupo(comboRefri.comboGroups[1]) === null);
confere("opcional não é fixo", itemFixoDoGrupo({ minQty: 0, maxQty: 1, items: [op("a", "A")] }) === null);
confere("mínimo nulo = exige o máximo → fixo", itemFixoDoGrupo({ minQty: null, maxQty: 2, items: [op("a", "A")] })?.qtd === 2);
confere("teto da opção menor que o máximo não é fixo", itemFixoDoGrupo({ minQty: 3, maxQty: 3, items: [op("a", "A", true, 1)] }) === null);
confere("até 4 complementos (0–4) não é fixo", itemFixoDoGrupo({ minQty: 0, maxQty: 4, items: [op("a", "A", true, 1)] }) === null);

// ── pausar ──────────────────────────────────────────────────────────────────
const nomes = (l: { id: string }[]) => l.map((p) => p.id).sort().join(",");
confere("pausar X-Salada oferece Combo 1 e 8", nomes(combosQueDependemDoItem("xs", produtos)) === "c1,c8", nomes(combosQueDependemDoItem("xs", produtos)));
confere("pausar a Coca NÃO trava o combo com Guaraná ativo", !combosQueDependemDoItem("coca", produtos).some((p) => p.id === "cr"));
confere("pausar a Coca trava o combo cujo Guaraná já está pausado", combosQueDependemDoItem("coca", produtos).some((p) => p.id === "cc"));
confere("Coca é só opção no combo com Guaraná", nomes(combosOndeOItemEOpcao("coca", produtos)) === "cr");
confere("produto com pergunta não é combo: pausar a opção não o oferece", !combosQueDependemDoItem("carne", produtos).length);
confere("combo já pausado não é oferecido de novo",
  !combosQueDependemDoItem("xs", [{ ...combo1, active: false }]).length);

// ── reativar ────────────────────────────────────────────────────────────────
const pausados = [
  { ...combo1, active: false, comboGroups: [fixo("xs", "X Salada", 4, false)] },
  { ...combo8, active: false, comboGroups: [fixo("xs", "X Salada", 4, false), fixo("bt", "Batata", 1, false)] },
  { ...comboRefri, active: true },
];
confere("reativar X-Salada oferece o Combo 1", nomes(combosParaReativar("xs", pausados)) === "c1", nomes(combosParaReativar("xs", pausados)));
confere("Combo 8 fica: a Batata continua pausada", !combosParaReativar("xs", pausados).some((p) => p.id === "c8"));
confere("combo ativo não entra no reativar", !combosParaReativar("xb", pausados).length);

// ── temPerguntas / pareceCombo ──────────────────────────────────────────────
confere("pastel tem pergunta", temPerguntas(pastel));
confere("X-Salada não tem", !temPerguntas(xSalada));
for (const [n, c] of [["Combo 1", "Lanches"], ["Pizza G + Refri 1,5l", "MAIS PEDIDOS"], ["3 Esfirras Doces", "Combos"], ["Combo Família X-Salada", "Combos com açaí"], ["Kit Festa", "Doces"], ["Balde de Frango", "Frango"], ["OFERTA DO DIA 2 PIZZAS SENDO: 1 SABOR CALABRESA + 1 BRIGADEROSA", "OFERTA DO DIA"], ["2 PIZZAS 35CM / 1 COCA 2L/ 16 FATIAS/ SERVE 4 PESSOAS", "Pizzas"], ["Trio Burguer Duplo", "Burgers"], ["PROMOÇÃO COMPRE 1 LEVE 2 ( 2 PIZZAS DE 35CM CADA)", "Promoções"]])
  confere(`"${n}" parece combo`, pareceCombo(n, c));
for (const [n, c] of [["X Bacon", "Lanches"], ["Pizza Bacon", "Pizzas"], ["Jarra (880ml)", "Sucos"], ["P1 Linguiça Acebolada 50%OFF", "50 % Off"], ["Cheese Salad Burguer", "Promoções da Taurus"], ["Pastel", "Pastéis"], ["Kitkat", "Complementos"], ["Kit Kat", "Doces"], ["Açaí com Kit Kat", "Açaí"], ["Pizza 1/2 Calabresa", "Pizzas"], ["Mini Rodízio Doce", "Rodízio"]])
  confere(`"${n}" não parece combo`, !pareceCombo(n, c));

console.log(`${ok} ok, ${falhas} falha(s)`);
if (falhas) process.exit(1);
