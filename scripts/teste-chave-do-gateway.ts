/**
 * A chave que o gateway manda no webhook do WhatsApp (lib/chave-do-gateway.ts).
 *
 *   npx tsx scripts/teste-chave-do-gateway.ts
 */
import { readFileSync } from "node:fs";
import { chaveDoGateway } from "../src/lib/chave-do-gateway";

let falhas = 0;
function confere(nome: string, ok: boolean, obtido?: unknown) {
  if (ok) console.log(`✅ ${nome}`);
  else { falhas++; console.log(`❌ ${nome} — obtido ${JSON.stringify(obtido)}`); }
}

const atual = "chave-atual-49-caracteres-xxxxxxxxxxxxxxxxxxxxxxx";
const anterior = "chave-anterior";
confere("chave atual: ok", chaveDoGateway(atual, [atual, anterior]) === "ok");
confere("chave anterior (troca em andamento): ok", chaveDoGateway(anterior, [atual, anterior]) === "ok");
confere("sem cabeçalho: ausente", chaveDoGateway(null, [atual]) === "ausente");
confere("cabeçalho vazio: ausente", chaveDoGateway("", [atual]) === "ausente");
confere("outra chave: errada", chaveDoGateway("chave-de-outro", [atual]) === "errada");
confere("prefixo da chave: errada", chaveDoGateway(atual.slice(0, 10), [atual]) === "errada");
confere("sem chave configurada no FireHub: nada passa", chaveDoGateway(atual, [undefined, undefined]) === "errada");

// O gateway manda a chave nas QUATRO chamadas ao webhook.
const gw = readFileSync("whatsapp-gateway/server.js", "utf8");
const chamadas = gw.match(/fetch\((urlDoWebhook\(\)|webhookUrl),\s*\{[\s\S]{0,80}?headers:\s*([^\n]+)/g) || [];
confere("as 4 chamadas ao webhook levam cabecalhosDoWebhook()", chamadas.length === 4 && chamadas.every((c) => c.includes("cabecalhosDoWebhook()")), chamadas);
confere("cabecalhosDoWebhook manda a apikey", /apikey:\s*process\.env\.API_KEY/.test(gw));

console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
