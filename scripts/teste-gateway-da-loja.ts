/**
 * Para qual gateway vai cada loja (src/lib/gateway-da-loja.ts).
 *
 *   npx tsx scripts/teste-gateway-da-loja.ts
 */
import { gatewayDaLoja } from "../src/lib/gateway-da-loja";

let ok = 0, falhas = 0;
function confere(nome: string, cond: boolean) {
  if (cond) ok++;
  else { falhas++; console.log(`✖ ${nome}`); }
}

process.env.EVOLUTION_API_URL = "https://gateway-principal.exemplo/";
process.env.EVOLUTION_API_KEY = "chave-principal";

const padrao = gatewayDaLoja(null);
confere("sem config: gateway principal, sem barra no fim", padrao.baseUrl === "https://gateway-principal.exemplo");
confere("sem config: chave do ambiente", padrao.apiKey === "chave-principal");

const teste = gatewayDaLoja({ evolutionUrl: " https://gateway-teste.exemplo// " });
confere("loja com gateway próprio vai para ele", teste.baseUrl === "https://gateway-teste.exemplo");
confere("sem chave própria usa a do ambiente", teste.apiKey === "chave-principal");

confere("chave própria vale", gatewayDaLoja({ evolutionUrl: "https://x.exemplo", evolutionApiKey: "k2" }).apiKey === "k2");
confere("url vazia não vale", gatewayDaLoja({ evolutionUrl: "   " }).baseUrl === "https://gateway-principal.exemplo");
confere("url que não é texto não vale", gatewayDaLoja({ evolutionUrl: 42 }).baseUrl === "https://gateway-principal.exemplo");
confere("config que não é objeto", gatewayDaLoja("lixo").baseUrl === "https://gateway-principal.exemplo");

delete process.env.EVOLUTION_API_URL;
confere("sem EVOLUTION_API_URL: o padrão de produção", gatewayDaLoja({}).baseUrl === "https://firehub-whatsapp-gateway-production.up.railway.app");

delete process.env.EVOLUTION_API_KEY;
let lancou = false;
try { gatewayDaLoja({}); } catch { lancou = true; }
confere("sem chave nenhuma: erro, como antes", lancou);
confere("sem chave no ambiente mas com chave da loja: funciona", gatewayDaLoja({ evolutionApiKey: "k3" }).apiKey === "k3");

console.log(`${ok} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
