/**
 * Prova da regra do código de entrega do iFood no app do motoboy.
 *
 *   node scripts/teste-codigo-de-entrega.mjs
 *
 * Os casos são as respostas que a produção deu na Frangoso - Trindade em
 * 12/09/2026 (o 403 do módulo Logistics; o 200 vazio e o 422
 * ORDER_ALREADY_CONFIRMED do módulo Order) e as que a documentação descreve.
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

console.log("\n1) iFood: o que a produção respondeu na Frangoso (12/09)");
igual("200 com corpo vazio (código certo) confere", lerRespostaCodigoIfood({ ok: true, status: 200, data: null }), "conferido");
igual(
  "422 ORDER_ALREADY_CONFIRMED (mesmo código de novo) confere",
  lerRespostaCodigoIfood({ ok: false, status: 422, data: { message: "Order is already confirmed", code: "ORDER_ALREADY_CONFIRMED" } }),
  "conferido",
);
igual(
  "403 Forbidden (era o endpoint do Logistics) não prende o motoboy",
  lerRespostaCodigoIfood({ ok: false, status: 403, data: { error: { code: "Forbidden", message: "User is forbidden to access this resource" } } }),
  "indisponivel",
);

console.log("\n2) iFood: o que a documentação descreve");
igual("200 {success:true} (referência da API) confere", lerRespostaCodigoIfood({ ok: true, status: 200, data: { success: true } }), "conferido");
igual("200 {valid:true} (guia de implementação) confere", lerRespostaCodigoIfood({ ok: true, status: 200, data: { valid: true } }), "conferido");
igual("200 {success:false} é código errado", lerRespostaCodigoIfood({ ok: true, status: 200, data: { success: false } }), "errado");
igual("200 {valid:false} é código errado", lerRespostaCodigoIfood({ ok: true, status: 200, data: { valid: false } }), "errado");
igual("202 sem corpo confere", lerRespostaCodigoIfood({ ok: true, status: 202, data: null }), "conferido");
igual("204 confere", lerRespostaCodigoIfood({ ok: true, status: 204, data: null }), "conferido");

console.log("\n3) iFood: o que prende e o que não prende");
igual("422 sem código conhecido é código errado", lerRespostaCodigoIfood({ ok: false, status: 422, data: null }), "errado");
igual("422 com outro código é código errado", lerRespostaCodigoIfood({ ok: false, status: 422, data: { code: "INVALID_CODE" } }), "errado");
// ── O 400 DO CÓDIGO ERRADO (medido em 19/09/2026) ────────────────────────
//
// Nove entregas em 30 dias receberam este corpo e foram CONCLUÍDAS assim
// mesmo, porque 400 caía em "indisponivel". O motoboy digitava errado e o
// pedido fechava — o contrário de para que o código existe.
igual(
  "400 \"Confirmation code is invalid\" é código ERRADO",
  lerRespostaCodigoIfood({ ok: false, status: 400, data: { errorType: "NOT_FOUND", description: "Confirmation code is invalid", code: "400" } }),
  "errado",
);
igual(
  "o mesmo, com o corpo chegando só como texto",
  lerRespostaCodigoIfood({ ok: false, status: 400, data: null, texto: '{"errorType":"NOT_FOUND","description":"Confirmation code is invalid","code":"400"}' }),
  "errado",
);
igual(
  "400 de requisição malformada, sem falar do código, não manda redigitar",
  lerRespostaCodigoIfood({ ok: false, status: 400, data: { code: "BadRequest", message: "malformed body" } }),
  "indisponivel",
);

// ── O 403 CONTINUA NÃO PRENDENDO ─────────────────────────────────────────
// "Access Denied" em HTML é bloqueio da plataforma e não diz nada sobre o
// código. Prender o entregador por permissão nossa foi o incidente de 12/09.
igual(
  "403 Access Denied segue indisponivel",
  lerRespostaCodigoIfood({ ok: false, status: 403, data: null, texto: "<HTML><HEAD><TITLE>Access Denied</TITLE></HEAD><BODY>You don't have permission</BODY></HTML>" }),
  "indisponivel",
);

// ── "JÁ CONFIRMADO" É CÓDIGO CERTO, VENHA COMO VIER ──────────────────────
igual(
  "422 já confirmado, corpo só em texto, confere",
  lerRespostaCodigoIfood({ ok: false, status: 422, data: null, texto: '{"message":"Order is already confirmed","code":"ORDER_ALREADY_CONFIRMED"}' }),
  "conferido",
);
igual(
  "422 já confirmado em minúsculas também confere",
  lerRespostaCodigoIfood({ ok: false, status: 422, data: { code: "order_already_confirmed" } }),
  "conferido",
);
igual("404 não prende", lerRespostaCodigoIfood({ ok: false, status: 404, data: null }), "indisponivel");
igual("500 não prende", lerRespostaCodigoIfood({ ok: false, status: 500, data: null }), "indisponivel");
igual("sem resposta (status 0) não prende", lerRespostaCodigoIfood({ ok: false, status: 0 }), "indisponivel");
igual("403 com {success:false} no corpo não vira código errado", lerRespostaCodigoIfood({ ok: false, status: 403, data: { success: false } }), "indisponivel");
igual("403 com ORDER_ALREADY_CONFIRMED não vira conferido", lerRespostaCodigoIfood({ ok: false, status: 403, data: { code: "ORDER_ALREADY_CONFIRMED" } }), "indisponivel");

console.log("\n4) O pedido já saiu para entrega no iFood?");
for (const [status, esperado] of [
  ["SAIU_ENTREGA", true], ["SAIU_PARA_ENTREGA", true],
  ["PRONTO", false], ["ACEITO", false], ["PREPARANDO", false], ["EM_ROTA", false], ["NOVO", false],
  [null, false], [undefined, false],
]) {
  igual(`${JSON.stringify(status)} -> ${esperado}`, jaSaiuNoParceiro(status), esperado);
}

console.log(falhas ? `\n❌ ${falhas} falha(s)\n` : "\n✅ tudo certo\n");
process.exit(falhas ? 1 : 0);
