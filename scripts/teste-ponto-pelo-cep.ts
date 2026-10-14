/**
 * O ponto do pedido SEM coordenada sai do CEP antes do texto
 * (lib/geocodificacao-servidor.ts: cepDoEndereco, chaveDaBusca, prepararBusca).
 *
 * Caso real: NIK Esfihas (Brasília, 14/10/2026), pedido #15 da Wabiz sem ponto.
 * O texto virava bairro "Brasília/DF" e o pino caía na Asa Sul; o CEP 73015-217
 * é de Sobradinho. Sem rede: o ViaCEP é simulado com a resposta real dele.
 *
 *   JITI_ALIAS='{"@":"<worktree>/src"}' node node_modules/jiti/lib/jiti-cli.mjs scripts/teste-ponto-pelo-cep.ts
 */
import { cepDoEndereco, chaveDaBusca, chaveDeCache, prepararBusca } from "@/lib/geocodificacao-servidor";
import { buscarCep, type ConsultaDoCep } from "@/lib/cep";
import { criarGeocodificador } from "@/lib/geocodificacao";

let ok = 0, falhas = 0;
function confere(nome: string, cond: boolean, detalhe?: unknown) {
  if (cond) ok++;
  else { falhas++; console.log(`✖ ${nome}`, detalhe === undefined ? "" : JSON.stringify(detalhe)); }
}

const NIK = "Quadra 2 conjunto B2 bloco B, 601 - Edifício Kona ap 601 - QUADRA 2 - Brasília/DF - CEP 73015217";
const lojaNik = { cidade: "BRASILIA DF", estado: null, centro: { lat: -15.6467899133085, lng: -47.80763973611775 } };

// A resposta real do ViaCEP para 73015-217 (consultada em 14/10/2026), servida por um fetch falso.
const VIACEP: Record<string, unknown> = {
  "73015217": { cep: "73015-217", logradouro: "Quadra 2 Conjunto B-2 Bloco B", bairro: "Sobradinho", localidade: "Brasília", uf: "DF" },
  "28905080": { cep: "28905-080", logradouro: "Rua do Forno", bairro: "Jardim Esperança", localidade: "Cabo Frio", uf: "RJ" },
  "28900000": { cep: "28900-000", logradouro: "", bairro: "", localidade: "Cabo Frio", uf: "RJ" },
  "99999999": { erro: true },
};
const pedidas: string[] = [];
const fetchFalso = (async (url: string) => {
  const d = String(url).match(/ws\/(\d{8})\//)?.[1] || "";
  pedidas.push(d);
  return { ok: true, status: 200, json: async () => VIACEP[d] ?? { erro: true } } as any;
}) as unknown as typeof fetch;
const viaCepFalso = (cep: string) => buscarCep(cep, { fetch: fetchFalso });
const viaCepFora = async (): Promise<ConsultaDoCep> => ({ ok: false, motivo: "falhou" });

async function main() {
  // ── Achar o CEP no texto ───────────────────────────────────────────────
  confere("Wabiz: 'CEP 73015217' no fim", cepDoEndereco(NIK) === "73015217", cepDoEndereco(NIK));
  confere("'CEP: 73.015-217'", cepDoEndereco("Rua X, 10 - CEP: 73.015-217") === "73015217");
  confere("'73015-217' sem a palavra CEP", cepDoEndereco("Rua X, 10 - Sobradinho, 73015-217") === "73015217");
  confere("CEP sozinho", cepDoEndereco(" 86078260 ") === "86078260");
  confere("sem CEP", cepDoEndereco("Rua das Flores, 120 - Centro") === null);
  confere("telefone não é CEP", cepDoEndereco("Rua A, 5 - ref. ligar 22999887766") === null);
  confere("número de 8 dígitos no meio do texto não é CEP", cepDoEndereco("Lote 12345678 - Centro") === null);
  confere("CEP incompleto não vale", cepDoEndereco("Rua X - CEP 7301521") === null);

  // ── A chave do cache ───────────────────────────────────────────────────
  confere("endereço com CEP ganha chave própria (o ponto antigo do texto não volta)",
    chaveDaBusca(NIK, "BRASILIA DF") === `cep|${chaveDeCache(NIK, "BRASILIA DF")}`);
  confere("sem CEP a chave é a de sempre",
    chaveDaBusca("Rua das Flores, 120 - Centro", "Cabo Frio") === chaveDeCache("Rua das Flores, 120 - Centro", "Cabo Frio"));

  // ── O caso da NIK ──────────────────────────────────────────────────────
  const antes = await prepararBusca(NIK, lojaNik, viaCepFora);
  confere("sem o CEP (ViaCEP fora), o texto vira bairro 'Brasília/DF' — o erro de 14/10",
    antes.item.neighborhood === "Brasília/DF" && !antes.peloCep && antes.cepFalhou, antes);

  const nik = await prepararBusca(NIK, lojaNik, viaCepFalso);
  confere("pelo CEP: bairro Sobradinho", nik.item.neighborhood === "Sobradinho", nik.item);
  confere("pelo CEP: rua dos Correios, sem o bloco (é o prédio; com ele o mapa casava a Quadra 14)", nik.item.streetName === "Quadra 2 Conjunto B-2", nik.item);
  confere("pelo CEP: número do texto", nik.item.houseNumber === "601", nik.item);
  confere("pelo CEP: cidade Brasília, UF DF (a loja não tem UF no endereço)", nik.cidade === "Brasília" && nik.estado === "DF", nik);
  confere("pelo CEP: marcado e cacheável", nik.peloCep && !nik.cepFalhou);
  confere("pelo CEP: o texto de busca não carrega 'Brasília/DF' nem o CEP",
    !/Brasília\/DF|73015/.test(nik.item.cleanedStreet), nik.item.cleanedStreet);

  // ── O bairro do mapa confere em qualquer nível ─────────────────────────
  // O Nominatim acha a "Quadra 2 Conjunto B-2" com suburb "Vila Dnocs" e
  // town "Sobradinho" (resposta real de 14/10/2026). Conferir só o suburb
  // recusava a rua certa e o Photon casava outra quadra a 3 km.
  const geo = criarGeocodificador({ storeCity: "Brasília", estado: "DF", centroDaLoja: lojaNik.centro });
  confere("Sobradinho confere quando está em outro nível do endereço do OSM",
    geo.bairroConfere({ bairro: "Vila Dnocs", bairros: ["Quadra 2", "Vila Dnocs", "Sobradinho"] } as any, "Sobradinho"));
  confere("bairro de outro lugar continua recusado",
    !geo.bairroConfere({ bairro: "Asa Sul", bairros: ["Asa Sul"] } as any, "Sobradinho"));

  // ── Os outros caminhos ─────────────────────────────────────────────────
  const loja = { cidade: "Cabo Frio", estado: "RJ", centro: { lat: -22.88, lng: -42.02 } };
  const cf = await prepararBusca("R do forno, 45 - CEP 28905-080", loja, viaCepFalso);
  confere("mesma cidade: fica a cidade da loja e a rua/bairro dos Correios",
    cf.cidade === "Cabo Frio" && cf.estado === "RJ" && cf.item.streetName === "Rua do Forno" && cf.item.neighborhood === "Jardim Esperança" && cf.item.houseNumber === "45", cf);

  const geral = await prepararBusca("Rua das Flores, 120 - Centro - CEP 28900-000", loja, viaCepFalso);
  confere("CEP da cidade toda (sem rua nem bairro): segue pelo texto", !geral.peloCep && !geral.cepFalhou && geral.cidade === "Cabo Frio", geral);

  const inexistente = await prepararBusca("Rua das Flores, 120 - Centro - CEP 99999-999", loja, viaCepFalso);
  confere("CEP que não existe: segue pelo texto e pode ir ao cache", !inexistente.peloCep && !inexistente.cepFalhou, inexistente);

  pedidas.length = 0;
  const semCep = await prepararBusca("Rua das Flores, 120 - Centro", loja, viaCepFalso);
  confere("sem CEP: nem pergunta ao ViaCEP", !semCep.peloCep && pedidas.length === 0, pedidas);

  console.log(falhas === 0 ? `\nTUDO CERTO (${ok})` : `\n${falhas} FALHA(S), ${ok} ok`);
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
