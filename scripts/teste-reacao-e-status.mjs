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
const { ehSoReacao, respondeAStatus, soEmoji, respostaAStatusSemPergunta, emojiSemPerguntaDoRobo, pareceMensagemAutomaticaDoBusiness } = await import("data:text/javascript," + encodeURIComponent(js));

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

console.log("\n5) Comentário num status, sem pergunta: silêncio (Douglas, 06/11)");
conferir("'Que delícia 😍' num status: silêncio", respostaAStatusSemPergunta(doStatus("Que delícia 😍"), "Que delícia 😍"));
conferir("'Top demais' num status: silêncio", respostaAStatusSemPergunta(doStatus("Top demais"), "Top demais"));
conferir("'É nós primo.🩷' num status: silêncio", respostaAStatusSemPergunta(doStatus("É nós primo.🩷"), "É nós primo.🩷"));
conferir("'quanto tá esse?' num status: vai", !respostaAStatusSemPergunta(doStatus("quanto tá esse?"), "quanto tá esse?"));
conferir("'quero uma dessa' num status: vai", !respostaAStatusSemPergunta(doStatus("quero uma dessa"), "quero uma dessa"));
conferir("'Tem hoje' num status: vai", !respostaAStatusSemPergunta(doStatus("Tem hoje"), "Tem hoje"));
conferir("'vocês estão abertos' num status: vai", !respostaAStatusSemPergunta(doStatus("vocês estão abertos"), "vocês estão abertos"));
conferir("'que delícia' sem status (conversa normal): vai", !respostaAStatusSemPergunta({ conversation: "que delícia" }, "que delícia"));
conferir("'temperada' não conta como 'tem'", respostaAStatusSemPergunta(doStatus("temperada 😋"), "temperada 😋"));

console.log("\n6) Emoji solto na conversa");
conferir("'😮' sem pergunta do robô: silêncio (Pizzaria 17)", emojiSemPerguntaDoRobo("😮", "Seu pedido saiu para entrega 🛵"));
conferir("'😍' na primeira mensagem: silêncio", emojiSemPerguntaDoRobo("😍", undefined));
conferir("'👍' depois de 'Confirma?': vai (é o sim)", !emojiSemPerguntaDoRobo("👍", "Total 56 reais, no Pix. Confirma?"));
conferir("'👍' depois de 'Confirma? 😊': vai", !emojiSemPerguntaDoRobo("👍", "Confirma pra mim? 😊"));
conferir("'ok 👍' tem letra: vai", !emojiSemPerguntaDoRobo("ok 👍", "Pedido anotado."));
conferir("texto vazio não é emoji solto", !emojiSemPerguntaDoRobo("", "x"));

console.log("\n7) Saudação automática do WhatsApp Business não é o lojista");
const t0 = 1_000_000_000_000;
conferir("2 s depois do primeiro 'oi': automática", pareceMensagemAutomaticaDoBusiness(t0 + 2000, t0, null));
conferir("2 s depois de 'oi' após 2 h parada: automática", pareceMensagemAutomaticaDoBusiness(t0 + 2000, t0, 2 * 3600e3));
conferir("2 s depois, no meio da conversa (40 s antes): é o lojista", !pareceMensagemAutomaticaDoBusiness(t0 + 2000, t0, 40_000));
conferir("40 s depois do primeiro 'oi': é o lojista", !pareceMensagemAutomaticaDoBusiness(t0 + 40_000, t0, null));
conferir("sem mensagem do cliente: é o lojista", !pareceMensagemAutomaticaDoBusiness(t0, null, null));

console.log(falhas === 0 ? "\nTUDO CERTO\n" : `\n${falhas} FALHA(S)\n`);
process.exit(falhas === 0 ? 0 : 1);
