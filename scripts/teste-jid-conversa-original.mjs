/**
 * Prova do filtro pela CONVERSA ORIGINAL (lib/jid-de-cliente.ts,
 * `conversaOriginalEhDeCliente`) somado ao filtro de contas oficiais, na ordem
 * em que o webhook do WhatsApp os aplica.
 *
 *   node scripts/teste-jid-conversa-original.mjs
 *
 * O defeito (auditoria de 25/09/2026): num status, `key.remoteJid` é
 * `status@broadcast` e `key.participant` é o telefone de quem postou. O webhook
 * escolhia o telefone ("o de verdade") e só depois perguntava se era conversa
 * de cliente — aprovava, e o robô respondia por mensagem direta a um status.
 */
import { readFileSync } from "fs";
import ts from "typescript";

const carregar = async (arquivo) => {
  const js = ts.transpileModule(readFileSync(arquivo, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import("data:text/javascript," + encodeURIComponent(js));
};
const { conversaOriginalEhDeCliente, ehConversaDeCliente } = await carregar("src/lib/jid-de-cliente.ts");
const { contaOficialDoWhatsApp } = await carregar("src/lib/contas-oficiais-whatsapp.ts");

let falhas = 0;
const conferir = (nome, ok, detalhe) => {
  if (ok) { console.log("  ok    " + nome); return; }
  falhas++;
  console.log("  FALHA " + nome + (detalhe !== undefined ? " — " + JSON.stringify(detalhe) : ""));
};

console.log("\n1) A conversa original decide");
conferir("status com participant em formato de telefone é RECUSADO", conversaOriginalEhDeCliente("status@broadcast") === false);
conferir("…mesmo que o telefone escolhido passe no filtro antigo", ehConversaDeCliente("5522999622213@s.whatsapp.net") === true);
conferir("grupo com participant é recusado", conversaOriginalEhDeCliente("120363043211234567@g.us") === false);
conferir("canal é recusado", conversaOriginalEhDeCliente("120363172867223601@newsletter") === false);
conferir("conversa 1:1 passa", conversaOriginalEhDeCliente("5522999622213@s.whatsapp.net") === true);
conferir("conversa por LID passa (1/6 da base)", conversaOriginalEhDeCliente("220104809820350@lid") === true);
conferir("sem remoteJid (payload antigo só com data.from) não recusa", conversaOriginalEhDeCliente(undefined) === true && conversaOriginalEhDeCliente(null) === true && conversaOriginalEhDeCliente("  ") === true);
conferir("remoteJid que não é texto é recusado", conversaOriginalEhDeCliente({}) === false);

console.log("\n2) A ordem do webhook, com payloads como os do gateway");
// Simula as três porteiras em sequência: conversa original → endereço
// resolvido → conta oficial. `true` = o robô atende.
const roboAtende = (data) => {
  const key = data.key || {};
  if (!conversaOriginalEhDeCliente(key.remoteJid)) return false;
  const resolvido = data.senderAlt || key.remoteJid || data.from || "";
  if (!ehConversaDeCliente(resolvido)) return false;
  return contaOficialDoWhatsApp({
    jids: [resolvido, key.remoteJid, key.remoteJidAlt, key.senderPn, key.participant, data.senderAlt, data.sender, data.from],
    verifiedBizName: data.verifiedBizName,
  }) === null;
};
conferir("cliente comum", roboAtende({ key: { remoteJid: "5522999622213@s.whatsapp.net" } }));
conferir("cliente por LID com telefone junto", roboAtende({ key: { remoteJid: "36704874438867@lid" }, senderAlt: "5522992090207@s.whatsapp.net" }));
conferir("status de contato NÃO", !roboAtende({ key: { remoteJid: "status@broadcast", participant: "5522999622213@s.whatsapp.net" }, senderAlt: "5522999622213@s.whatsapp.net" }));
conferir("Suporte do WhatsApp por LID NÃO (Divinos, 25/09)", !roboAtende({ key: { remoteJid: "198964645236955@lid" } }));
conferir("Suporte do WhatsApp com o telefone junto NÃO", !roboAtende({ key: { remoteJid: "198964645236955@lid", senderPn: "15517868423@s.whatsapp.net" }, senderAlt: "15517868423@s.whatsapp.net" }));
conferir("Suporte só pelo telefone NÃO", !roboAtende({ key: { remoteJid: "15517868423@s.whatsapp.net" } }));
conferir("aviso do sistema (0@s.whatsapp.net) NÃO", !roboAtende({ key: { remoteJid: "0@s.whatsapp.net" } }));
conferir("Meta AI NÃO", !roboAtende({ key: { remoteJid: "13135550002@s.whatsapp.net" } }));
conferir("cliente com empresa verificada comum SIM", roboAtende({ key: { remoteJid: "5522999622213@s.whatsapp.net" }, verifiedBizName: "Açaí do Zé" }));

console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
