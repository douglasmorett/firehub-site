/**
 * Prova do endereço do cardápio.
 *
 *   node scripts/teste-slug-da-loja.mjs
 */
import { readFileSync } from "fs";
import ts from "typescript";

const js = ts.transpileModule(readFileSync("src/lib/slug-da-loja.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { slugDoNome, nomeDaLojaPeloCnpj, pareceNomeDePessoa, slugAposRenomear } = await import(
  "data:text/javascript," + encodeURIComponent(js)
);

let falhas = 0;
const conferir = (nome, ok, detalhe) => {
  if (ok) { console.log("  ok    " + nome); return; }
  falhas++;
  console.log("  FALHA " + nome + (detalhe ? " — " + detalhe : ""));
};

console.log("\n1) Nome vira endereço");
for (const [entrada, esperado] of [
  ["Frangoso - Trindade", "frangoso-trindade"],
  ["Açaí do Zé & Cia.", "acai-do-ze-cia"],
  ["65.584.171 LUCAS PIMENTA MARINHO MACHADO", "65-584-171-lucas-pimenta-marinho-machado"],
  ["   Pizzaria   do   Centro   ", "pizzaria-do-centro"],
  ["---", ""],
  ["", ""],
]) {
  const r = slugDoNome(entrada);
  conferir(`${JSON.stringify(entrada)} -> ${JSON.stringify(r)}`, r === esperado, `esperado ${esperado}`);
}

console.log("\n2) O nome do CNPJ: o que a pessoa digitou vence a razão social");
conferir("nome fantasia sempre ganha",
  nomeDaLojaPeloCnpj({ nome_fantasia: "Frangoso", razao_social: "65.584.171 LUCAS" }, "Frangoso Trindade") === "Frangoso");
conferir("sem fantasia, vale o digitado (era o bug do Lucas)",
  nomeDaLojaPeloCnpj({ nome_fantasia: "", razao_social: "65.584.171 LUCAS PIMENTA" }, "Frangoso") === "Frangoso");
conferir("sem fantasia e sem digitado, cai na razão social",
  nomeDaLojaPeloCnpj({ nome_fantasia: null, razao_social: "COMERCIO X LTDA" }, "") === "COMERCIO X LTDA");
conferir("sem nada devolve vazio", nomeDaLojaPeloCnpj(null, null) === "");

console.log("\n3) Reconhece razão social de MEI (para avisar, não para bloquear)");
conferir("com número na frente", pareceNomeDePessoa("65.584.171 LUCAS PIMENTA MARINHO MACHADO"));
conferir("nome completo puro", pareceNomeDePessoa("Maria Aparecida da Silva"));
conferir("empresa com LTDA não", !pareceNomeDePessoa("Frangoso Comercio de Alimentos LTDA"));
conferir("nome de loja curto não", !pareceNomeDePessoa("Frangoso Trindade"));
conferir("com palavra de negócio não", !pareceNomeDePessoa("Pizzaria Dois Irmaos"));
conferir("vazio não", !pareceNomeDePessoa(""));

console.log("\n4) Renomear leva o link junto, sem perder o antigo");
const r1 = slugAposRenomear("Frangoso - Trindade", "65-584-171-lucas-pimenta-marinho-machado", null);
conferir("slug novo", r1?.slug === "frangoso-trindade");
conferir("guardou o antigo", r1?.slugsAntigos.includes("65-584-171-lucas-pimenta-marinho-machado"));

const r2 = slugAposRenomear("Frangoso - Trindade", "frangoso-trindade", ["velho"]);
conferir("nome igual não mexe em nada", r2 === null);

const r3 = slugAposRenomear("Frangoso Trindade", "frangoso-novo", ["frangoso-trindade", "antigo"]);
conferir("voltar para um slug antigo o tira do histórico",
  r3?.slug === "frangoso-trindade" && !r3.slugsAntigos.includes("frangoso-trindade"),
  JSON.stringify(r3));
conferir("e guarda o que estava em uso", r3?.slugsAntigos.includes("frangoso-novo"));

const r4 = slugAposRenomear("", "qualquer", []);
conferir("nome vazio não troca nada", r4 === null);

// Histórico não cresce para sempre
let hist = [];
for (let i = 0; i < 30; i++) hist.push("slug-" + i);
const r5 = slugAposRenomear("Novo Nome", "atual", hist);
conferir(`histórico limitado (${r5?.slugsAntigos.length} guardados)`, (r5?.slugsAntigos.length || 0) <= 20);

console.log(falhas === 0 ? "\nTUDO OK\n" : `\n${falhas} FALHA(S)\n`);
process.exit(falhas === 0 ? 0 : 1);
