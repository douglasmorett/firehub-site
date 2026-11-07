/**
 * Trava a Previsão de insumos (lib/relatorios/previsao-de-insumos.ts): a
 * média do MESMO dia da semana (sexta com sexta), o dia sem venda como zero,
 * o dia da semana que ainda não aconteceu na base, o custo previsto e o
 * insumo sem custo fora do valor.
 *
 *   npx tsx scripts/teste-previsao-de-insumos.ts
 */
import { diaDaSemana, previsaoDeInsumos, proximosDias } from "../src/lib/relatorios/previsao-de-insumos";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

console.log("\n1) Os dias");
confere("06/11/2026 é sexta; 08/11 é domingo", [diaDaSemana("2026-11-06"), diaDaSemana("2026-11-08")], [5, 0]);
confere("os 7 dias a partir de sábado 07/11", proximosDias("2026-11-07"), ["2026-11-07", "2026-11-08", "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"]);

console.log("\n2) A média do mesmo dia da semana");
// Base: 2 semanas, 23/10 (sexta) a 05/11 (quinta). Sextas vendem muito; segunda a loja fecha.
const base = proximosDias("2026-10-23", 14);
const dia = (q: Record<string, number>) => new Map(Object.entries(q));
const consumo = new Map<string, Map<string, number>>([
  ["2026-10-23", dia({ queijo: 3000, pao: 100 })], // sexta
  ["2026-10-30", dia({ queijo: 5000, pao: 140 })], // sexta
  ["2026-10-24", dia({ queijo: 1000, pao: 40 })],  // sábado
  // sábado 31/10 sem venda: entra como zero
  ["2026-10-28", dia({ queijo: 600, pao: 20 })],   // quarta
  ["2026-11-04", dia({ queijo: 400, pao: 20, sache: 50 })], // quarta
]);
const r = previsaoDeInsumos({
  consumoPorDia: consumo, diasDaBase: base, dias: proximosDias("2026-11-06"),
  insumos: [
    { id: "queijo", nome: "Cheddar", unidade: "g", custo: 0.05 },
    { id: "pao", nome: "Pão", unidade: "un", custo: 1.5 },
    { id: "sache", nome: "Sachê", unidade: "un", custo: null },
    { id: "nada", nome: "Nunca usado", unidade: "un", custo: 9 },
  ],
});
confere("os rótulos começam na sexta 06/11", r.dias.map((d) => d.rotulo), ["Sex 06/11", "Sáb 07/11", "Dom 08/11", "Seg 09/11", "Ter 10/11", "Qua 11/11", "Qui 12/11"]);
const queijo = r.linhas.find((l) => l.id === "queijo")!;
confere("cheddar: sexta = (3000+5000)/2, sábado = (1000+0)/2, quarta = (600+400)/2, o resto zero", queijo.porDia, [4000, 500, 0, 0, 0, 500, 0]);
confere("total e custo da semana do cheddar", [queijo.total, queijo.custoTotal], [5000, 250]);
confere("o sachê sem custo aparece com a quantidade e custo null; o insumo sem consumo não aparece",
  [r.linhas.find((l) => l.id === "sache")?.custoTotal, r.linhas.find((l) => l.id === "sache")?.total, r.linhas.some((l) => l.id === "nada")], [null, 25, false]);
confere("custo de cada dia só com quem tem custo (sexta: 4000 × 0,05 + 120 × 1,5)", r.dias.map((d) => d.custo), [380, 55, 0, 0, 0, 55, 0]);
confere("o mais caro primeiro; total da semana; 1 sem custo", [r.linhas.map((l) => l.id), r.totais.custo, r.totais.insumosSemCusto], [["queijo", "pao", "sache"], 490, 1]);

console.log("\n3) Loja nova: o dia da semana que ainda não aconteceu");
const nova = previsaoDeInsumos({ consumoPorDia: consumo, diasDaBase: ["2026-11-04"], dias: proximosDias("2026-11-06"), insumos: [{ id: "queijo", nome: "Cheddar", unidade: "g", custo: 0.05 }] });
confere("só a quarta tem amostra; a média dela é a própria quarta", [nova.dias.map((d) => d.amostras), nova.linhas[0].porDia], [[0, 0, 0, 0, 0, 1, 0], [0, 0, 0, 0, 0, 400, 0]]);

console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
