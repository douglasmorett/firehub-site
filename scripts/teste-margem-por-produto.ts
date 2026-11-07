/**
 * Trava a Margem por produto (lib/relatorios/margem-por-produto.ts): margem
 * unitária e total, markup, % do faturamento, o produto SEM CUSTO (nunca
 * margem de 100%), o parcial (combo com opção sem ficha) e a matriz
 * estrela / vaca leiteira / quebra-cabeça / abacaxi.
 *
 *   npx tsx scripts/teste-margem-por-produto.ts
 */
import { margemPorProduto, type ItemComCusto } from "../src/lib/relatorios/margem-por-produto";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

// Um item por venda, como a rota monta (preço × quantidade, custo do item inteiro).
const vendas = (chave: string, n: number, preco: number, custoUnit: number | null, faltas: string[] = []): ItemComCusto[] =>
  Array.from({ length: n }, () => ({ chave, nome: chave, quantidade: 1, valor: preco, custo: custoUnit, faltas: custoUnit == null ? faltas : [] }));

const r = margemPorProduto([
  ...vendas("x-burger", 50, 30, 10),   // popular, sobra 20
  ...vendas("smash", 40, 25, 15),      // popular, sobra 10
  ...vendas("costela", 5, 45, 15),     // pouco pedido, sobra 30
  ...vendas("veggie", 5, 28, 20),      // pouco pedido, sobra 8
  ...vendas("milk", 30, 18, null, ["sem ficha técnica"]),
  // Combo: 8 vendas com custo, 2 com a opção sem ficha.
  ...vendas("combo", 8, 40, 16),
  ...vendas("combo", 2, 40, null, ["opção Suco sem ficha"]),
]);
const p = (k: string) => r.produtos.find((x) => x.chave === k)!;

console.log("\n1) As contas do produto");
confere("X-Burger: preço 30, custo 10, sobra 20 un. e 1.000 total, margem 66,67%, markup 3",
  [p("x-burger").precoMedio, p("x-burger").custoUnitario, p("x-burger").margemUnitaria, p("x-burger").margemTotal, p("x-burger").margemPct, p("x-burger").markup], [30, 10, 20, 1000, 66.67, 3]);
confere("% do faturamento: 1.500 de 3.805", p("x-burger").pctDoFaturamento, 39.42);

console.log("\n2) Sem custo não é margem de 100%");
const milk = p("milk");
confere("Milk Shake: custo, margem e markup null; o motivo vai junto; fora da matriz",
  [milk.custoTotal, milk.margemUnitaria, milk.margemTotal, milk.margemPct, milk.markup, milk.quadrante, milk.faltas], [null, null, null, null, null, null, ["sem ficha técnica"]]);
confere("combo parcial: margem só nas 8 vendas com custo (8 × 24), o valor é das 10",
  [p("combo").quantidade, p("combo").quantidadeComCusto, p("combo").valor, p("combo").margemTotal, p("combo").faltas], [10, 8, 400, 192, ["opção Suco sem ficha"]]);
confere("totais: margem das vendas com custo; cobertura = 3.185 de 3.805; 1 produto sem custo",
  [r.totais.valor, r.totais.valorComCusto, r.totais.custo, r.totais.margem, r.totais.coberturaPct, r.totais.produtosSemCusto], [3805, 3185, 1403, 1782, 83.71, 1]);

console.log("\n3) A matriz");
// Com custo: 5 produtos, 108 unidades; corte = 70% × 20% = 14% (15,1 un).
// Margem média = (50×20 + 40×10 + 5×30 + 5×8 + 8×24) / 108 = 1782/108 = 16,5.
confere("corte de popularidade e margem média", [r.matriz.corteDePopularidadePct, r.matriz.margemMedia], [14, 16.5]);
confere("x-burger estrela, smash vaca, costela quebra-cabeça, veggie abacaxi, combo (8 = 7,4%) quebra-cabeça",
  ["x-burger", "smash", "costela", "veggie", "combo"].map((k) => p(k).quadrante), ["estrela", "vaca", "quebraCabeca", "abacaxi", "quebraCabeca"]);
confere("contagem", r.matriz.contagem, { estrela: 1, vaca: 1, quebraCabeca: 2, abacaxi: 1 });
confere("ordem: maior sobra total primeiro; o sem custo por último", r.produtos.map((x) => x.chave), ["x-burger", "smash", "combo", "costela", "veggie", "milk"]);

console.log("\n4) Um produto só não faz matriz");
const um = margemPorProduto(vendas("x-burger", 3, 30, 10));
confere("sem comparação, sem quadrante", [um.produtos[0].quadrante, um.matriz.contagem.estrela], [null, 0]);

console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
