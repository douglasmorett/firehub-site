/**
 * Prova do filtro de contas oficiais do WhatsApp/Meta (lib/contas-oficiais-whatsapp.ts).
 *
 *   node scripts/teste-contas-oficiais-whatsapp.mjs
 *
 * O caso real: em 24–25/09/2026 o robô da Divinos Burger respondeu ~40 vezes ao
 * robô do Suporte do WhatsApp (+1 551-786-8423, LID 198964645236955), e o botão
 * "Encerrar atendimento" mandava "Atendimento humano finalizado" para ele.
 */
import { readFileSync } from "fs";
import ts from "typescript";

const js = ts.transpileModule(readFileSync("src/lib/contas-oficiais-whatsapp.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { contaOficialDoWhatsApp, ehContaOficialDoWhatsApp } = await import("data:text/javascript," + encodeURIComponent(js));

let falhas = 0;
const conferir = (nome, ok, detalhe) => {
  if (ok) { console.log("  ok    " + nome); return; }
  falhas++;
  console.log("  FALHA " + nome + (detalhe !== undefined ? " — " + JSON.stringify(detalhe) : ""));
};
const oficial = (nome, entrada, quem) => {
  const r = contaOficialDoWhatsApp(entrada);
  conferir(nome, r !== null && (!quem || r.quem === quem), r);
};
const cliente = (nome, entrada) => {
  const r = contaOficialDoWhatsApp(entrada);
  conferir(nome, r === null, r);
};

console.log("\n1) O Suporte do WhatsApp, nas duas formas em que chegou à Divinos");
oficial("telefone com sufixo", { jids: ["15517868423@s.whatsapp.net"] }, "Suporte do WhatsApp");
oficial("LID do Suporte", { jids: ["198964645236955@lid"] }, "Suporte do WhatsApp");
oficial("com id de aparelho", { jids: ["15517868423:3@s.whatsapp.net"] }, "Suporte do WhatsApp");
oficial("número cru (data.from)", { jids: ["15517868423"] }, "Suporte do WhatsApp");
oficial("número digitado com +, traço e espaço", { jids: ["+1 551-786-8423"] }, "Suporte do WhatsApp");
oficial("basta UM dos endereços do payload casar", {
  jids: ["198964645236955@lid", undefined, null, "", "15517868423@s.whatsapp.net"],
}, "Suporte do WhatsApp");
oficial("LID sem telefone junto, entre outros candidatos", { jids: [undefined, "198964645236955@lid", {}] }, "Suporte do WhatsApp");

console.log("\n2) As contas de sistema e da Meta que o Baileys conhece");
oficial("avisos do sistema (0@c.us)", { jids: ["0@c.us"] });
oficial("avisos do sistema (0@s.whatsapp.net)", { jids: ["0@s.whatsapp.net"] });
oficial("servidor (server@c.us)", { jids: ["server@c.us"] });
oficial("conta oficial WhatsApp (OFFICIAL_BIZ_JID)", { jids: ["16505361212@c.us"] }, "Conta oficial do WhatsApp");
oficial("Meta AI (META_AI_JID)", { jids: ["13135550002@c.us"] }, "Meta AI");
oficial("Meta AI pela faixa isJidBot (1313555xxxx)", { jids: ["13135551234@s.whatsapp.net"] }, "Meta AI");
oficial("Meta AI pela faixa isJidBot (131655500xx)", { jids: ["13165550042@c.us"] }, "Meta AI");
oficial("robô @bot", { jids: ["867051314767696@bot"] }, "Meta AI");
oficial("chamada @call", { jids: ["abc123@call"] });

console.log("\n3) Nome VERIFICADO da Meta (e só dela)");
oficial("verificado 'WhatsApp'", { jids: ["5522999999999@s.whatsapp.net"], verifiedBizName: "WhatsApp" });
oficial("verificado 'WhatsApp Support'", { verifiedBizName: "WhatsApp Support" });
oficial("verificado 'Suporte do WhatsApp'", { verifiedBizName: "Suporte do WhatsApp" });
oficial("verificado 'Meta AI'", { verifiedBizName: "Meta AI" });
oficial("caixa e espaço não furam", { verifiedBizName: "  WHATSAPP   business " });
cliente("'Meta Burger' é loja, não a Meta", { jids: ["5522999999999@s.whatsapp.net"], verifiedBizName: "Meta Burger" });
cliente("'Pizzaria Meta' é loja", { verifiedBizName: "Pizzaria Meta" });
cliente("'WhatsApp da Tia Lu' é loja", { verifiedBizName: "WhatsApp da Tia Lu" });
cliente("InfinityPay verificada NÃO é conta oficial (o anti-loop cuida)", { verifiedBizName: "InfinitePay" });

console.log("\n4) Cliente de verdade passa");
cliente("cliente brasileiro", { jids: ["5522997905262@s.whatsapp.net"] });
cliente("cliente por LID", { jids: ["36704874438867@lid", "5522992090207@s.whatsapp.net"] });
cliente("o LID do Douglas (220104809820350) é cliente", { jids: ["220104809820350@lid"] });
cliente("cliente dos EUA com número comum", { jids: ["15551234567@s.whatsapp.net"] });
cliente("número que CONTÉM o do Suporte não casa (comparação exata)", { jids: ["5515517868423@s.whatsapp.net"] });
cliente("LID com os dígitos do telefone do Suporte não casa (LID não é telefone)", { jids: ["15517868423@lid"] });
cliente("nome de perfil 'WhatsApp' sem verificação não conta", { jids: ["5522999999999@s.whatsapp.net"], verifiedBizName: "" });

console.log("\n5) Entrada quebrada não derruba");
cliente("vazio", {});
cliente("nulo", null);
cliente("jids nulo", { jids: null });
cliente("objetos e números soltos", { jids: [{}, [], 42, true] });
cliente("herança de objeto não vira conta oficial", { jids: ["constructor@c.us", "toString@s.whatsapp.net", "x@constructor", "__proto__@lid"] });
conferir("atalho booleano", ehContaOficialDoWhatsApp({ jids: ["15517868423@s.whatsapp.net"] }) === true && ehContaOficialDoWhatsApp({ jids: ["5522997905262@s.whatsapp.net"] }) === false);

console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
