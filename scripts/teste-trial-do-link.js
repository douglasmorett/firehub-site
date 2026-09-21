/**
 * O QR DA PALESTRA TEM QUE ENTREGAR OS 30 DIAS QUE O SLIDE PROMETE.
 *
 * O QR do FireHub Conect (21/09/2026) leva para
 * https://firehubfood.com.br/cadastro?ref=conect e o slide atrás do
 * palestrante diz "30 dias Grátis". O `refCode` só servia para achar
 * embaixador ou parceiro — "conect" não é nenhum dos dois, caía fora, e a
 * conta nascia com os 15 de sempre.
 *
 * O que não pode quebrar:
 *   • "conect" dá 30 — é o link impresso no slide;
 *   • quem NÃO usa o link continua com 15 (decisão comercial de 26/08/2026:
 *     nem embaixador ganha o dobro);
 *   • código desconhecido nunca dá zero, que deixaria a conta sem teste;
 *   • a TELA e a ROTA leem a mesma função. Elas já divergiram uma vez, e o
 *     lojista só descobriu na metade do prazo.
 *
 *   node scripts/teste-trial-do-link.js
 */
const fs = require("fs");
const path = require("path");
const createJiti = require("jiti");

const RAIZ = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, {
  alias: { "@": path.resolve(RAIZ, "src") },
  interopDefault: true,
  esmResolve: true,
});
const T = jiti(path.resolve(RAIZ, "src", "lib", "trial-do-cadastro.ts"));

let ok = 0, falhou = 0;
const exigir = (nome, condicao, detalhe) => {
  if (condicao) { ok++; console.log("  ok     " + nome); }
  else { falhou++; console.log("  FALHOU " + nome + (detalhe ? "\n         " + detalhe : "")); }
};

console.log("\n== O link do slide ==");
exigir('?ref=conect dá 30 dias', T.diasDeTesteDoLink("conect") === 30, String(T.diasDeTesteDoLink("conect")));
exigir("maiúsculas não quebram", T.diasDeTesteDoLink("CONECT") === 30);
exigir("espaço colado não quebra", T.diasDeTesteDoLink("  Conect  ") === 30);
exigir('o apelido "firehubconect" também vale', T.diasDeTesteDoLink("firehubconect") === 30);

console.log("\n== Quem não veio pelo link continua com 15 ==");
exigir("sem ref nenhum", T.diasDeTesteDoLink(null) === 15);
exigir("ref vazio", T.diasDeTesteDoLink("") === 15);
exigir("undefined", T.diasDeTesteDoLink(undefined) === 15);
exigir("código de embaixador qualquer", T.diasDeTesteDoLink("joao123") === 15);
exigir("nunca devolve zero", [null, "", "xpto", "conect"].every((c) => T.diasDeTesteDoLink(c) > 0));

console.log("\n== A tela e a rota leem a MESMA função ==");
const rota = fs.readFileSync(path.join(RAIZ, "src", "app", "api", "register", "route.ts"), "utf8");
const tela = fs.readFileSync(path.join(RAIZ, "src", "app", "cadastro", "page.tsx"), "utf8");
exigir("a rota importa de lib/trial-do-cadastro", /from "@\/lib\/trial-do-cadastro"/.test(rota));
exigir("a tela importa de lib/trial-do-cadastro", /from "@\/lib\/trial-do-cadastro"/.test(tela));
exigir("a rota grava o que a função disser", /const TRIAL_DIAS = diasDeTesteDoLink\(refCode\)/.test(rota));
exigir("não sobrou 15 cravado na rota", !/const TRIAL_DIAS = 15/.test(rota));
exigir("não sobrou 15 cravado na tela", !/const trialDays = 15/.test(tela));
exigir("a tela lê o ?ref= da URL", /diasDeTesteDoLink\(p\.get\("ref"\)/.test(tela));

console.log("\n== O que a conta recebe ==");
const diasAte = (d) => Math.round((d.getTime() - Date.now()) / 86400000);
for (const [code, esperado] of [["conect", 30], [null, 15]]) {
  const fim = new Date();
  fim.setDate(fim.getDate() + T.diasDeTesteDoLink(code));
  exigir(`ref=${code || "(nenhum)"} → trialEndsAt em ${esperado} dias`, diasAte(fim) === esperado, String(diasAte(fim)));
}

console.log(`\n${ok} ok, ${falhou} falharam\n`);
process.exit(falhou ? 1 : 0);
