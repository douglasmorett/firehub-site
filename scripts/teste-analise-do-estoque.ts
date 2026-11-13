/**
 * Trava as contas da tela do Estoque (lib/estoque/analise.ts): consumo médio
 * pelas saídas reais, cobertura em dias e o nível dela, curva ABC, histórico
 * de preço com a variação, margem e CMV teórico da ficha, dias sem contar.
 *
 *   npx tsx scripts/teste-analise-do-estoque.ts
 */
import {
  coberturaEmDias, consumoMedioPorDia, curvaAbc, diasSemContar, historicoDePreco, margemBaixa, margemDaFicha, nivelDaCobertura, variacao,
} from "../src/lib/estoque/analise";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

console.log("\n── Consumo médio");
const consumo = consumoMedioPorDia([
  { stockItemId: "queijo", tipo: "SALE", quantidade: -10 },
  { stockItemId: "queijo", tipo: "WASTE", quantidade: -2 },
  { stockItemId: "queijo", tipo: "OUTPUT", quantidade: -2 },
  { stockItemId: "queijo", tipo: "INPUT", quantidade: 1, notes: "Estorno cancel id: P1" }, // devolução da venda
  { stockItemId: "queijo", tipo: "INPUT", quantidade: 30, notes: "Compra" }, // compra não é consumo
  { stockItemId: "queijo", tipo: "AJUSTE", quantidade: -5 }, // acerto da contagem não é consumo
  { stockItemId: "pao", tipo: "SALE", quantidade: -140 },
], 14);
confere("queijo: (10 + 2 + 2 − 1) ÷ 14 = 0,929 por dia", consumo.get("queijo"), 0.929);
confere("pão: 140 ÷ 14 = 10 por dia", consumo.get("pao"), 10);
confere("sem movimento não aparece", consumo.has("sal"), false);

console.log("\n── Cobertura");
confere("30 un a 10/dia = 3 dias", coberturaEmDias(30, 10), 3);
confere("sem consumo = nulo", coberturaEmDias(30, 0), null);
confere("saldo zerado = 0 dia", coberturaEmDias(0, 10), 0);
confere("1,5 dia é crítico (vermelho < 2)", nivelDaCobertura(15, coberturaEmDias(15, 10)), "critico");
confere("3 dias é atenção", nivelDaCobertura(30, 3), "atencao");
confere("10 dias ok", nivelDaCobertura(100, 10), "ok");
confere("saldo 0 com consumo = acabou", nivelDaCobertura(0, 0), "acabou");
confere("sem consumo e com saldo = sem consumo", nivelDaCobertura(5, null), "semConsumo");

console.log("\n── Curva ABC");
const abc = curvaAbc([
  { id: "queijo", valor: 500 }, { id: "carne", valor: 300 }, { id: "pao", valor: 100 },
  { id: "caixa", valor: 60 }, { id: "sal", valor: 40 }, { id: "parado", valor: 0 },
]);
// total 1000: queijo começa em 0% (A), carne em 50% (A), pão em 80% (B), caixa em 90% (B), sal em 96% (C)
confere("queijo e carne = A (somam 80%)", [abc.get("queijo"), abc.get("carne")], ["A", "A"]);
confere("pão e caixa = B (até 95%)", [abc.get("pao"), abc.get("caixa")], ["B", "B"]);
confere("sal = C, parado (sem consumo) = C", [abc.get("sal"), abc.get("parado")], ["C", "C"]);
confere("um item só é A", curvaAbc([{ id: "x", valor: 10 }]).get("x"), "A");

console.log("\n── Histórico de preço");
const h = historicoDePreco([
  { dia: "2026-11-09", em: 3, custo: 45.9, quantidade: 30, fornecedor: "Atacadão" },
  { dia: "2026-10-26", em: 1, custo: 38, quantidade: 30, fornecedor: "Atacadão" },
  { dia: "2026-11-02", em: 2, custo: 42, quantidade: 30, fornecedor: "Atacadão" },
]);
confere("em ordem de data", h.compras.map((c) => c.custo), [38, 42, 45.9]);
confere("variação de cada compra para a anterior", h.compras.map((c) => c.variacaoPct), [null, 10.5, 9.3]);
confere("subiu 9,3% desde a última", h.ultimaVariacao, 9.3);
confere("subiu 20,8% no período", h.variacaoNoPeriodo, 20.8);
confere("uma compra só: sem variação", historicoDePreco([{ dia: "2026-11-01", em: 1, custo: 10, quantidade: 1, fornecedor: null }]).ultimaVariacao, null);
confere("caiu: 50 → 40 = −20%", variacao(50, 40), -20);

console.log("\n── Margem da ficha");
confere("preço 22, custo 8,80: margem 13,20 (60%), CMV 40%", margemDaFicha(22, 8.8), { margem: 13.2, margemPct: 60, cmvPct: 40 });
confere("sem custo = nulo", margemDaFicha(22, null), null);
confere("CMV de 45% é margem baixa", margemBaixa(margemDaFicha(20, 9)), true);
confere("CMV de 30% não é", margemBaixa(margemDaFicha(20, 6)), false);
confere("custo maior que o preço é margem baixa", margemBaixa(margemDaFicha(10, 12)), true);

console.log("\n── Dias sem contar");
confere("contado em 08/11, hoje 12/11 = 4 dias", diasSemContar("2026-11-08", "2026-11-12"), 4);
confere("nunca contado = nulo", diasSemContar(null, "2026-11-12"), null);

console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ Tudo certo");
process.exit(falhas ? 1 : 0);
