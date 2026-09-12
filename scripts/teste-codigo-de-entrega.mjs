/**
 * Prova da regra do código de entrega do iFood no app do motoboy.
 *
 *   node scripts/teste-codigo-de-entrega.mjs
 *
 * Os casos são as respostas documentadas do módulo Order (referência da API e
 * guia de implementação) e o 403 real que a Frangoso - Trindade recebeu em
 * 12/09/2026 nas três entregas da noite, quando a conferência ainda ia para o
 * módulo Logistics.
 */
import { readFileSync } from "fs";
import ts from "typescript";

const js = ts.transpileModule(readFileSync("src/lib/codigo-de-entrega.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { lerRespostaCodigoIfood, jaSaiuNoParceiro } = await import(
  "data:text/javascript," + encodeURIComponent(js)
);

let falhas = 0;
const conferir = (nome, ok, detalhe) => {
  if (ok) { console.log("  ok    " + nome); return; }
  falhas++;
  console.log("  FALHA " + nome + (detalhe ? " — " + detalhe : ""));
};
const igual = (nome, obtido, esperado) => conferir(nome, obtido === esperado, `obtido ${obtido}, esperado ${esperado}`);

console.log("\n1) iFood: o que confere, o que é código errado e o que é falha");
igual("200 {success:true} (referência da API) confere", lerRespostaCodigoIfood({ ok: true, status: 200, data: { success: true } }), "conferido");
igual("200 {valid:true} (guia de implementação) confere", lerRespostaCodigoIfood({ ok: true, status: 200, data: { valid: true } }), "conferido");
igual("200 {success:false} é código errado", lerRespostaCodigoIfood({ ok: true, status: 200, data: { success: false } }), "errado");
igual("200 {valid:false} é código errado", lerRespostaCodigoIfood({ ok: true, status: 200, data: { valid: false } }), "errado");
igual("422 é código errado", lerRespostaCodigoIfood({ ok: false, status: 422, data: null }), "errado");
igual(
  "403 Forbidden da Frangoso (12/09) não prende o motoboy",
  lerRespostaCodigoIfood({ ok: false, status: 403, data: { error: { code: "Forbidden", message: "User is forbidden to access this resource" } } }),
  "indisponivel",
);
igual("404 não prende", lerRespostaCodigoIfood({ ok: false, status: 404, data: null }), "indisponivel");
igual("500 não prende", lerRespostaCodigoIfood({ ok: false, status: 500, data: null }), "indisponivel");
igual("sem resposta (status 0) não prende", lerRespostaCodigoIfood({ ok: false, status: 0 }), "indisponivel");
igual("200 sem corpo não é prova de conferência", lerRespostaCodigoIfood({ ok: true, status: 200, data: null }), "indisponivel");
igual("202 sem corpo não é prova de conferência", lerRespostaCodigoIfood({ ok: true, status: 202, data: null }), "indisponivel");
igual("success:\"true\" em texto não conta", lerRespostaCodigoIfood({ ok: true, status: 200, data: { success: "true" } }), "indisponivel");
igual("403 com {success:false} no corpo não vira código errado", lerRespostaCodigoIfood({ ok: false, status: 403, data: { success: false } }), "indisponivel");

console.log("\n2) O pedido já saiu para entrega no iFood?");
for (const [status, esperado] of [
  ["SAIU_ENTREGA", true], ["SAIU_PARA_ENTREGA", true],
  ["PRONTO", false], ["ACEITO", false], ["PREPARANDO", false], ["EM_ROTA", false], ["NOVO", false],
  [null, false], [undefined, false],
]) {
  igual(`${JSON.stringify(status)} -> ${esperado}`, jaSaiuNoParceiro(status), esperado);
}

console.log(falhas ? `\n❌ ${falhas} falha(s)\n` : "\n✅ tudo certo\n");
process.exit(falhas ? 1 : 0);
