/**
 * Prova da rede de conferência do preço DITO (lib/precos-ditos.ts).
 *
 *   node scripts/teste-precos-ditos.mjs
 *
 * O caso que dá nome a tudo: em produção um pastel de R$ 21,90 foi cotado ao
 * cliente a R$ 131,40, porque o modelo somou todos os adicionais em vez de
 * tratar adicional como escolha. O pedido gravado sairia certo — a guilhotina
 * do sync recalcula a partir do banco — mas o cliente já tinha lido o número
 * errado. Estes testes fixam que esse número seria visto.
 */
import { readFileSync } from "fs";
import ts from "typescript";

const js = ts.transpileModule(readFileSync("src/lib/precos-ditos.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const m = await import("data:text/javascript," + encodeURIComponent(js));
const { extrairPrecosDoTexto, conferirPrecosDitos, compararTotalDitoComGravado } = m;

let falhas = 0;
const conferir = (nome, ok, detalhe) => {
  if (ok) { console.log("  ok    " + nome); return; }
  falhas++;
  console.log("  FALHA " + nome + (detalhe ? " — " + detalhe : ""));
};
const valores = (t) => extrairPrecosDoTexto(t).map((p) => p.valor);
const igual = (nome, obtido, esperado) =>
  conferir(nome, JSON.stringify(obtido) === JSON.stringify(esperado), `obtido ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`);

console.log("\n1) Tirar o preço do texto como o robô escreve de verdade");
igual("R$ com espaço", valores("O X-Tudo sai R$ 32,90 😊"), [32.9]);
igual("R$ colado", valores("fica R$32,90"), [32.9]);
igual("ponto no lugar da vírgula", valores("R$ 21.90"), [21.9]);
igual("milhar com vírgula decimal", valores("total de R$ 1.234,56"), [1234.56]);
igual("por extenso", valores("são 21,90 reais"), [21.9]);
igual("vários na mesma frase", valores("Pastel R$ 21,90, refri R$ 8,00 e entrega R$ 5,00"), [5, 8, 21.9]);
// Achado da revisão adversarial de 19/09/2026: o modelo escreve como gente, e
// gente escreve "R$ 55,5". Com a regra antiga (só 2 casas eram decimal) isso
// virava 555 e disparava alarme falso de PREÇO IMPOSSÍVEL num total honesto.
igual("uma casa decimal só — como gente escreve", valores("fica R$ 55,5 no total"), [55.5]);
igual("uma casa, valor baixo", valores("a entrega fica R$ 7,5"), [7.5]);
igual("uma casa, três dígitos antes", valores("R$ 120,5"), [120.5]);
igual("uma casa por extenso", valores("são 8,5 reais"), [8.5]);
igual("milhar COM uma casa decimal", valores("R$ 1.234,5"), [1234.5]);
igual("milhar sem decimal continua milhar", valores("R$ 1.234"), [1234]);
igual("texto sem preço", valores("chega em uns 40 minutos"), []);
igual("número solto não é preço", valores("são 2 pastéis, pedido 1234, 30 minutos"), []);
igual("vazio", valores(""), []);
igual("nulo não explode", valores(null), []);

console.log("\n2) O pastel de R$ 131,40 — COM A RÉGUA DE PRODUÇÃO, sem teto forçado");
// A primeira versão deste teste passava `tetoManual: 100`, um valor que produção
// nunca usa — e com o teto real (piso de R$ 500) o pastel NÃO era marcado. A
// revisão adversarial de 19/09/2026 derrubou isso. Agora o teste usa a régua de
// verdade e afirma em que balde o caso cai.
const CARDAPIO_PASTEL = [21.9, 18.9, 24.9, 8.0, 12.5, 5.0]; // maior = 24,90
const pastel = conferirPrecosDitos({
  texto: "Fica assim: 1 Pastel de Carne com todos os adicionais dá R$ 131,40 😊",
  precosDoCardapio: CARDAPIO_PASTEL,
});
conferir("a régua sai do cardápio, sem piso inventado (24,90 × 3 = 74,70)", pastel.tetoDeItemUnico === 74.7, `obtido ${pastel.tetoDeItemUnico}`);
conferir("R$ 131,40 é sinalizado como SUSPEITO", pastel.suspeitos.includes(131.4), JSON.stringify(pastel));
conferir("e NÃO fica escondido no balde de ruído", !pastel.desconhecidos.includes(131.4));
conferir("e não é confundido com preço conhecido", !pastel.conhecidos.includes(131.4));
// Honestidade: 131,40 não é "impossível" — um pedido de 6 pastéis dá isso. Quem
// pega o caso com certeza é compararTotalDitoComGravado, na seção 7.
conferir("não é marcado como impossível (seria exagero: 6 pastéis dão isso)", !pastel.impossiveis.includes(131.4));

console.log("\n3) Preço que ESTÁ no cardápio passa limpo");
const ok1 = conferirPrecosDitos({ texto: "O pastel de carne é R$ 21,90", precosDoCardapio: CARDAPIO_PASTEL });
igual("21,90 é conhecido", ok1.conhecidos, [21.9]);
igual("nada impossível", ok1.impossiveis, []);
igual("nada desconhecido", ok1.desconhecidos, []);

console.log("\n4) Soma legítima não pode virar alarme");
const soma = conferirPrecosDitos({
  texto: "2 pastéis R$ 21,90 cada, com a entrega de R$ 5,00, fica R$ 48,80",
  precosDoCardapio: CARDAPIO_PASTEL,
});
igual("a soma cai em desconhecido, não em impossível", soma.impossiveis, []);
conferir("e o total 48,80 aparece como desconhecido (para medir, não para gritar)", soma.desconhecidos.includes(48.8));
conferir("os preços de tabela continuam conhecidos", soma.conhecidos.includes(21.9) && soma.conhecidos.includes(5));

console.log("\n5) A régua acompanha o cardápio da loja, sem número mágico");
const festa = conferirPrecosDitos({
  texto: "Fechando o pedido da festa: R$ 438,00",
  precosDoCardapio: CARDAPIO_PASTEL, // maior 24,90 → item único 74,70 · absurdo 498
});
igual("R$ 438 de pedido de festa NÃO é impossível", festa.impossiveis, []);
conferir("mas entra em suspeito, que é só medida", festa.suspeitos.includes(438));
conferir("teto de absurdo = 24,90 × 20", Math.round(festa.teto * 100) / 100 === 498, `teto ${festa.teto}`);
const caro = conferirPrecosDitos({ texto: "R$ 900,00", precosDoCardapio: [100] });
conferir("cardápio caro sobe a régua junto (100 × 20 = 2000)", caro.impossiveis.length === 0, `teto ${caro.teto}`);
const barato = conferirPrecosDitos({ texto: "R$ 300,00", precosDoCardapio: [8] });
conferir("cardápio barato BAIXA a régua junto: R$ 300 numa loja de R$ 8 é impossível", barato.impossiveis.includes(300), `teto ${barato.teto}`);

console.log("\n6) Cardápio vazio não derruba e não inventa alarme");
const semCardapio = conferirPrecosDitos({ texto: "R$ 21,90", precosDoCardapio: [] });
conferir("sem cardápio nada é conhecido", semCardapio.conhecidos.length === 0);
conferir("sem régua, nada é impossível (não há com o que comparar)", semCardapio.impossiveis.length === 0);
conferir("nem suspeito", semCardapio.suspeitos.length === 0);
conferir("o valor ainda é medido", semCardapio.desconhecidos.includes(21.9));

console.log("\n7) Total dito x total gravado");
const g = (a, b) => compararTotalDitoComGravado({ ditoPelaIa: a, gravadoPeloSistema: b });
conferir("iguais não divergem", g(48.8, 48.8).houve === false);
conferir("um centavo é arredondamento, não divergência", g(48.8, 48.81).houve === false);
conferir("50 centavos é 'centavos'", g(48.8, 49.3).gravidade === "centavos");
conferir("R$ 5 de diferença é 'real'", g(48.8, 53.8).gravidade === "real");
conferir("o pastel (131,40 dito, 21,90 gravado) é GRAVE", g(131.4, 21.9).gravidade === "grave");
conferir("proporção > 25% é grave mesmo em valor pequeno", g(10, 20).gravidade === "grave");
conferir("sem total dito não há divergência", g(undefined, 48.8).houve === false);
conferir("total dito zero não conta", g(0, 48.8).houve === false);
conferir("lado certo: gravado maior = cliente ouviu MENOS", g(40, 50).resumo.includes("ouviu MENOS"));
conferir("lado certo: gravado menor = cliente ouviu MAIS", g(50, 40).resumo.includes("ouviu MAIS"));
conferir("a diferença vai no resumo", g(131.4, 21.9).resumo.includes("109.50"));

console.log(falhas === 0 ? "\n✅ tudo certo\n" : `\n❌ ${falhas} falha(s)\n`);
process.exit(falhas === 0 ? 0 : 1);
