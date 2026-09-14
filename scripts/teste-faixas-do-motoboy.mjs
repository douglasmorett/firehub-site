/**
 * Prova das faixas de km do entregador — é o que a loja paga de verdade.
 *
 *   node scripts/teste-faixas-do-motoboy.mjs
 */
import { readFileSync } from "fs";
import ts from "typescript";

const js = ts.transpileModule(readFileSync("src/lib/faixas-do-motoboy.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const M = await import("data:text/javascript," + encodeURIComponent(js));
const { lerFaixasDoMotoboy, valorDaFaixa, problemasDasFaixas, explicarFaixas } = M;

let falhas = 0;
const conferir = (nome, ok, detalhe) => {
  if (ok) { console.log("  ok    " + nome); return; }
  falhas++;
  console.log("  FALHA " + nome + (detalhe ? " — " + detalhe : ""));
};

const FAIXAS = lerFaixasDoMotoboy([
  { ate: 2, valor: 5 },
  { ate: 4, valor: 7 },
  { ate: 6, valor: 9 },
]);

console.log("\n1) Leitura e saneamento");
conferir("leu as 3 faixas", FAIXAS.length === 3);
conferir("ordenou por distância", FAIXAS[0].ate === 2 && FAIXAS[2].ate === 6);
conferir("aceita o formato antigo {km, value}",
  lerFaixasDoMotoboy([{ km: 3, value: 6 }])[0].valor === 6);
conferir("faixa sem distância é descartada", lerFaixasDoMotoboy([{ ate: 0, valor: 5 }]).length === 0);
conferir("faixa com valor negativo é descartada", lerFaixasDoMotoboy([{ ate: 2, valor: -1 }]).length === 0);
conferir("valor zero é faixa válida (entrega de cortesia)", lerFaixasDoMotoboy([{ ate: 2, valor: 0 }]).length === 1);
conferir("lixo vira lista vazia", lerFaixasDoMotoboy(null).length === 0 && lerFaixasDoMotoboy("x").length === 0);
conferir("duas faixas na mesma distância viram uma",
  lerFaixasDoMotoboy([{ ate: 2, valor: 5 }, { ate: 2, valor: 9 }]).length === 1);
conferir("e vence a primeira escrita",
  lerFaixasDoMotoboy([{ ate: 2, valor: 5 }, { ate: 2, valor: 9 }])[0].valor === 5);

console.log("\n2) Quanto o entregador recebe");
conferir("1 km cai na faixa de 2", valorDaFaixa(FAIXAS, 1) === 5);
conferir("exatamente 2 km ainda é a faixa de 2", valorDaFaixa(FAIXAS, 2) === 5);
conferir("2,1 km sobe para a faixa de 4", valorDaFaixa(FAIXAS, 2.1) === 7);
conferir("5 km cai na faixa de 6", valorDaFaixa(FAIXAS, 5) === 9);
conferir("acima da última faixa vale a última", valorDaFaixa(FAIXAS, 30) === 9);
conferir("sem distância não há resposta", valorDaFaixa(FAIXAS, null) === null && valorDaFaixa(FAIXAS, 0) === null);
conferir("sem faixa cadastrada não há resposta", valorDaFaixa([], 3) === null);

console.log("\n3) O que a tela barra");
conferir("distância zero é barrada", problemasDasFaixas([{ ate: 0, valor: 5 }]).length > 0);
conferir("distância repetida é barrada",
  /mais de uma faixa/.test(problemasDasFaixas([{ ate: 2, valor: 5 }, { ate: 2, valor: 7 }])[0]));
conferir("faixas válidas passam", problemasDasFaixas(FAIXAS).length === 0);

console.log("\n4) A frase de conferência");
conferir("descreve as faixas e o acima de",
  explicarFaixas(FAIXAS) === "até 2 km R$ 5,00 · até 4 km R$ 7,00 · até 6 km R$ 9,00 · acima de 6 km R$ 9,00",
  explicarFaixas(FAIXAS));
conferir("sem faixa, sem frase", explicarFaixas([]) === "");

console.log(falhas === 0 ? "\nTUDO OK\n" : `\n${falhas} FALHA(S)\n`);
process.exit(falhas === 0 ? 0 : 1);
