/**
 * A PIZZA MEIO A MEIO COBRA O QUE O DONO MANDOU COBRAR.
 *
 * Até 18/09/2026 o FireHub só sabia somar: duas metades a R$ 40 e R$ 50
 * viravam R$ 90 — o preço de duas pizzas. A saída era o lojista cadastrar cada
 * sabor pela METADE (foi o que a Pizzaria do Digão fez no InstaDelivery), o
 * que obriga a recalcular 42 sabores na mão a cada reajuste e quebra quando o
 * mesmo sabor também é vendido inteiro em outra pergunta.
 *
 * Agora a pergunta tem regra, escolhida pelo dono, com o preço CHEIO em cada
 * sabor:
 *
 *   SOMA  — cada escolha soma (adicionais: bacon + cheddar + ovo)
 *   MAIOR — cobra o sabor mais caro entre os escolhidos (padrão do iFood)
 *   MEDIA — cobra a média dos sabores escolhidos
 *
 * O que este harness prova, além das três contas: que o DETALHE impresso na
 * comanda soma exatamente o total cobrado. Esse é o contrato da lib — foi por
 * isso que o "Nugget" da Hakim já apareceu com três preços diferentes em três
 * telas — e a repartição de MAIOR/MEDIA é onde ele quebraria primeiro.
 *
 *   node scripts/teste-regra-de-pizza.js
 */
const path = require("path");
const createJiti = require("jiti");
const jiti = createJiti(__filename, {
  alias: { "@": path.resolve(__dirname, "..", "src") },
  interopDefault: true,
  esmResolve: true,
});
const {
  somaDosAdicionais,
  adicionaisDetalhados,
  precoUnitarioDoItem,
  precoMinimoDoProduto,
  pisoDoPreco,
  precoVariaPorEscolha,
  regraDoGrupo,
} = jiti(path.resolve(__dirname, "..", "src", "lib", "preco-combo.ts"));

let ok = 0, falhou = 0;
function conferir(nome, real, esperado, tol = 0.005) {
  const bate = typeof esperado === "number" ? Math.abs(real - esperado) < tol : JSON.stringify(real) === JSON.stringify(esperado);
  if (bate) { ok++; console.log(`  ok    ${nome}`); }
  else { falhou++; console.log(`  FALHOU ${nome}\n         esperado: ${JSON.stringify(esperado)}\n         veio:     ${JSON.stringify(real)}`); }
}

/** Sabor com o preço CHEIO da pizza daquele sabor. */
const sabor = (nome, preco) => ({ additionalPrice: preco, menuProduct: { name: nome, price: preco } });

const SABORES = [sabor("Calabresa", 40), sabor("Marguerita", 50), sabor("Portuguesa", 45)];

function pizza(regra) {
  return {
    price: 0,
    isCombo: true,
    comboGroups: [{ id: "g1", title: "Escolha 2 sabores", minQty: 2, maxQty: 2, priceRule: regra, items: SABORES }],
  };
}
/** Duas metades diferentes. */
const MEIO_A_MEIO = { g1: { Calabresa: 1, Marguerita: 1 } };
/** A pizza inteira de um sabor só. */
const INTEIRA = { g1: { Marguerita: 2 } };

console.log("\n== SOMA: a regra de sempre (adicionais) ==");
conferir("regra lida como SOMA quando não há priceRule", regraDoGrupo({}), "SOMA");
conferir("meio a meio soma as duas (40 + 50)", somaDosAdicionais(pizza(null), MEIO_A_MEIO), 90);
conferir("inteira de marguerita soma duas vezes (50 x 2)", somaDosAdicionais(pizza("SOMA"), INTEIRA), 100);

console.log("\n== MAIOR: cobra o sabor mais caro (padrão do iFood) ==");
conferir("regra lida", regraDoGrupo({ priceRule: "maior" }), "MAIOR");
conferir("meia calabresa (40) + meia marguerita (50) = 50", somaDosAdicionais(pizza("MAIOR"), MEIO_A_MEIO), 50);
conferir("inteira de marguerita = 50 (não 100)", somaDosAdicionais(pizza("MAIOR"), INTEIRA), 50);

console.log("\n== MEDIA: cobra a média dos sabores ==");
conferir("meia calabresa (40) + meia marguerita (50) = 45", somaDosAdicionais(pizza("MEDIA"), MEIO_A_MEIO), 45);
conferir("inteira de marguerita = 50", somaDosAdicionais(pizza("MEDIA"), INTEIRA), 50);
conferir(
  "três sabores 40/50/45 = 45",
  somaDosAdicionais(pizza("MEDIA"), { g1: { Calabresa: 1, Marguerita: 1, Portuguesa: 1 } }),
  45,
);

console.log("\n== O DETALHE DA COMANDA SOMA O TOTAL (o contrato da lib) ==");
for (const regra of ["SOMA", "MAIOR", "MEDIA"]) {
  for (const [rotulo, escolha] of [["meio a meio", MEIO_A_MEIO], ["inteira", INTEIRA]]) {
    const p = pizza(regra);
    const detalhe = adicionaisDetalhados(p, escolha);
    const somaDoDetalhe = detalhe.reduce((s, d) => s + d.precoUnitario * d.qtd, 0);
    conferir(
      `${regra} / ${rotulo}: detalhe soma ${somaDoDetalhe.toFixed(2)} = total ${somaDosAdicionais(p, escolha).toFixed(2)}`,
      Math.round(somaDoDetalhe * 100) / 100,
      somaDosAdicionais(p, escolha),
    );
  }
}

console.log("\n== Centavo que não fecha: 3 sabores de R$ 35,00 em MEDIA ==");
// 35 / 3 = 11,6666... — a sobra vai para a última linha, senão o total cai 1 centavo.
const tresIguais = {
  price: 0,
  comboGroups: [{ id: "g1", minQty: 3, maxQty: 3, priceRule: "MEDIA", items: [sabor("A", 35), sabor("B", 35), sabor("C", 35)] }],
};
const esc3 = { g1: { A: 1, B: 1, C: 1 } };
const det3 = adicionaisDetalhados(tresIguais, esc3);
conferir("total continua 35,00", somaDosAdicionais(tresIguais, esc3), 35);
conferir("detalhe soma 35,00 exatos", Math.round(det3.reduce((s, d) => s + d.precoUnitario * d.qtd, 0) * 100) / 100, 35);

console.log("\n== O \"a partir de\" do cardápio ==");
// Sabor mais barato: 40. Em SOMA são duas metades = 80; em MAIOR/MEDIA é UMA pizza = 40.
conferir("SOMA: a partir de 80 (duas metades)", precoMinimoDoProduto(pizza("SOMA")), 80);
conferir("MAIOR: a partir de 40 (uma pizza)", precoMinimoDoProduto(pizza("MAIOR")), 40);
conferir("MEDIA: a partir de 40 (uma pizza)", precoMinimoDoProduto(pizza("MEDIA")), 40);
conferir("continua dizendo 'a partir de'", precoVariaPorEscolha(pizza("MAIOR")), true);

console.log("\n== Preço final do item (base + pergunta) ==");
const comBase = {
  price: 10, // taxa de embalagem embutida no produto, por exemplo
  comboGroups: [{ id: "g1", minQty: 2, maxQty: 2, priceRule: "MAIOR", items: SABORES }],
};
conferir("base 10 + maior sabor 50 = 60", precoUnitarioDoItem(comBase, MEIO_A_MEIO), 60);

console.log("\n== Duas perguntas: sabores em MAIOR, borda em SOMA ==");
const pizzaCompleta = {
  price: 0,
  comboGroups: [
    { id: "g1", title: "Sabores", minQty: 2, maxQty: 2, priceRule: "MAIOR", items: SABORES },
    { id: "g2", title: "Borda", minQty: 1, maxQty: 1, priceRule: null, items: [sabor("Sem borda", 0), sabor("Catupiry", 12)] },
  ],
};
conferir(
  "meio a meio (50) + borda catupiry (12) = 62",
  somaDosAdicionais(pizzaCompleta, { g1: { Calabresa: 1, Marguerita: 1 }, g2: { Catupiry: 1 } }),
  62,
);
conferir("a partir de: pizza mais barata 40 + borda grátis 0 = 40", precoMinimoDoProduto(pizzaCompleta), 40);

console.log("\n== Cardápio que já existe não muda (nenhuma regra gravada) ==");
// O caso real da Pizzaria do Digão, com os sabores já cadastrados pela metade.
const digao = {
  price: 0,
  comboGroups: [{ id: "g1", minQty: 2, maxQty: 2, items: [sabor("Mussarela", 24.45), sabor("Calabresa Acebolada", 22.95)] }],
};
conferir("soma as duas metades: 24,45 + 22,95 = 47,40", somaDosAdicionais(digao, { g1: { Mussarela: 1, "Calabresa Acebolada": 1 } }), 47.4);
conferir("a partir de 45,90 (22,95 x 2), como o site do InstaDelivery anuncia", precoMinimoDoProduto(digao), 45.9);

console.log("\n== Piso do servidor: a meia pizza mais barata DESCONTA ==");
// Ragnar (25/09/2026): a pizza é o card e a outra metade é uma pergunta
// opcional com acréscimo = (outra − esta) / 2. Bjorn Ironside 109,90 com meia
// Calabresa 65,90 = 87,90. O "a partir de" (109,90) como piso cobrava cheio.
const bjorn = {
  price: 109.9,
  comboGroups: [
    { id: "m", title: "Meio a meio?", minQty: 0, maxQty: 1, items: [sabor("1/2 Calabresa", -22), sabor("1/2 Judith", 0), sabor("1/2 Americana", -16.5)] },
    { id: "b", title: "Borda", minQty: 0, maxQty: 1, items: [sabor("Catupiry", 22.9)] },
  ],
};
conferir("vitrine continua 'a partir de' 109,90", precoMinimoDoProduto(bjorn), 109.9);
conferir("piso desce até a metade mais barata: 87,90", pisoDoPreco(bjorn), 87.9);
conferir("Bjorn + meia Calabresa = 87,90 (o piso não barra)", precoUnitarioDoItem(bjorn, { m: { "1/2 Calabresa": 1 } }), 87.9);
conferir("Bjorn + meia Calabresa + borda = 110,80", precoUnitarioDoItem(bjorn, { m: { "1/2 Calabresa": 1 }, b: { Catupiry: 1 } }), 110.8);

// O piso ainda segura o que existe para segurar: base 0, valor na opção.
const nugget = { price: 0, comboGroups: [{ id: "n", minQty: 1, maxQty: 1, items: [sabor("6 Nuggets", 9.9), sabor("15 Nuggets", 19.9)] }] };
conferir("Nugget: piso continua 9,90", pisoDoPreco(nugget), 9.9);
conferir("produto sem pergunta: piso = preço", pisoDoPreco({ price: 30, comboGroups: [] }), 30);

// Desconto que repete: SOMA 0..3, opção −2 com maxPerItem 1 e outra −1 livre.
const repete = { price: 20, comboGroups: [{ id: "r", minQty: 0, maxQty: 3, items: [{ ...sabor("A", -2), maxPerItem: 1 }, sabor("B", -1), sabor("C", 5)] }] };
conferir("SOMA 0..3: −2 uma vez + −1 duas = piso 16", pisoDoPreco(repete), 16);
// Obrigatória com desconto já entra no "a partir de"; as vagas que sobram, só com desconto.
const obrigatoria = { price: 20, comboGroups: [{ id: "o", minQty: 1, maxQty: 2, items: [sabor("A", -3), sabor("B", 4)] }] };
conferir("SOMA 1..2 com −3: a partir de 17, piso 14", [precoMinimoDoProduto(obrigatoria), pisoDoPreco(obrigatoria)], [17, 14]);
// MEDIA opcional com opção negativa vale UMA vez.
const mediaOpcional = { price: 50, comboGroups: [{ id: "x", minQty: 0, maxQty: 2, priceRule: "MEDIA", items: [sabor("A", -4), sabor("B", -6)] }] };
conferir("MEDIA opcional: piso 44 (a mais barata, uma vez)", pisoDoPreco(mediaOpcional), 44);

console.log(`\n${ok} ok, ${falhou} falharam\n`);
process.exit(falhou > 0 ? 1 : 0);
