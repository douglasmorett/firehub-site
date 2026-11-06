/**
 * Prova de lib/reacao-e-status.ts: coraçãozinho num status não vira conversa.
 *
 *   node scripts/teste-reacao-e-status.mjs
 */
import { readFileSync } from "fs";
import ts from "typescript";

const js = ts.transpileModule(readFileSync("src/lib/reacao-e-status.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { ehSoReacao, respondeAStatus, soEmoji } = await import("data:text/javascript," + encodeURIComponent(js));

let falhas = 0;
const conferir = (nome, ok) => {
  console.log(`  ${ok ? "ok   " : "FALHA"} ${nome}`);
  if (!ok) falhas++;
};

const doStatus = (texto) => ({
  extendedTextMessage: { text: texto, contextInfo: { remoteJid: "status@broadcast", stanzaId: "ABC", participant: "5521999999999@s.whatsapp.net" } },
});
const citandoConversa = (texto) => ({
  extendedTextMessage: { text: texto, contextInfo: { remoteJid: "5521988887777@s.whatsapp.net", stanzaId: "XYZ" } },
});

console.log("\n1) Status da loja");
conferir("❤️ num status: silêncio", ehSoReacao(doStatus("❤️"), "❤️"));
conferir("😍😍 num status: silêncio", ehSoReacao(doStatus("😍😍"), "😍😍"));
conferir("👏🏻! num status: silêncio", ehSoReacao(doStatus("👏🏻!"), "👏🏻!"));
conferir("'quanto tá esse?' num status: vai para o robô", !ehSoReacao(doStatus("quanto tá esse?"), "quanto tá esse?"));
conferir("e é marcado como resposta a status", respondeAStatus(doStatus("quanto tá esse?")));
conferir("foto respondendo status também é resposta a status", respondeAStatus({ imageMessage: { caption: "", contextInfo: { remoteJid: "status@broadcast" } } }));

console.log("\n2) Reação");
conferir("reactionMessage: silêncio", ehSoReacao({ reactionMessage: { text: "❤️", key: {} } }, ""));

console.log("\n3) Conversa normal continua indo ao robô");
conferir("👍 na conversa (pode ser 'sim'): vai", !ehSoReacao({ conversation: "👍" }, "👍"));
conferir("❤️ citando mensagem da conversa: vai", !ehSoReacao(citandoConversa("❤️"), "❤️"));
conferir("texto comum não é status", !respondeAStatus({ conversation: "oi" }));
conferir("conteúdo vazio", !respondeAStatus(null) && !ehSoReacao(null, "oi"));

console.log("\n4) soEmoji");
conferir("emoji", soEmoji("🥰"));
conferir("número não é emoji", !soEmoji("2"));
conferir("letra com acento não é emoji", !soEmoji("é"));

console.log(falhas === 0 ? "\nTUDO CERTO\n" : `\n${falhas} FALHA(S)\n`);
process.exit(falhas === 0 ? 0 : 1);
