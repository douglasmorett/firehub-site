// Teste do rateio e da abertura de combo na nota fiscal.
// Roda o ARQUIVO DE VERDADE (via tsx), não uma cópia: um harness que duplica a
// lógica passa verde enquanto a lib está quebrada.
import { ratearEmCentavos, montarItensDaNota } from "../src/lib/fiscal-itens.ts";

let falhas = 0;
const t = (nome, fn) => {
  try { fn(); console.log("  ok  " + nome); }
  catch (e) { falhas++; console.log("FALHOU " + nome + "\n       " + e.message); }
};
const eq = (a, b, m) => {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`${m || ""}\n       esperado ${y}\n       veio     ${x}`);
};
const centavos = (v) => Math.round(v * 100);

console.log("\n— rateio —");
t("divide na proporção dos pesos", () => {
  eq(ratearEmCentavos(30, [20, 10]), [20, 10]);
});
t("soma bate mesmo com dízima (10 em 3 partes iguais)", () => {
  const r = ratearEmCentavos(10, [1, 1, 1]);
  eq(r.reduce((s, v) => s + centavos(v), 0), 1000, "somatório em centavos");
});
t("combo vendido abaixo da soma das partes", () => {
  // Partes de tabela 25 + 10 = 35; combo sai por 29,90.
  const r = ratearEmCentavos(29.9, [25, 10]);
  eq(r.reduce((s, v) => s + centavos(v), 0), 2990);
});
t("sobra vai para a MAIOR linha, não para a menor", () => {
  const r = ratearEmCentavos(10, [1, 1, 1]);
  const max = Math.max(...r.map(centavos));
  eq(r.filter((v) => centavos(v) === max).length, 1, "só uma linha absorve a sobra");
});
t("pesos todos zero divide igual em vez de estourar", () => {
  const r = ratearEmCentavos(10, [0, 0]);
  eq(r.reduce((s, v) => s + centavos(v), 0), 1000);
});

console.log("\n— itens da nota —");
const combo = {
  id: "p1", name: "Combo Lanche", isCombo: true, ncm: "21069090", cfop: "5102",
  origem: "0", csosn: "102", pis: "49", cofins: "49",
  fiscalBreakdown: [
    { name: "X-Burger", price: 25, ncm: "16023200" },
    { name: "Refrigerante 350ml", price: 10, ncm: "22021000" },
  ],
};

t("combo abre em duas linhas com o NCM de cada parte", () => {
  const l = montarItensDaNota([{ id: "i1", productName: "Combo Lanche", quantity: 1, price: 29.9, menuProduct: combo }]);
  eq(l.length, 2);
  eq(l[0].ncm, "16023200");
  eq(l[1].ncm, "22021000");
});
t("soma das linhas = exatamente o que o cliente pagou", () => {
  const l = montarItensDaNota([{ id: "i1", productName: "Combo Lanche", quantity: 3, price: 29.9, menuProduct: combo }]);
  eq(l.reduce((s, i) => s + centavos(i.valorTotal), 0), centavos(29.9 * 3));
});
t("cada linha fecha consigo mesma (quantidade x unitario = total)", () => {
  const l = montarItensDaNota([{ id: "i1", productName: "Combo Lanche", quantity: 3, price: 29.9, menuProduct: combo }]);
  for (const i of l) eq(centavos(i.valorTotal), centavos(i.valorUnitario) * i.quantidade, `linha ${i.descricao}`);
});
t("quantidade acompanha o combo: 2 combos = 2 de cada parte", () => {
  const l = montarItensDaNota([{ id: "i1", productName: "Combo", quantity: 2, price: 29.9, menuProduct: combo }]);
  eq(l.map((i) => i.quantidade), [2, 2]);
});
t("combo SEM breakdown continua em linha única", () => {
  const semBreak = { ...combo, fiscalBreakdown: null };
  const l = montarItensDaNota([{ id: "i1", productName: "Combo", quantity: 1, price: 29.9, menuProduct: semBreak }]);
  eq(l.length, 1);
  eq(l[0].ncm, "21069090");
});
t("breakdown com lixo (sem nome/preço) é ignorado, não quebra", () => {
  const sujo = { ...combo, fiscalBreakdown: [{ name: "", price: 5 }, { price: "abc" }, null] };
  const l = montarItensDaNota([{ id: "i1", productName: "Combo", quantity: 1, price: 29.9, menuProduct: sujo }]);
  eq(l.length, 1, "sem parte válida, cai para linha única");
});
t("parte que rateia para R$ 0,00 não vira linha de nota", () => {
  const barato = { ...combo, fiscalBreakdown: [{ name: "A", price: 1000 }, { name: "B", price: 1 }] };
  const l = montarItensDaNota([{ id: "i1", productName: "Combo", quantity: 1, price: 0.5, menuProduct: barato }]);
  eq(l.length, 1, "cai para linha única em vez de emitir item de valor zero");
});
t("produto normal (não combo) passa igual", () => {
  const normal = { id: "p2", name: "Coca", isCombo: false, ncm: "22021000", cfop: "5102", origem: "0", csosn: "500" };
  const l = montarItensDaNota([{ id: "i2", productName: "Coca", quantity: 2, price: 8, menuProduct: normal }]);
  eq(l.length, 1);
  eq(l[0].valorTotal, 16);
  eq(l[0].csosn, "500");
});
t("CSOSN de 3 dígitos não vira CST", () => {
  const l = montarItensDaNota([{ id: "i1", productName: "Combo", quantity: 1, price: 29.9, menuProduct: combo }]);
  eq(l[0].csosn, "102");
  eq(l[0].cst, null);
});
t("Regime Normal: situação de 2 dígitos vira CST também", () => {
  const crt3 = { ...combo, csosn: "00", fiscalBreakdown: [{ name: "A", price: 1 }] };
  const l = montarItensDaNota([{ id: "i1", productName: "Combo", quantity: 1, price: 10, menuProduct: crt3 }]);
  eq(l[0].cst, "00");
});

console.log(falhas === 0 ? "\nTUDO PASSOU\n" : `\n${falhas} FALHA(S)\n`);
process.exit(falhas === 0 ? 0 : 1);
