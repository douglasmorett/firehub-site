/**
 * Prova do filtro de conversa de cliente (lib/jid-de-cliente.ts).
 *
 *   node scripts/teste-jid-de-cliente.mjs
 *
 * Os endereços são os que existem de verdade no banco de produção, conferidos
 * em 19/09/2026: 915 conversas em `@s.whatsapp.net`, 151 em `@lid` e 8 em
 * `@newsletter`. Os canais são os 6 que a Brazza Burguer segue, que em
 * 01–14/09/2026 viraram 1.072 chamadas de IA e R$ 41,57 de Gemini sem nenhum
 * cliente do outro lado.
 */
import { readFileSync } from "fs";
import ts from "typescript";

const js = ts.transpileModule(readFileSync("src/lib/jid-de-cliente.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const m = await import("data:text/javascript," + encodeURIComponent(js));
const { ehConversaDeCliente, tipoDoJid } = m;

let falhas = 0;
const conferir = (nome, ok, detalhe) => {
  if (ok) { console.log("  ok    " + nome); return; }
  falhas++;
  console.log("  FALHA " + nome + (detalhe ? " — " + detalhe : ""));
};
const atende = (nome, jid) => conferir(nome, ehConversaDeCliente(jid) === true, `${jid} devia passar e foi recusado`);
const recusa = (nome, jid) => conferir(nome, ehConversaDeCliente(jid) === false, `${jid} devia ser recusado e passou`);
const ehTipo = (jid, esperado) => conferir(`tipo de ${jid} é ${esperado}`, tipoDoJid(jid) === esperado, `obtido ${tipoDoJid(jid)}`);

console.log("\n1) Cliente de verdade passa");
atende("conversa 1-a-1 clássica", "5522999622213@s.whatsapp.net");
atende("conversa 1-a-1 no formato novo (@lid)", "52935992025141@lid");
atende("número cru, sem sufixo (o webhook às vezes cai no data.from)", "5522999622213");
conferir("@lid NÃO pode ser barrado: são 151 conversas vivas em produção", ehConversaDeCliente("62638272815331@lid"));

console.log("\n2) O que gerou a conta de setembro");
recusa("canal do WhatsApp (o vazamento de R$ 41,57)", "120363172867223601@newsletter");
recusa("outro canal da Brazza", "120363155488152222@newsletter");
recusa("canal do R&D Pizzaria", "120363285487169143@newsletter");

console.log("\n3) O que a lista de bloqueio antiga já barrava (não pode regredir)");
recusa("grupo", "120363043211234567@g.us");
recusa("lista de transmissão", "status@broadcast");
recusa("broadcast", "5522999622213@broadcast");

console.log("\n4) O formato que o WhatsApp ainda não inventou");
recusa("sufixo desconhecido é recusado por padrão — esta é a regra toda", "123456@qualquercoisanova");
recusa("outro inventado", "abc@bot");
conferir(
  "o padrão é RECUSAR: nenhum sufixo novo passa sem alguém escrever que é cliente",
  ["@canal", "@community", "@status", "@ai", "@meta"].every((s) => ehConversaDeCliente("123" + s) === false)
);

console.log("\n5) Entrada quebrada não derruba e não passa");
recusa("vazio", "");
recusa("nulo", null);
recusa("indefinido", undefined);
recusa("terminou em @", "5522999622213@");
conferir("número não explode", ehConversaDeCliente(5522999622213) === true);
conferir("objeto não explode", ehConversaDeCliente({}) === false);

console.log("\n6) Maiúscula e espaço não furam o filtro");
recusa("canal em maiúscula", "120363172867223601@NEWSLETTER");
recusa("canal com espaço em volta", "  120363172867223601@newsletter  ");
atende("cliente em maiúscula", "5522999622213@S.WhatsApp.Net");
recusa("dois @ — vale o último sufixo", "5522999622213@s.whatsapp.net@newsletter");

console.log("\n7) O rótulo para o log");
ehTipo("5522999622213@s.whatsapp.net", "cliente");
ehTipo("52935992025141@lid", "cliente_lid");
ehTipo("120363172867223601@newsletter", "canal");
ehTipo("120363043211234567@g.us", "grupo");
ehTipo("status@broadcast", "transmissao");
ehTipo("123456@qualquercoisanova", "desconhecido");
ehTipo("5522999622213", "numero_cru");
ehTipo("", "vazio");

console.log(falhas === 0 ? "\n✅ tudo certo\n" : `\n❌ ${falhas} falha(s)\n`);
process.exit(falhas === 0 ? 0 : 1);
