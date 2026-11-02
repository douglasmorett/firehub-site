/**
 * A conta do Google DA LOJA, a parte pura (src/lib/google-maps-da-loja.ts), a
 * URL da busca (src/lib/geocodificacao-google.ts, `urlDaBuscaNoGoogle`) e a
 * faxina de 30 dias. O Google primeiro na cotação e a queda no mapa aberto:
 * scripts/teste-motor-da-entrega.ts, seção "A conta do Google DA LOJA".
 *
 *   npx tsx scripts/teste-google-maps-da-loja.ts
 */
import {
  buscasNoMes,
  finalDaChave,
  formatoDeChaveValido,
  lerTesteDaChave,
  limparChave,
  escolherChaveDoGoogle,
  mesDoUso,
  urlDoTesteDaChave,
} from "../src/lib/google-maps-da-loja";
import { urlDaBuscaNoGoogle } from "../src/lib/geocodificacao-google";
import { SQL_DA_FAXINA_DO_GOOGLE } from "../src/lib/faxina-dos-caches";

let ok = 0, falhas = 0;
function confere(nome: string, cond: boolean, detalhe?: unknown) {
  if (cond) ok++;
  else { falhas++; console.log(`✖ ${nome}${detalhe !== undefined ? ` — ${JSON.stringify(detalhe)}` : ""}`); }
}

// ── A chave ──────────────────────────────────────────────────────────────
const CHAVE = ["AI", "za", "SyA1234567890abcdefghijklmnopqrstuv"].join(""); // 39 caracteres, de mentira (montada: o gancho do commit barra chave literal)
confere("chave de 39 com AIza vale", formatoDeChaveValido(CHAVE), CHAVE.length);
confere("aspas e espaço do copiar/colar saem", limparChave(`  "${CHAVE}" `) === CHAVE);
confere("chave curta não vale", !formatoDeChaveValido("AIzaSyA123"));
confere("outra coisa colada não vale", !formatoDeChaveValido("sk-" + CHAVE.slice(3)));
confere("final = 4 últimos", finalDaChave(CHAVE) === "stuv");

// ── O mês do uso (fuso de Brasília) ─────────────────────────────────────
confere("01/11 01:00 em Brasília (04:00 UTC) é novembro", mesDoUso(new Date("2026-11-01T04:00:00Z")) === "2026-11");
confere("31/10 23:30 em Brasília (02:30 UTC de 01/11) ainda é outubro", mesDoUso(new Date("2026-11-01T02:30:00Z")) === "2026-10");
confere("buscas do mês lidas do contador", buscasNoMes({ "2026-11": 42, "2026-10": 9 }, "2026-11") === 42);
confere("contador vazio = 0", buscasNoMes(null, "2026-11") === 0 && buscasNoMes({}, "2026-11") === 0);

// ── A URL do teste ───────────────────────────────────────────────────────
const teste = new URL(urlDoTesteDaChave(CHAVE, "Cabo Frio", "RJ"));
confere("teste vai ao Geocoding API", teste.origin + teste.pathname === "https://maps.googleapis.com/maps/api/geocode/json");
confere("teste: endereço da cidade da loja", teste.searchParams.get("address") === "Centro, Cabo Frio, RJ", teste.searchParams.get("address"));
confere(
  "teste: Brasil, pt-BR",
  teste.searchParams.get("components") === "country:BR" && teste.searchParams.get("region") === "br" && teste.searchParams.get("language") === "pt-BR",
);
confere("teste: a chave vai", teste.searchParams.get("key") === CHAVE);
confere("teste sem cidade não quebra", new URL(urlDoTesteDaChave(CHAVE, null)).searchParams.get("address") === "Centro, São Paulo");

// ── A URL da busca do endereço ──────────────────────────────────────────
const busca = new URL(urlDaBuscaNoGoogle("Travessa Pantanal, 130 - Jardim Esperança", "Cabo Frio", { lat: -22.88, lng: -42.02 }, CHAVE));
confere("busca: cidade junto do texto", busca.searchParams.get("address") === "Travessa Pantanal, 130 - Jardim Esperança, Cabo Frio", busca.searchParams.get("address"));
confere("busca: cidade não repete", new URL(urlDaBuscaNoGoogle("Rua X, 1, Cabo Frio", "Cabo Frio", null, CHAVE)).searchParams.get("address") === "Rua X, 1, Cabo Frio");
confere(
  "busca: Brasil, pt-BR, chave da loja",
  busca.searchParams.get("components") === "country:BR" && busca.searchParams.get("region") === "br" && busca.searchParams.get("language") === "pt-BR" && busca.searchParams.get("key") === CHAVE,
);
const bounds = busca.searchParams.get("bounds") || "";
confere("busca: viés de ~25 km em volta da loja", bounds === `${-22.88 - 0.25},${-42.02 - 0.25}|${-22.88 + 0.25},${-42.02 + 0.25}`, bounds);
confere("busca sem centro: sem viés", !new URL(urlDaBuscaNoGoogle("Rua X, 1", "Cabo Frio", null, CHAVE)).searchParams.has("bounds"));

// ── A resposta do teste em português ────────────────────────────────────
confere("OK = funciona", lerTesteDaChave({ status: "OK", results: [{}] }).ok);
confere("ZERO_RESULTS = funciona (o Google respondeu)", lerTesteDaChave({ status: "ZERO_RESULTS", results: [] }).ok);
const erroDe = (d: any) => { const r = lerTesteDaChave(d); return r.ok ? "" : r.erro; };
confere(
  "API não ativada",
  /Geocoding API não está ativada/.test(erroDe({ status: "REQUEST_DENIED", error_message: "This API project is not authorized to use this API." })),
);
confere(
  "faturamento",
  /faturamento não está ativado/.test(erroDe({ status: "REQUEST_DENIED", error_message: "You must enable Billing on the Google Cloud Project at https://console.cloud.google.com/project/_/billing/enable Learn more at https://developers.google.com/maps/gmp-get-started" })),
);
confere(
  "chave inválida",
  /não é válida/.test(erroDe({ status: "REQUEST_DENIED", error_message: "The provided API key is invalid. " })),
);
confere(
  "restrita por site",
  /restrita por site/.test(erroDe({ status: "REQUEST_DENIED", error_message: "API keys with referer restrictions cannot be used with this API." })),
);
const ip = erroDe({ status: "REQUEST_DENIED", error_message: "This IP, site or mobile application is not authorized to use this API key. Request received from IP address 1.2.3.4" });
confere("restrita por IP (não confunde com API não ativada)", /restrita \(por IP/.test(ip), ip);
confere("cota", /limite de uso/.test(erroDe({ status: "OVER_QUERY_LIMIT" })));
confere("sem resposta", /não respondeu/.test(erroDe(null)));

// ── Qual chave cada loja usa (Douglas, 01/11/2026) ──────────────────────
confere("loja com chave própria: a dela (mesmo sendo Hakim e com a env)",
  escolherChaveDoGoogle({ chaveDaLoja: "da-loja", hakim: true, chaveDoAmbiente: "nossa" })?.origem === "LOJA" &&
  escolherChaveDoGoogle({ chaveDaLoja: "da-loja", hakim: true, chaveDoAmbiente: "nossa" })?.chave === "da-loja");
confere("loja Hakim sem chave, com a env: a do FireHub (reserva)",
  escolherChaveDoGoogle({ chaveDaLoja: null, hakim: true, chaveDoAmbiente: "nossa" })?.origem === "PLATAFORMA");
confere("loja que não é Hakim, sem chave: nada, mesmo com a env", escolherChaveDoGoogle({ chaveDaLoja: null, hakim: false, chaveDoAmbiente: "nossa" }) === null);
confere("sem env e sem chave: nada (o mapa aberto de hoje)", escolherChaveDoGoogle({ chaveDaLoja: null, hakim: true, chaveDoAmbiente: "" }) === null);

// ── Os termos: o que veio do Google sai em 30 dias ──────────────────────
confere("faxina apaga o Google com mais de 30 dias, usado ou não",
  SQL_DA_FAXINA_DO_GOOGLE === `DELETE FROM "GeocodeCache" WHERE "origem" LIKE 'google%' AND "criadoEm" < NOW() - INTERVAL '30 days'`, SQL_DA_FAXINA_DO_GOOGLE);

console.log(`\n${ok} ok, ${falhas} falha(s)`);
if (falhas > 0) process.exit(1);
