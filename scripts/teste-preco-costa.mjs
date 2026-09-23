/**
 * Prova os preços da Pizzaria do Costa pela regra de preço do PRÓPRIO FireHub
 * (lib/preco-combo.ts) — não por uma conta refeita aqui, que provaria só que
 * eu sei multiplicar.
 *
 *   node scripts/teste-preco-costa.mjs
 *
 * O que está em jogo: a loja vende pizza de 35 cm com 1 ou 2 sabores, e o dono
 * cobra "o valor do sabor mais caro". Cada sabor está cadastrado pelo preço
 * CHEIO no vínculo do grupo, com priceRule MAIOR. Se a regra somasse, meia
 * mussarela com meia portuguesa sairia por R$ 105,80 em vez de R$ 55,90 — o
 * dobro, na cara do cliente, em toda pizza meio a meio da casa.
 *
 * Os números vêm do cartaz da loja (22/09/2026).
 */
import { readFileSync } from "fs";
import ts from "typescript";

const js = ts.transpileModule(readFileSync("src/lib/preco-combo.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const m = await import("data:text/javascript," + encodeURIComponent(js));
const { precoUnitarioDoItem, precoMinimoDoProduto, regraDoGrupo } = m;

let falhas = 0;
const conferir = (nome, obtido, esperado) => {
  if (obtido === esperado) { console.log(`  ok    ${nome} = R$ ${obtido.toFixed(2)}`); return; }
  falhas++;
  console.log(`  FALHA ${nome} — obtido R$ ${obtido}, esperado R$ ${esperado}`);
};

// O cardápio como ele fica gravado: produto base R$ 0, preço cheio no vínculo.
// A escolha do cliente chega como { grupoId: { NOME DA OPCAO: qtd } } — o
// mesmo formato que o ComboModal manda. Por isso os sabores entram aqui pelo
// nome exato com que vao ser gravados.
const SABORES = {
  "Mussarela": 49.9,
  "Calabresa": 49.9,
  "Toscana": 53.9,
  "Marguerita": 54.9,
  "Frango com Catupiry": 55.9,
  "Italiana": 55.9,
  "Napolitana": 55.9,
  "Portuguesa": 55.9,
};
const GRUPO_ID = "g35";
const pizza35 = {
  price: 0,
  comboGroups: [{
    id: GRUPO_ID,
    minQty: 1,
    maxQty: 2,
    priceRule: "MAIOR",
    items: Object.entries(SABORES).map(([nome, preco]) => ({
      additionalPrice: preco,
      menuProduct: { name: nome, price: 0 },
    })),
  }],
};
const escolher = (...nomes) => ({ [GRUPO_ID]: Object.fromEntries(nomes.map((n) => [n, 1])) });

console.log("Pizza 35cm — regra do grupo:", regraDoGrupo(pizza35.comboGroups[0]));

console.log("\nUm sabor só (tem que bater com o cartaz):");
conferir("Mussarela", precoUnitarioDoItem(pizza35, escolher("Mussarela")), 49.9);
conferir("Calabresa", precoUnitarioDoItem(pizza35, escolher("Calabresa")), 49.9);
conferir("Toscana", precoUnitarioDoItem(pizza35, escolher("Toscana")), 53.9);
conferir("Marguerita", precoUnitarioDoItem(pizza35, escolher("Marguerita")), 54.9);
conferir("Frango com Catupiry", precoUnitarioDoItem(pizza35, escolher("Frango com Catupiry")), 55.9);
conferir("Italiana", precoUnitarioDoItem(pizza35, escolher("Italiana")), 55.9);
conferir("Napolitana", precoUnitarioDoItem(pizza35, escolher("Napolitana")), 55.9);
conferir("Portuguesa", precoUnitarioDoItem(pizza35, escolher("Portuguesa")), 55.9);

console.log("\nMeio a meio — prevalece o mais caro, NÃO soma:");
conferir("mussarela + portuguesa", precoUnitarioDoItem(pizza35, escolher("Mussarela", "Portuguesa")), 55.9);
conferir("calabresa + mussarela", precoUnitarioDoItem(pizza35, escolher("Calabresa", "Mussarela")), 49.9);
conferir("toscana + marguerita", precoUnitarioDoItem(pizza35, escolher("Toscana", "Marguerita")), 54.9);
conferir("frango + calabresa", precoUnitarioDoItem(pizza35, escolher("Frango com Catupiry", "Calabresa")), 55.9);

// O caso que o cardápio antigo da loja cobrava errado: as quatro "mais pedidas"
// estavam acima do sabor mais caro do par. Aqui elas passam a sair pela regra.
console.log("\nAs 4 'mais pedidas' do cadastro antigo, agora pela regra:");
conferir("frango + portuguesa  (estava 58,90)", precoUnitarioDoItem(pizza35, escolher("Frango com Catupiry", "Portuguesa")), 55.9);
conferir("frango + calabresa   (estava 56,90)", precoUnitarioDoItem(pizza35, escolher("Frango com Catupiry", "Calabresa")), 55.9);
conferir("calabresa + mussarela (estava 49,90)", precoUnitarioDoItem(pizza35, escolher("Calabresa", "Mussarela")), 49.9);
conferir("toscana + marguerita (estava 55,90)", precoUnitarioDoItem(pizza35, escolher("Toscana", "Marguerita")), 54.9);

console.log("\n'A partir de' do card no cardápio (o menor sabor, não zero):");
conferir("Pizza 35cm a partir de", precoMinimoDoProduto(pizza35), 49.9);

console.log(falhas === 0 ? "\n✓ tudo certo" : `\n✗ ${falhas} falha(s)`);
process.exit(falhas === 0 ? 0 : 1);
