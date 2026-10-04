/**
 * Prova das regras de repetir o pronto/saiu/concluído que o iFood barrou.
 *
 *   node scripts/teste-ifood-acao-pendente.mjs
 *
 * O 403 é a página que a produção recebeu em 03/10/2026 no dispatch e no
 * conclude (Frangoso - Trindade e outras lojas, mesma noite).
 */
import { readFileSync } from "fs";
import ts from "typescript";

// O banco não entra nas regras: o import do prisma vira um objeto vazio.
const fonte = readFileSync("src/lib/ifood-acao-pendente.ts", "utf8")
  .replace(/^import \{ prisma \} from "@\/lib\/prisma";$/m, "const prisma = {};");
const js = ts.transpileModule(fonte, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { foiBarrado, aindaVale, horaDeRepetir, ehAcaoRepetivel } = await import(
  "data:text/javascript," + encodeURIComponent(js)
);

let falhas = 0;
const igual = (nome, obtido, esperado) => {
  if (obtido === esperado) { console.log("  ok    " + nome); return; }
  falhas++;
  console.log(`  FALHA ${nome} — obtido ${obtido}, esperado ${esperado}`);
};

const accessDenied = `<HTML><HEAD>
<TITLE>Access Denied</TITLE>
</HEAD><BODY>
<H1>Access Denied</H1>
You don't have permission to access "http&#58;&#47;&#47;merchant&#45;api&#46;ifood&#46;com&#46;br&#47;order&#47;v1&#46;0&#47;orders&#47;x&#47;dispatch" on this server.`;

console.log("\n1) O que é bloqueio (repete) e o que é resposta (não repete)");
igual("403 HTML Access Denied é barrado", foiBarrado({ status: 403, texto: accessDenied }), true);
igual("sem rede (status 0) é barrado", foiBarrado({ status: 0, texto: "fetch failed" }), true);
igual("429 é barrado", foiBarrado({ status: 429, texto: "" }), true);
igual("502 é barrado", foiBarrado({ status: 502, texto: "" }), true);
igual("403 JSON de credencial não é", foiBarrado({ status: 403, texto: '{"code":"ForbiddenOrderAccess"}' }), false);
igual("400 transição inválida não é", foiBarrado({ status: 400, texto: '{"code":"BadRequest"}' }), false);
igual("422 já concluído não é", foiBarrado({ status: 422, texto: "{}" }), false);
igual("202 não é", foiBarrado({ status: 202, texto: "" }), false);

console.log("\n2) Quais ações entram");
igual("dispatch", ehAcaoRepetivel("dispatch"), true);
igual("readyToPickup", ehAcaoRepetivel("readyToPickup"), true);
igual("conclude", ehAcaoRepetivel("conclude"), true);
igual("confirm fica de fora (o polling confirma)", ehAcaoRepetivel("confirm"), false);
igual("cancel fica de fora", ehAcaoRepetivel("cancel"), false);

console.log("\n3) A ação ainda vale para o pedido como ele está");
igual("dispatch com o pedido na rua", aindaVale("dispatch", "SAIU_ENTREGA"), true);
igual("dispatch com o pedido entregue (o conclude precisa dele)", aindaVale("dispatch", "ENTREGUE"), true);
igual("dispatch de pedido cancelado não", aindaVale("dispatch", "CANCELADO"), false);
igual("dispatch de pedido que voltou para a cozinha não", aindaVale("dispatch", "ACEITO"), false);
igual("readyToPickup antes de sair", aindaVale("readyToPickup", "ACEITO"), true);
igual("readyToPickup com o pedido na rua não", aindaVale("readyToPickup", "SAIU_ENTREGA"), false);
igual("conclude entregue", aindaVale("conclude", "ENTREGUE"), true);
igual("conclude na rua não", aindaVale("conclude", "SAIU_ENTREGA"), false);

console.log("\n4) Quando tentar de novo");
const agora = Date.parse("2026-10-04T00:30:00Z");
const p = (desdeMin, ultimaMin) => ({
  desde: new Date(agora - desdeMin * 60_000).toISOString(),
  ultimaTentativa: new Date(agora - ultimaMin * 60_000).toISOString(),
  tentativas: 1, status: 403, texto: "Access Denied",
});
igual("barrado há 3 min, última há 3 min: tenta", horaDeRepetir(p(3, 3), agora), true);
igual("última há 1 min: espera", horaDeRepetir(p(5, 1), agora), false);
igual("barrado há 4 h: desiste", horaDeRepetir(p(240, 10), agora), false);
igual("sem pendência: nada", horaDeRepetir(null, agora), false);

console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
