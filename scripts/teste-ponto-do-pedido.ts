/**
 * O ponto do pedido no mapa (lib/ponto-do-pedido.ts, lib/geocodificacao.ts) —
 * sem rede e sem banco: o mapa (Nominatim/Photon) é servido com as respostas
 * REAIS gravadas em 16/10/2026 (scratch/sonda-ponto-nik.ts).
 *
 * Caso real: NIK Esfihas (Sobradinho/DF). O #30 da Wabiz, "Avenida central
 * conjunto 02, 17 - SOBRADINHO 2 - Brasília/DF - CEP 73062892", apareceu na Asa
 * Sul (SGAS), a 20 km da loja: o CEP não existe nos Correios, o texto virou
 * bairro "Brasília/DF", e o mapa achou o "Instituto de Arquitetos de Brasília".
 *
 *   DATABASE_URL=postgresql://x@127.0.0.1:1/x npx tsx scripts/teste-ponto-do-pedido.ts
 */
import {
  areaDaLoja,
  areaParaOMapa,
  chavesDoAprendizado,
  cepServeDeChave,
  distanciaKm,
  fonteConfiavel,
  fonteDaGeocodificacao,
  lerPontoGravado,
  motivoForaDaArea,
  planoDosPontos,
  pontoGravadoVale,
  pontoPlausivel,
  raioDoPedido,
  type AreaDaLoja,
  type PedidoNoMapa,
  type Resolucao,
} from "@/lib/ponto-do-pedido";
import {
  criarGeocodificador,
  ehCidadeOuEstado,
  nomeDeBairroComparavel,
  nucleoDaCidade,
  parseAddressDetails,
  variantesDoBairro,
} from "@/lib/geocodificacao";
import { prepararBusca } from "@/lib/geocodificacao-servidor";
import { coordenadasDoParceiro } from "@/lib/coordenadas-do-parceiro";
import type { ConsultaDoCep } from "@/lib/cep";

let ok = 0;
let falhas = 0;
function confere(nome: string, cond: boolean, detalhe?: unknown) {
  if (cond) {
    ok++;
    console.log(`  ok   ${nome}`);
  } else {
    falhas++;
    console.log(`  FALHA ${nome}${detalhe === undefined ? "" : ` — ${JSON.stringify(detalhe)}`}`);
  }
}

// ── A loja: NIK Esfihas, por bairro (sem raio), pino salvo ────────────────────
const NIK = { lat: -15.6467899133085, lng: -47.80763973611775 };
const lojaNik = { deliveryZoneType: "NEIGHBORHOOD", deliveryZones: [{ name: "Quadra 1", fee: 5 }, { name: "Sobradinho 2", fee: 7 }], deliveryConfig: { limiteDeAtendimento: [] } };
const areaNik = areaDaLoja(lojaNik, NIK);
const ASA_SUL = { lat: -15.81266, lng: -47.88503 }; // o "Instituto de Arquitetos de Brasília" (SGAS)

// ── O mapa, com as respostas reais ──────────────────────────────────────────
type Lugar = { class: string; type: string; addresstype: string; name: string; lat: string; lon: string; address: Record<string, string> };
const NOMINATIM: Record<string, Lugar[]> = {
  // A busca do bairro lido errado: um terreno comercial na Asa Sul.
  "q:brasilia/df, brasilia df, brasil": [
    { class: "landuse", type: "commercial", addresstype: "commercial", name: "Instituto de Arquitetos de Brasília", lat: "-15.81266", lon: "-47.88503", address: { suburb: "Asa Sul", city: "Brasília" } },
  ],
  // A busca solta da rua sem o bairro certo: outra avenida, a 14 km.
  "q:avenida central conjunto 02, 17, brasilia/df, brasilia df, brasil": [
    { class: "highway", type: "tertiary", addresstype: "road", name: "Avenida Paranoá", lat: "-15.77143", lon: "-47.77969", address: { road: "Avenida Paranoá", city: "Brasília" } },
  ],
  "q:avenida central conjunto 02, brasilia/df, brasilia df, brasil": [
    { class: "highway", type: "tertiary", addresstype: "road", name: "Avenida Paranoá", lat: "-15.77298", lon: "-47.77970", address: { road: "Avenida Paranoá", city: "Brasília" } },
  ],
  // Com o bairro certo ("SOBRADINHO 2"): a região administrativa e a avenida dela.
  "q:sobradinho 2, brasilia df, brasil": [
    { class: "boundary", type: "administrative", addresstype: "town", name: "Sobradinho II", lat: "-15.6437253", lon: "-47.8260143", address: { town: "Sobradinho II", state: "Distrito Federal" } },
  ],
  "q:avenida central conjunto 02, sobradinho 2, brasilia df, brasil": [
    { class: "highway", type: "residential", addresstype: "road", name: "Avenida Central Conjunto 3", lat: "-15.6448773", lon: "-47.8249946", address: { road: "Avenida Central Conjunto 3", residential: "Avenida Central", suburb: "Setor de Mansões de Sobradinho", town: "Sobradinho II" } },
  ],
  // Pelo CEP: Sobradinho (RA) e a quadra/conjunto dos Correios.
  "q:sobradinho, brasilia, df, brasil": [
    { class: "boundary", type: "administrative", addresstype: "town", name: "Sobradinho", lat: "-15.6500533", lon: "-47.7848449", address: { town: "Sobradinho", state: "Distrito Federal" } },
  ],
  "s:06 quadra 17 conjunto a|brasilia": [
    { class: "highway", type: "residential", addresstype: "road", name: "Quadra 17 Conjunto A", lat: "-15.6443312", lon: "-47.7746949", address: { road: "Quadra 17 Conjunto A", residential: "Quadra 17", village: "Nova Colina", town: "Sobradinho" } },
  ],
  "q:quadra 3 conjunto c, 52, sobradinho, brasilia, df, brasil": [
    { class: "highway", type: "residential", addresstype: "road", name: "Quadra 3 Conjunto C", lat: "-15.6536468", lon: "-47.8075093", address: { road: "Quadra 3 Conjunto C", residential: "Quadra 3", suburb: "Vila Dnocs", town: "Sobradinho" } },
  ],
  "q:setor de mansoes de sobradinho, brasilia, df, brasil": [
    { class: "place", type: "suburb", addresstype: "suburb", name: "Setor de Mansões de Sobradinho", lat: "-15.6331566", lon: "-47.8357140", address: { suburb: "Setor de Mansões de Sobradinho", town: "Sobradinho II" } },
  ],
  // "QMS 16" volta "QMS 39A": outra quadra do mesmo setor.
  "q:quadra qms 16, 2, setor de mansoes de sobradinho, brasilia, df, brasil": [
    { class: "highway", type: "residential", addresstype: "road", name: "QMS 39A", lat: "-15.6318057", lon: "-47.8327520", address: { road: "QMS 39A", suburb: "Setor de Mansões de Sobradinho", town: "Sobradinho II" } },
  ],
  "q:quadra qms 16, setor de mansoes de sobradinho, brasilia, df, brasil": [
    { class: "highway", type: "residential", addresstype: "road", name: "QMS 39A", lat: "-15.6318057", lon: "-47.8327520", address: { road: "QMS 39A", suburb: "Setor de Mansões de Sobradinho", town: "Sobradinho II" } },
  ],
  // O bairro dos Correios com parênteses: "Serra Azul (Sobradinho)" → o condomínio no OSM.
  "q:serra azul (sobradinho), brasilia, df, brasil": [
    { class: "landuse", type: "residential", addresstype: "residential", name: "Condomínio Serra Azul", lat: "-15.6345942", lon: "-47.8470688", address: { residential: "Condomínio Serra Azul", suburb: "Setor de Mansões de Sobradinho", town: "Sobradinho II" } },
  ],
  // "Setor Oeste (Sobradinho II)" (Correios): o OSM não tem o setor; tem a região.
  "q:setor oeste (sobradinho ii), brasilia, df, brasil": [
    { class: "place", type: "suburb", addresstype: "suburb", name: "Setor de Mansões de Sobradinho", lat: "-15.6331566", lon: "-47.8357140", address: { suburb: "Setor de Mansões de Sobradinho", town: "Sobradinho II" } },
  ],
  // Macaé (Pizzaria 17 Aeroporto): o bairro "São Marcos" volta como RUA; a
  // "Rua Cinco" do cliente é o alt_name da Rua Adonias Lucas Martins.
  "q:sao marcos, macae, rj, brasil": [
    { class: "highway", type: "residential", addresstype: "road", name: "Rua São Marcos", lat: "-22.37", lon: "-41.79", address: { road: "Rua São Marcos", suburb: "Novo Horizonte" } },
  ],
  "s:45 rua cinco|macae": [
    { class: "highway", type: "unclassified", addresstype: "road", name: "Rua Adonias Lucas Martins", lat: "-22.3845298", lon: "-41.8167697", address: { road: "Rua Adonias Lucas Martins", city: "Macaé" }, namedetails: { name: "Rua Adonias Lucas Martins", "name:pt": "Rua Adonias Lucas Martins", alt_name: "Rua Cinco" } } as any,
  ],
};
const PHOTON: Record<string, unknown[]> = {
  // A busca "fuzzy" da rua com o bairro errado: um condomínio a 22,9 km.
  "avenida central conjunto 02 17, brasilia/df, brasilia df": [
    { geometry: { coordinates: [-47.81483, -15.85239] }, properties: { name: "Condomínio Solar de Brasilia, Quadra 2 Conjunto 17", osm_key: "highway" } },
  ],
};
const sem = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const buscasFeitas: string[] = [];
let mapaFora = false;
globalThis.fetch = (async (url: string) => {
  const u = new URL(String(url));
  if (mapaFora) return { ok: false, status: 429, json: async () => ({}) } as any;
  let corpo: unknown = [];
  if (u.hostname.includes("nominatim")) {
    const q = u.searchParams.get("q");
    const chave = q != null ? `q:${sem(q)}` : `s:${sem(u.searchParams.get("street") || "")}|${sem(u.searchParams.get("city") || "")}`;
    buscasFeitas.push(chave);
    corpo = NOMINATIM[chave] || [];
  } else if (u.hostname.includes("photon")) {
    corpo = { features: PHOTON[sem(u.searchParams.get("q") || "")] || [] };
  }
  return { ok: true, status: 200, json: async () => corpo } as any;
}) as unknown as typeof fetch;

const semFila = <T,>(f: () => Promise<T>) => f();
const geoNik = (raioMaxKm?: number, cidade = "BRASILIA DF", estado: string | null = null) =>
  criarGeocodificador({ storeCity: cidade, estado, centroDaLoja: NIK, vez: semFila, raioMaxKm });

// ViaCEP com as respostas reais (16/10/2026).
const VIACEP: Record<string, ConsultaDoCep> = {
  "73062892": { ok: false, motivo: "nao-existe" },
  "73045171": { ok: true, endereco: { rua: "Quadra 17 Conjunto A", bairro: "Sobradinho", cidade: "Brasília", uf: "DF" } },
  "73030033": { ok: true, endereco: { rua: "Quadra 3 Conjunto C", bairro: "Sobradinho", cidade: "Brasília", uf: "DF" } },
  "73082120": { ok: true, endereco: { rua: "Quadra QMS 16", bairro: "Setor de Mansões de Sobradinho", cidade: "Brasília", uf: "DF" } },
};
const viaCep = async (cep: string): Promise<ConsultaDoCep> => VIACEP[cep] ?? { ok: false, motivo: "nao-existe" };
const lojaDaBusca = { cidade: "BRASILIA DF", estado: null as string | null, centro: NIK };

const W30 = "Avenida central conjunto 02, 17 - SOBRADINHO 2 - Brasília/DF - CEP 73062892";
const W13 = "Quadra 17 cnj A, Casa 06 - Rua da igreja - QUADRA 17 - Brasília/DF - CEP 73045171";
const W45 = "Qms 16 lote 12, 2 - interfone 2 - SETOR DE MANSOES - Brasília/DF - CEP 73082120";
const W48 = "Quadra 03, conjunto c, casa 52, 52 - Conjunto c - QUADRA 3 - Brasília/DF - CEP 73030033";

async function main() {
  console.log("\n1) O bairro lido do texto: 'Brasília/DF' e 'DF' são a cidade, não o bairro");
  confere("Wabiz #30: bairro SOBRADINHO 2 (era 'Brasília/DF')", parseAddressDetails(W30, "BRASILIA DF").neighborhood === "SOBRADINHO 2", parseAddressDetails(W30, "BRASILIA DF"));
  confere("Wabiz #13: bairro QUADRA 17", parseAddressDetails(W13, "BRASILIA DF").neighborhood === "QUADRA 17");
  confere("Wabiz #45: bairro SETOR DE MANSOES", parseAddressDetails(W45, "BRASILIA DF").neighborhood === "SETOR DE MANSOES");
  confere("Wabiz com a cidade da loja escrita sem UF ('Brasília')", parseAddressDetails(W30, "Brasília").neighborhood === "SOBRADINHO 2");
  confere("99Food '… - Sobradinho, Brasília - DF': bairro Sobradinho (era 'DF')",
    parseAddressDetails("Quadra Central Feira Modelo, 83/84 - Sobradinho, Brasília - DF", "BRASILIA DF").neighborhood === "Sobradinho");
  confere("São Paulo/SP no fim não é bairro", parseAddressDetails("Rua X, 10 - Jardim Paulista - São Paulo/SP - CEP 01310100", "São Paulo").neighborhood === "Jardim Paulista");
  confere("cidade cadastrada com UF ('Cabo Frio - RJ')", parseAddressDetails("Rua A, 5 - Braga - Cabo Frio", "Cabo Frio - RJ").neighborhood === "Braga");
  confere("São Gonçalo (Lucas Pimenta) continua Alcantara",
    parseAddressDetails("Tv. Dom Bosco, 13 - casa - Alcantara - São Gonçalo", "São Gonçalo").neighborhood === "Alcantara");
  confere("número, CEP e UF soltos não são bairro", ["17", "CEP 73062892", "DF", "Distrito Federal", "Brasília/DF", "brasilia df"].every((p) => ehCidadeOuEstado(p, "BRASILIA DF")));
  confere("o bairro de verdade passa", !ehCidadeOuEstado("SOBRADINHO 2", "BRASILIA DF") && !ehCidadeOuEstado("Asa Norte", "Brasília"));
  confere("núcleo da cidade sem a UF", nucleoDaCidade("BRASILIA DF") === "brasilia" && nucleoDaCidade("Cabo Frio/RJ") === "cabo frio" && nucleoDaCidade("Cabo Frio - RJ") === "cabo frio");
  confere("bairro comparável: 'Sobradinho II' = 'SOBRADINHO 2', 'Quadra 02' = 'quadra 2'",
    nomeDeBairroComparavel("Sobradinho II") === nomeDeBairroComparavel("SOBRADINHO 2") && nomeDeBairroComparavel("Quadra 02") === "quadra 2");
  confere("bairro comparável sem o que vem entre parênteses ('Serra Azul (Sobradinho)')", nomeDeBairroComparavel("Serra Azul (Sobradinho)") === "serra azul");

  console.log("\n2) A área da loja: até onde um ponto achado pelo texto vale");
  confere("NIK (por bairro): 15 km nos dois canais", areaNik.raioKm === 15 && areaNik.raioDoParceiroKm === 15 && areaNik.base === "sem-raio", areaNik);
  const km = areaDaLoja({ deliveryZoneType: "KM", deliveryZones: [{ km: 1 }, { km: 3 }, { km: 5 }] }, NIK);
  confere("KM 1/3/5: 7,5 km na loja, 15 km no marketplace", km.raioKm === 7.5 && km.raioDoParceiroKm === 15 && km.base === "faixas", km);
  const ragnar = areaDaLoja({ deliveryZoneType: "KM", deliveryZones: [{ km: 2 }, { km: 3 }] }, NIK);
  confere("faixas até 3 km: 4,5 km na loja (o iFood da Ragnar entrega a 10 km: 15 no marketplace)", ragnar.raioKm === 4.5 && ragnar.raioDoParceiroKm === 15);
  const minusculo = areaDaLoja({ deliveryZoneType: "ROTA", deliveryZones: [{ km: 1 }] }, NIK);
  confere("faixa minúscula não vira régua de 1,5 km (mínimo 4)", minusculo.raioKm === 4);
  const v = (dLat: number) => [NIK.lat + dLat, NIK.lng] as [number, number];
  const desenho = areaDaLoja({ deliveryZoneType: "POLIGONO", deliveryZones: [{ nome: "A", pontos: [v(0.036), v(-0.036), [NIK.lat, NIK.lng + 0.03]] }] }, NIK);
  confere("área desenhada: vértice mais longe × 1,5", Math.abs(desenho.raioKm - 4.0 * 1.5) < 0.2 && desenho.base === "area-desenhada", desenho);
  const contorno = areaDaLoja(
    { deliveryZoneType: "KM", deliveryZones: [{ km: 3 }], deliveryConfig: { limiteDeAtendimento: [{ nome: "x", ativa: true, pontos: [v(0.072), v(-0.01), [NIK.lat, NIK.lng + 0.01]] }] } },
    NIK,
  );
  confere("contorno ligado maior que as faixas: vale o contorno", Math.abs(contorno.raioKm - 8.0 * 1.5) < 0.3 && contorno.base === "contorno", contorno);
  const desligado = areaDaLoja(
    { deliveryZoneType: "KM", deliveryZones: [{ km: 3 }], deliveryConfig: { limiteDeAtendimento: [{ nome: "x", ativa: false, pontos: [v(0.072), v(-0.01), [NIK.lat, NIK.lng + 0.01]] }] } },
    NIK,
  );
  confere("contorno desligado não conta", desligado.raioKm === 4.5);
  confere("sem o pino da loja não há área para a tela", areaParaOMapa(lojaNik, { ponto: NIK, origem: "endereco" }) === null);
  confere("com o pino salvo a tela recebe só os dois raios", JSON.stringify(areaParaOMapa(lojaNik, { ponto: NIK, origem: "cadastro" })) === JSON.stringify({ raioKm: 15, raioDoParceiroKm: 15 }));

  console.log("\n3) A trava: ponto achado longe da área não vale");
  confere("a Asa Sul (20 km) para a NIK: fora", !pontoPlausivel(ASA_SUL, areaNik, true) && distanciaKm(NIK, ASA_SUL) > 20);
  confere("o centro de Sobradinho II (2 km): dentro", pontoPlausivel({ lat: -15.6437253, lng: -47.8260143 }, areaNik, true));
  confere("sem o ponto da loja não há régua (vale, como antes)", pontoPlausivel(ASA_SUL, { ...areaNik, centro: null }));
  confere("o motivo diz a distância e o limite", /20,\d km da loja, fora da área \(15,0 km\)/.test(motivoForaDaArea(ASA_SUL, areaNik, true)), motivoForaDaArea(ASA_SUL, areaNik, true));
  confere("marketplace usa o raio maior", raioDoPedido(km, true) === 15 && raioDoPedido(km, false) === 7.5);

  console.log("\n4) O ponto que o pedido já traz");
  const ifood = lerPontoGravado({ lat: -15.656366, lng: -47.795536 }, true);
  confere("iFood sem origem = parceiro", ifood?.fonte === "parceiro" && fonteConfiavel("parceiro"));
  const casa = { lat: -15.653647, lng: -47.807509 };
  confere("gps / pino = cliente", lerPontoGravado({ ...casa, origem: "gps" }, false)?.fonte === "cliente" && lerPontoGravado({ ...casa, origem: "pino" }, false)?.fonte === "cliente");
  confere("manual = manual, aprendido = aprendido", lerPontoGravado({ ...casa, origem: "manual" }, true)?.fonte === "manual" && lerPontoGravado({ ...casa, origem: "aprendido" }, true)?.fonte === "aprendido");
  confere("ponto redondo demais (2 casas nos dois) é enchimento, venha de onde vier", lerPontoGravado({ lat: -15.65, lng: -47.8, origem: "gps" }, false) === null);
  const doCron = lerPontoGravado({ ...ASA_SUL, origem: "bairro" }, true);
  confere("'bairro' gravado pelo cron é aproximado e é LEITURA do texto", doCron?.fonte === "bairro" && doCron.aproximado && !fonteConfiavel("bairro"));
  confere("(-23,-43) do 99Food não é ponto", lerPontoGravado({ lat: -23, lng: -43 }, true) === null);
  confere("o ponto do parceiro vale até 60 km (o app tem a área dele)", pontoGravadoVale(lerPontoGravado({ ...ASA_SUL }, true), areaNik, true));
  confere("o centro de bairro gravado a 20 km NÃO vale", !pontoGravadoVale(doCron, areaNik, true));
  confere("fonte da origem do servidor", fonteDaGeocodificacao("rua (busca estruturada) (pelo CEP)") === "cep" && fonteDaGeocodificacao("bairro (OSM)") === "bairro" &&
    fonteDaGeocodificacao("bairro (OSM) (pelo CEP)") === "bairro" && fonteDaGeocodificacao("rua + bairro") === "texto" && fonteDaGeocodificacao("posição salva pela loja") === "aprendido" && fonteDaGeocodificacao("google (rua)") === "google");

  console.log("\n5) A cascata do mapa com as respostas reais do #30");
  // Com o bairro errado de antes ("Brasília/DF"), forçado: as regras novas recusam tudo.
  buscasFeitas.length = 0;
  const forcado = await geoNik(areaNik.raioKm).geocodificarItem({
    idx: 0, neighborhood: "Brasília/DF", streetName: "Avenida central conjunto 02", houseNumber: "17",
    cleanedStreet: "Avenida central conjunto 02, 17, SOBRADINHO 2, CEP 73062892",
  });
  confere("o 'Instituto de Arquitetos' não é o bairro, a Avenida Paranoá não é a rua: nada (incerto, não a Asa Sul)",
    forcado.nivel === "nenhum", forcado);
  // Mesmo com a régua antiga de 30 km: o terreno comercial não vira centro de bairro.
  const forcado30 = await geoNik(undefined).geocodificarItem({
    idx: 0, neighborhood: "Brasília/DF", streetName: "Avenida central conjunto 02", houseNumber: "17",
    cleanedStreet: "Avenida central conjunto 02, 17, SOBRADINHO 2, CEP 73062892",
  });
  confere("… e nem com a régua antiga de 30 km o pino vai para a Asa Sul", forcado30.nivel === "nenhum" && distanciaKm(NIK, forcado30.coords) < 1, forcado30);

  // O caminho inteiro de agora: CEP (não existe) → texto com o bairro certo.
  const b30 = await prepararBusca(W30, lojaDaBusca, viaCep);
  const r30 = await geoNik(areaNik.raioKm, b30.cidade, b30.estado).geocodificarItem({ idx: 0, ...b30.item });
  confere("#30: CEP desconhecido → texto → 'Avenida Central Conjunto 3' em Sobradinho II, 1,9 km",
    !b30.peloCep && r30.nivel === "rua" && Math.abs(distanciaKm(NIK, r30.coords) - 1.9) < 0.2 && pontoPlausivel(r30.coords, areaNik, true), { b30: b30.item, r30 });

  const b13 = await prepararBusca(W13, lojaDaBusca, viaCep);
  const r13 = await geoNik(areaNik.raioKm, b13.cidade, b13.estado).geocodificarItem({ idx: 0, ...b13.item });
  confere("#13 (Quadra 17 Conjunto A): pelo CEP, rua estruturada, 3,5 km", b13.peloCep && r13.origem === "rua (busca estruturada)" && Math.abs(distanciaKm(NIK, r13.coords) - 3.5) < 0.2, r13);

  const b48 = await prepararBusca(W48, lojaDaBusca, viaCep);
  const r48 = await geoNik(areaNik.raioKm, b48.cidade, b48.estado).geocodificarItem({ idx: 0, ...b48.item });
  confere("#48 (Quadra 3 Conjunto C): pelo CEP, 0,8 km — o navegador sem CEP o pôs na Asa Sul", b48.peloCep && r48.nivel === "rua" && distanciaKm(NIK, r48.coords) < 1, r48);

  const b45 = await prepararBusca(W45, lojaDaBusca, viaCep);
  const r45 = await geoNik(areaNik.raioKm, b45.cidade, b45.estado).geocodificarItem({ idx: 0, ...b45.item });
  confere("#45 (QMS 16): o mapa só conhece a 'QMS 39A' → centro do Setor de Mansões, APROXIMADO (não finge a porta)",
    r45.nivel === "bairro" && r45.origem === "bairro (OSM)" && Math.abs(distanciaKm(NIK, r45.coords) - 3.4) < 0.2, r45);
  confere("as respostas reais não marcaram falha do mapa", !r30.mapaFalhou && !r13.mapaFalhou && !r45.mapaFalhou && !forcado.mapaFalhou);

  // NIK, "Cond. Serra Azul Quadra 6 …": os Correios dizem "Serra Azul (Sobradinho)".
  const serraAzul = await geoNik(areaNik.raioKm, "Brasília", "DF").geocodificarItem({
    idx: 0, neighborhood: "Serra Azul (Sobradinho)", streetName: "Quadra 6", houseNumber: "6", cleanedStreet: "Quadra 6, 6",
  });
  confere("bairro com parênteses dos Correios: o 'Condomínio Serra Azul' do OSM é o bairro (4,4 km, aproximado)",
    serraAzul.nivel === "bairro" && Math.abs(distanciaKm(NIK, serraAzul.coords) - 4.4) < 0.2, serraAzul);

  // NIK, "Ar 12 conjunto 10 …": os Correios dizem "Setor Oeste (Sobradinho II)".
  const setorOeste = await geoNik(areaNik.raioKm, "Brasília", "DF").geocodificarItem({
    idx: 0, neighborhood: "Setor Oeste (Sobradinho II)", streetName: "Quadra AR 12 Conjunto 10", houseNumber: "01", cleanedStreet: "Quadra AR 12 Conjunto 10, 01",
  });
  confere("'Setor Oeste (Sobradinho II)': o setor não está no OSM, a região sim — centro aproximado em Sobradinho II (3,4 km), não incerto",
    setorOeste.nivel === "bairro" && Math.abs(distanciaKm(NIK, setorOeste.coords) - 3.4) < 0.2, setorOeste);
  confere("as duas leituras do bairro com parênteses", JSON.stringify(variantesDoBairro("Setor Oeste (Sobradinho II)")) === JSON.stringify(["oeste", "sobradinho 2"]));

  // Macaé: a rua com o nome do bairro não é o bairro; o apelido da rua (alt_name) é a rua.
  const MACAE = { lat: -22.3396303, lng: -41.7589431 };
  const geoMacae = criarGeocodificador({ storeCity: "MACAE", estado: "RJ", centroDaLoja: MACAE, vez: semFila, raioMaxKm: 15 });
  const cinco = await geoMacae.geocodificarItem({ idx: 0, neighborhood: "São Marcos", streetName: "Rua Cinco", houseNumber: "45", cleanedStreet: "Rua Cinco, 45, São Marcos, Macaé" });
  confere("'Rua Cinco' = alt_name da Rua Adonias Lucas Martins: achada pela rua (7,8 km), e a 'Rua São Marcos' não virou bairro",
    cinco.origem === "rua (busca estruturada)" && Math.abs(distanciaKm(MACAE, cinco.coords) - 7.8) < 0.2, cinco);

  // Mapa fora (429): "não achei" não é "não existe" — quem chama pergunta de novo.
  mapaFora = true;
  const fora = await geoNik(areaNik.raioKm).geocodificarItem({ idx: 0, ...b30.item });
  mapaFora = false;
  confere("mapa fora: nada achado, mas MARCADO como falha (não vira incerto nem cache)", fora.nivel === "nenhum" && fora.mapaFalhou, fora);

  console.log("\n6) A posição que a loja ensina: as chaves do endereço");
  const c13 = chavesDoAprendizado(W13);
  confere("texto inteiro + CEP de rua com o número (06 → 6)", c13.length === 2 && c13[0].startsWith("t:quadra 17 cnj a casa 06") && c13[1] === "c:73045171|6", c13);
  confere("CEP do condomínio inteiro (73130-900) não serve de chave", !cepServeDeChave("73130900") && chavesDoAprendizado("Quadra 106 conjunto 1 casa 37, 37 - ALTO BOA VISTA - Brasília/DF - CEP 73130900").length === 1);
  confere("CEP da cidade (final 000) também não", !cepServeDeChave("28900000") && cepServeDeChave("73062892"));
  confere("#30: CEP desconhecido dos Correios ainda serve (é a mesma porta)", chavesDoAprendizado(W30).includes("c:73062892|17"));
  confere("o mesmo endereço com outra caixa e acento dá a mesma chave", chavesDoAprendizado(W30.toUpperCase())[0] === chavesDoAprendizado(W30)[0]);
  confere("endereço vazio não ensina nada", chavesDoAprendizado("").length === 0 && chavesDoAprendizado(null).length === 0);

  console.log("\n7) O que a roteirização desenha (planoDosPontos)");
  const agora = Date.parse("2026-10-16T22:30:00Z");
  const pedidos: PedidoNoMapa[] = [
    { id: "i39", customerLatLng: { lat: -15.656366, lng: -47.795536 }, ehMarketplace: true, endereco: "Q 2 Conj. C3, 15 - Sobradinho - Brasília", franchiseeId: "nik" },
    { id: "w30", customerLatLng: null, ehMarketplace: true, endereco: W30, franchiseeId: "nik" },
    { id: "w48", customerLatLng: null, ehMarketplace: true, endereco: W48, franchiseeId: "nik" },
    { id: "cron", customerLatLng: { ...ASA_SUL, origem: "bairro" }, ehMarketplace: true, endereco: W30, franchiseeId: "nik" },
    { id: "outra", customerLatLng: { ...ASA_SUL, origem: "mapa" }, ehMarketplace: false, endereco: "Rua X", franchiseeId: "filial" },
    { id: "vazio", customerLatLng: null, ehMarketplace: false, endereco: "  ", franchiseeId: "nik" },
  ];
  const vazio = new Map<string, Resolucao>();
  const p1 = planoDosPontos(pedidos, { area: areaNik, lojaDoMapa: "nik", resolucoes: vazio, agora });
  confere("iFood com ponto: desenhado onde o iFood disse, como parceiro", p1.pontos.i39?.lat === -15.656366 && p1.info.i39?.fonte === "parceiro");
  confere("Wabiz sem ponto: pergunta ao servidor", p1.perguntar.includes("w30") && p1.perguntar.includes("w48") && !p1.pontos.w30);
  confere("o centro de bairro gravado na Asa Sul NÃO é desenhado: pergunta de novo", !p1.pontos.cron && p1.perguntar.includes("cron"));
  confere("pedido de OUTRA loja (Todas as lojas) não passa pela área desta", !!p1.pontos.outra);
  confere("pedido sem endereço: incerto, sem perguntar", p1.incertos.vazio === "pedido sem endereço" && !p1.perguntar.includes("vazio"));
  const emVoo = new Set(["w30"]);
  confere("o que já está em voo não é pedido de novo", !planoDosPontos(pedidos, { area: areaNik, lojaDoMapa: "nik", resolucoes: vazio, agora, emVoo }).perguntar.includes("w30"));
  const respostas = new Map<string, Resolucao>([
    ["w30", { ponto: r30.coords, fonte: "texto", aproximado: false, em: agora }],
    ["w48", { ponto: null, motivo: "o mapa não achou a rua nem o bairro deste endereço", em: agora }],
    ["cron", { ponto: null, em: agora }],
  ]);
  const p2 = planoDosPontos(pedidos, { area: areaNik, lojaDoMapa: "nik", resolucoes: respostas, agora: agora + 1000 });
  confere("resposta do servidor: desenhado com a fonte", !!p2.pontos.w30 && p2.info.w30.fonte === "texto");
  confere("incerto: na lista, fora do mapa, sem perguntar de novo por 5 min", !p2.pontos.w48 && !!p2.incertos.w48 && !p2.perguntar.includes("w48"));
  confere("sem resposta: espera 15 s", !p2.perguntar.includes("cron"));
  const p3 = planoDosPontos(pedidos, { area: areaNik, lojaDoMapa: "nik", resolucoes: respostas, agora: agora + 16_000 });
  confere("… e pergunta de novo depois", p3.perguntar.includes("cron") && !p3.perguntar.includes("w48"));
  const p4 = planoDosPontos(pedidos, { area: areaNik, lojaDoMapa: "nik", resolucoes: respostas, agora: agora + 5 * 60_000 + 1 });
  confere("o incerto é perguntado de novo depois de 5 min", p4.perguntar.includes("w48"));
  const manual = planoDosPontos([{ ...pedidos[2], customerLatLng: { lat: -15.6536, lng: -47.8075, origem: "manual" } }], { area: areaNik, lojaDoMapa: "nik", resolucoes: respostas, agora });
  confere("posicionado pela loja: desenhado, mesmo que o servidor tenha dito incerto", manual.pontos.w48?.lat === -15.6536 && manual.info.w48.fonte === "manual" && !manual.incertos.w48);

  console.log("\n8) Replay da NIK (15–16/10/2026): antes × depois");
  // Os pontos que a roteirização desenhou para os pedidos reais: o iFood com o
  // ponto dele; a Wabiz com o que o cache do servidor (GeocodeCache) tinha —
  // e o #48, que o servidor não resolveu a tempo, com o que o navegador achou.
  const REAIS: { n: string; fonte: "ifood" | "cache" | "navegador"; ponto: { lat: number; lng: number }; endereco: string; origem?: string }[] = [
    { n: "39", fonte: "ifood", ponto: { lat: -15.656366, lng: -47.795536 }, endereco: "Q 2 Conj. C3, 15 - Sobradinho - Brasília" },
    { n: "42", fonte: "ifood", ponto: { lat: -15.638595, lng: -47.80315 }, endereco: "Q. 9 AR 05 Residencial do Bosque, 505 - Sobradinho - Brasília" },
    { n: "51", fonte: "ifood", ponto: { lat: -15.640682, lng: -47.826937 }, endereco: "AR 5 Conjunto 7, 28 - Sobradinho - Brasília" },
    { n: "13", fonte: "cache", ponto: { lat: -15.64433, lng: -47.77469 }, endereco: W13, origem: "rua (busca estruturada) (pelo CEP)" },
    { n: "45", fonte: "cache", ponto: { lat: -15.63181, lng: -47.83275 }, endereco: W45, origem: "rua + número + bairro (pelo CEP)" },
    { n: "30", fonte: "cache", ponto: ASA_SUL, endereco: W30, origem: "bairro (OSM)" },
    { n: "48", fonte: "navegador", ponto: ASA_SUL, endereco: W48, origem: "bairro (OSM)" },
  ];
  const foraAntes = REAIS.filter((r) => distanciaKm(NIK, r.ponto) > areaNik.raioKm).map((r) => `#${r.n}`);
  // Depois: o ponto do parceiro vale; o do cache só se plausível; o resto é refeito
  // pela cascata nova (as respostas reais do mapa acima) — e o que sobrar fica incerto.
  const refeitos: Record<string, { lat: number; lng: number }> = { "30": r30.coords, "48": r48.coords };
  const depois = REAIS.map((r) => {
    if (r.fonte === "ifood") return { n: r.n, ponto: r.ponto };
    if (r.fonte === "cache" && pontoPlausivel(r.ponto, areaNik, true)) return { n: r.n, ponto: r.ponto };
    return { n: r.n, ponto: refeitos[r.n] ?? null };
  });
  const foraDepois = depois.filter((d) => d.ponto && distanciaKm(NIK, d.ponto) > areaNik.raioKm).map((d) => `#${d.n}`);
  const semPonto = depois.filter((d) => !d.ponto).map((d) => `#${d.n}`);
  console.log(`     antes: ${foraAntes.length} de ${REAIS.length} no mapa fora da área (${foraAntes.join(", ")}); depois: ${foraDepois.length} fora, ${semPonto.length} incerto(s)`);
  confere("antes: #30 e #48 na Asa Sul", foraAntes.join(",") === "#30,#48");
  confere("depois: nenhum pino fora da área, nenhum incerto (os dois em Sobradinho)", foraDepois.length === 0 && semPonto.length === 0);

  console.log("\n9) Wabiz: o campo `geo` (veio nulo nas 29 entregas guardadas) entra se vier em texto ou lista");
  confere("geo: '-15.6448,-47.8249'", JSON.stringify(coordenadasDoParceiro({ geo: "-15.6448,-47.8249" })) === JSON.stringify({ lat: -15.6448, lng: -47.8249 }));
  confere("geo: [lng, lat] (GeoJSON)", JSON.stringify(coordenadasDoParceiro({ geo: [-47.8249, -15.6448] })) === JSON.stringify({ lat: -15.6448, lng: -47.8249 }));
  confere("geo: { coordinates: [lng, lat] }", JSON.stringify(coordenadasDoParceiro({ geo: { type: "Point", coordinates: [-47.8249, -15.6448] } })) === JSON.stringify({ lat: -15.6448, lng: -47.8249 }));
  confere("geo: { lat, lng } continua", JSON.stringify(coordenadasDoParceiro({ geo: { lat: -15.6448, lng: -47.8249 } })) === JSON.stringify({ lat: -15.6448, lng: -47.8249 }));
  confere("geo nulo, grosseiro ou fora do Brasil: nada", coordenadasDoParceiro({ geo: null }) === undefined && coordenadasDoParceiro({ geo: "-23,-43" }) === undefined &&
    coordenadasDoParceiro({ geo: [-23, -43] }) === undefined && coordenadasDoParceiro({ geo: "40.7128,-74.0060" }) === undefined);
  confere("lista de dois números que não é ponto (posição do item) não vira ponto", coordenadasDoParceiro({ position: [1, 2] }) === undefined);

  console.log(`\n${ok} ok, ${falhas} falharam`);
  if (falhas > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
