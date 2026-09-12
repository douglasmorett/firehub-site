/**
 * Prova do filtro de telefone-carimbo.
 *
 *   node scripts/teste-telefone-de-verdade.mjs
 */
import { readFileSync } from "fs";
import ts from "typescript";

const js = ts.transpileModule(readFileSync("src/lib/telefone.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { telefoneDeVerdade } = await import("data:text/javascript," + encodeURIComponent(js));

// [numero, deve aceitar?, de onde vem]
const CASOS = [
  ["(22) 99999-1020", true, "cliente do site"],
  ["22999991020", true, "cliente, só dígitos"],
  ["5522999991020", true, "com o 55 do país"],
  ["+55 21 99534-5200", true, "iFood com DDI"],
  ["2126661234", true, "fixo de 10 dígitos"],
  ["00000000000", false, "carimbo do balcão e da mesa"],
  ["0000000000", false, "carimbo de 10"],
  ["11111111111", false, "tudo o mesmo dígito"],
  ["0800 705 1020 ID: 32511427", false, "0800 do iFood com ramal"],
  ["+55 21995358507 (ramal 81513893)", true, "99Food: número real com ramal entre parênteses"],
  ["0800 700 3050", false, "0800 puro"],
  ["08007051020", false, "0800 sem espaços"],
  ["0300 123 4567", false, "0300"],
  ["999", false, "curto demais"],
  ["", false, "vazio"],
  [null, false, "nulo"],
  ["0199999991020", false, "DDD 01 não existe"],
];

let falhas = 0;
for (const [numero, esperado, origem] of CASOS) {
  const r = telefoneDeVerdade(numero);
  const ok = r === esperado;
  if (!ok) falhas++;
  console.log(
    `${ok ? "ok   " : "FALHA"}  ${JSON.stringify(numero).padEnd(34)} ${String(r).padEnd(5)} (${origem})`,
  );
}

console.log(falhas === 0 ? "\nTUDO OK\n" : `\n${falhas} FALHA(S)\n`);
process.exit(falhas === 0 ? 0 : 1);
