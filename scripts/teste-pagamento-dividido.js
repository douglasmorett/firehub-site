/**
 * METADE NO DÉBITO, METADE NO CRÉDITO — E O CAIXA TEM QUE FECHAR.
 *
 * O cliente escolhe "dinheiro" no pedido, chega no caixa e paga dividido. Até
 * 20/09/2026 a troca de pagamento do painel aceitava UMA forma só — e, pior,
 * APAGAVA as partes de um pedido que já vinha dividido do balcão. O operador
 * escolhia uma, e o fechamento cobrava da gaveta um valor que passou na
 * maquininha.
 *
 * O que este harness protege:
 *
 *   1. a divisão só é aceita quando FECHA com o total (gravar partes que não
 *      somam é criar diferença de caixa que ninguém acha depois);
 *   2. a conta é em CENTAVOS — três partes de R$ 33,33 num pedido de R$ 99,99
 *      fecham em centavos e não fecham em float;
 *   3. o formato gravado é EXATAMENTE o que o fechamento de caixa já lê
 *      (lib/pagamentos-da-mesa.ts → lerPagamentos), senão as partes viram
 *      "forma não identificada" e saem da conferência.
 *
 *   node scripts/teste-pagamento-dividido.js
 */
const path = require("path");
const createJiti = require("jiti");

const RAIZ = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, {
  alias: { "@": path.resolve(RAIZ, "src") },
  interopDefault: true,
  esmResolve: true,
});

const D = jiti(path.resolve(RAIZ, "src", "lib", "pagamento-dividido.ts"));
const { lerPagamentos } = jiti(path.resolve(RAIZ, "src", "lib", "pagamentos-da-mesa.ts"));
const { FORMAS_DE_PAGAMENTO_NA_ENTREGA } = jiti(path.resolve(RAIZ, "src", "lib", "pagamento-na-entrega.ts"));

let ok = 0, falhou = 0;
const exigir = (nome, condicao, detalhe) => {
  if (condicao) { ok++; console.log("  ok     " + nome); }
  else { falhou++; console.log("  FALHOU " + nome + (detalhe ? "\n         " + detalhe : "")); }
};

console.log("\n== A divisão só passa quando fecha ==");

const metade = [{ method: "Cartão Débito", amount: 25 }, { method: "Cartão Crédito", amount: 25 }];
const r1 = D.validarDivisao(metade, 50);
exigir("metade/metade num pedido de R$ 50 fecha", r1.ok === true);
exigir("o resumo sai legível", r1.ok && r1.resumo === "Dividido: Cartão Débito R$ 25,00 + Cartão Crédito R$ 25,00", r1.ok ? r1.resumo : "");

const r2 = D.validarDivisao([{ method: "Dinheiro", amount: 20 }, { method: "Pix", amount: 20 }], 50);
exigir("soma menor que o total é recusada", r2.ok === false);
exigir("o erro diz os dois números", r2.ok === false && /40,00/.test(r2.erro) && /50,00/.test(r2.erro), r2.ok === false ? r2.erro : "");

const r3 = D.validarDivisao([{ method: "Dinheiro", amount: 40 }, { method: "Pix", amount: 20 }], 50);
exigir("soma maior que o total é recusada", r3.ok === false);

const r4 = D.validarDivisao([{ method: "Dinheiro", amount: 50 }], 50);
exigir("uma parte só não é divisão", r4.ok === false && /duas formas/i.test(r4.erro));

const r5 = D.validarDivisao([{ method: "Boleto", amount: 25 }, { method: "Pix", amount: 25 }], 50);
exigir("forma desconhecida é recusada", r5.ok === false && /inválida/i.test(r5.erro));

console.log("\n== Centavos, nunca float ==");
const tresPartes = [
  { method: "Dinheiro", amount: 33.33 },
  { method: "Pix", amount: 33.33 },
  { method: "Cartão Débito", amount: 33.33 },
];
exigir("0.1 + 0.2 em float não estraga a soma", D.somarPartes([{ method: "Pix", amount: 0.1 }, { method: "Dinheiro", amount: 0.2 }]) === 0.3);
const r6 = D.validarDivisao(tresPartes, 99.99);
exigir("três partes de 33,33 fecham 99,99", r6.ok === true, r6.ok ? "" : r6.erro);
const r7 = D.validarDivisao([{ method: "Dinheiro", amount: 33.33 }, { method: "Pix", amount: 33.33 }, { method: "Pix", amount: 33.34 }], 100);
exigir("tolerância de 2 centavos aceita o arredondamento", r7.ok === true, r7.ok ? "" : r7.erro);
const r8 = D.validarDivisao([{ method: "Dinheiro", amount: 33.3 }, { method: "Pix", amount: 33.3 }, { method: "Pix", amount: 33.3 }], 100);
exigir("10 centavos de diferença NÃO passa", r8.ok === false);

console.log("\n== O que falta, que é o que a tela mostra ==");
exigir("falta o que ainda não foi distribuído", D.quantoFalta([{ method: "Pix", amount: 30 }], 50) === 20);
exigir("passou vira negativo", D.quantoFalta([{ method: "Pix", amount: 60 }], 50) === -10);
exigir("fechado dá zero", D.quantoFalta(metade, 50) === 0);

console.log("\n== O formato gravado é o que o caixa lê ==");
const gravado = D.validarDivisao(metade, 50);
const lidoPeloCaixa = lerPagamentos(gravado.ok ? gravado.partes : []);
exigir("o fechamento de caixa enxerga as duas partes", lidoPeloCaixa.length === 2);
exigir("com a forma certa", lidoPeloCaixa.map((p) => p.method).join("|") === "Cartão Débito|Cartão Crédito");
exigir("com o valor certo", lidoPeloCaixa.reduce((s, p) => s + p.amount, 0) === 50);
// A régua do caixa (api/cash-session, `somarParte`) casa por palavra. Uma
// forma que não casasse cairia em "não identificado" e sairia da conferência.
const reguaDoCaixa = (m) => {
  const t = m.toLowerCase();
  if (t.includes("dinheiro") || t.includes("cash")) return "cash";
  if (t.includes("débito") || t.includes("debito") || t.includes("debit")) return "debit";
  if (t.includes("crédito") || t.includes("credito") || t.includes("credit")) return "credit";
  if (t.includes("pix")) return "pix";
  if (t.includes("voucher") || t.includes("vale") || t.includes("meal") || t.includes("food")) return "voucher";
  if (t.includes("cart") || t.includes("maquin")) return "credit";
  return null;
};
for (const f of FORMAS_DE_PAGAMENTO_NA_ENTREGA) {
  exigir(`"${f}" cai numa linha da conferência`, reguaDoCaixa(f) !== null);
}

console.log("\n== Leitura tolerante (metodo/valor em português) ==");
const emPortugues = D.lerPartes([{ metodo: "Pix", valor: "25" }, { metodo: "Dinheiro", valor: 25 }]);
exigir("aceita metodo/valor como a tela nomeia", emPortugues.length === 2 && emPortugues[0].method === "Pix" && emPortugues[0].amount === 25);
exigir("parte zerada é descartada", D.lerPartes([{ method: "Pix", amount: 0 }, { method: "Dinheiro", amount: 10 }]).length === 1);
exigir("lista vazia não quebra", D.lerPartes(null).length === 0 && D.lerPartes("nada").length === 0);

console.log(`\n${ok} ok, ${falhou} falharam\n`);
process.exit(falhou ? 1 : 0);
