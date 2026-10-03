/**
 * Prova da leitura do "Importar saldos" (lib/lote-de-saldo.ts) — sem banco.
 *
 *   node scripts/teste-lote-de-saldo.mjs
 */
import { readFileSync } from "fs";
import ts from "typescript";

const js = ts.transpileModule(readFileSync("src/lib/lote-de-saldo.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const L = await import("data:text/javascript," + encodeURIComponent(js));

let falhas = 0;
const ok = (nome, cond, det) => { if (!cond) falhas++; console.log(`${cond ? "OK    " : "FALHOU"} ${nome}${cond ? "" : " → " + JSON.stringify(det)}`); };
const um = (t) => L.lerLote(t)[0];

let r = um("22999991234;25,50");
ok("CSV com ponto e vírgula", r.telefone === "22999991234" && r.valor === 25.5 && !r.erro, r);
r = um("(22) 99999-1234\tR$ 1.234,56\tJoão da Silva");
ok("planilha colada (tab) com R$ e milhar", r.telefone === "22999991234" && r.valor === 1234.56 && r.nome === "João da Silva", r);
r = um("Maria Souza +55 22 98888-7777 R$ 10");
ok("texto do WhatsApp com +55 e nome antes", r.telefone === "22988887777" && r.valor === 10 && r.nome === "Maria Souza", r);
r = um("5522977776666,15.90,Ana");
ok("CSV com vírgula e 55 colado", r.telefone === "22977776666" && r.valor === 15.9 && r.nome === "Ana", r);
r = um("22 2764-1161 ; 8");
ok("fixo de 10 dígitos", r.telefone === "2227641161" && r.valor === 8, r);
r = um("25,50;22999991234");
ok("valor antes do telefone", r.telefone === "22999991234" && r.valor === 25.5, r);
r = um("João 99999-1234 R$ 5");
ok("sem DDD é recusado (não dá para saber de quem é)", r.erro === "telefone não encontrado", r);
r = um("22999991234;");
ok("sem valor é recusado", r.erro === "valor não encontrado", r);
r = um("22999991234;0");
ok("valor zero é recusado", r.erro === "valor não encontrado", r);
r = um("22999991234;9000");
ok("valor alto demais é recusado", r.erro?.startsWith("valor acima"), r);
const lote = L.lerLote("telefone;valor;nome\n22999991234;5\n\n(22) 99999-1234;7\n21988887777;3");
ok("cabeçalho e linha vazia são ignorados", lote.length === 3, lote);
ok("telefone repetido aponta a primeira linha", lote[1].erro === "telefone repetido (linha 2)", lote[1]);
ok("a linha guarda o número dela no texto colado", lote[2].linha === 5 && lote[2].valor === 3, lote[2]);
ok("lerValorEmReais: 1.500 é mil e quinhentos", L.lerValorEmReais("1.500") === 1500);
ok("lerValorEmReais: 12.5 é doze e cinquenta", L.lerValorEmReais("12.5") === 12.5);

console.log(falhas ? `\n${falhas} falha(s)` : "\ntudo certo");
process.exit(falhas ? 1 : 0);
