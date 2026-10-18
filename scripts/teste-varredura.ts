/**
 * A varredura completa da cidade (lib/prospeccao/varredura.ts): a grade que se
 * divide, a parada, a divisão por tipo, o dedupe, o OpenStreetMap, a
 * estimativa, o CUSTO ZERO (teto do dia e do mês, retomada amanhã / no dia 1º),
 * o que pode ir para o banco (termos do Google) e os nomes sob demanda — e a
 * varredura inteira contra uma cidade falsa densa (scripts/cidade-falsa.ts),
 * sem gastar o Google.
 * Roda sem banco e sem rede: npx tsx scripts/teste-varredura.ts
 */
import assert from "node:assert/strict";
import { metrosEntre } from "../src/lib/prospeccao/regras";
import {
  GRUPOS_DE_TIPOS, LADO_DA_RAIZ_M, LADO_MINIMO_M, MAXIMO_POR_CHAMADA, SKUS, TETO_DE_CHAMADAS_POR_CIDADE, TIPOS_DE_COMIDA,
  TRAVAS_DO_CLOUD, VARREDURA_POR_DIA,
  aplicarRespostas, celulasRaiz, circuloDaCelula, consultaDoOverpass, cruzarComOsm, diasDaVarredura, escolherLote,
  estimarChamadas, faltamEstimadas, filhasDaCelula, juntarLugares, ladoDaCelula, lerRespostaDoOverpass, limiteDoDia, lugarDoGoogle,
  lugaresEsperados, mesDaCotaDoGoogle, paraGuardar, percentualDaVarredura, planoDeNomes, quandoContinua, seloDaCobertura,
  tetoDoMes, vagas, vagasDaVarredura,
  type Celula, type CotaDoCloud, type LugarDoMapa, type Sku, type UsoDoGoogle,
} from "../src/lib/prospeccao/varredura";
import { cidadeFalsa, nearbyFalso, type LugarFalso } from "./cidade-falsa";

let casos = 0;
const ok = (f: () => void) => { f(); casos++; };

// Rio das Ostras - RJ (a caixa do Nominatim em 18/10/2026) e Goiânia - GO.
const RIO = { sul: -22.5624592, norte: -22.3767508, oeste: -42.0635168, leste: -41.8177902 };
const GOIANIA = { sul: -16.8318764, norte: -16.4542142, oeste: -49.4469524, leste: -49.078 };

// ─── a lista de tipos (Tabela A, até 50 no includedTypes) ───
ok(() => assert.ok(TIPOS_DE_COMIDA.length <= 50));
ok(() => assert.equal(new Set(TIPOS_DE_COMIDA).size, TIPOS_DE_COMIDA.length));
ok(() => assert.ok(!(TIPOS_DE_COMIDA as readonly string[]).includes("food"), "food é Tabela B: não filtra"));
for (const t of ["restaurant", "meal_takeaway", "meal_delivery", "fast_food_restaurant", "pizza_restaurant", "hamburger_restaurant", "brazilian_restaurant", "bakery", "cafe", "ice_cream_shop", "bar", "sandwich_shop", "acai_shop", "snack_bar"]) {
  ok(() => assert.ok((TIPOS_DE_COMIDA as readonly string[]).includes(t), t));
}
ok(() => assert.deepEqual(GRUPOS_DE_TIPOS.flat(), [...TIPOS_DE_COMIDA]));

// ─── as raízes cobrem a caixa, sem buraco ───
const raizes = celulasRaiz(RIO);
ok(() => assert.equal(raizes.length, 20));
ok(() => assert.ok(raizes.every((c) => ladoDaCelula(c) <= LADO_DA_RAIZ_M + 1)));
ok(() => {
  const area = raizes.reduce((a, c) => a + (c.n - c.s) * (c.l - c.o), 0);
  assert.ok(Math.abs(area - (RIO.norte - RIO.sul) * (RIO.leste - RIO.oeste)) < 1e-9);
});
ok(() => assert.equal(celulasRaiz(GOIANIA).length, 49));
// Município enorme: as raízes crescem em vez de passar de 600.
ok(() => assert.ok(celulasRaiz({ sul: -10, norte: -3, oeste: -56, leste: -50 }).length <= 600));

// ─── o círculo passa pelos 4 cantos; o da filha fica dentro do da mãe ───
const mae = raizes[7];
const { centro: cm, raio: rm } = circuloDaCelula(mae);
ok(() => assert.ok(Math.abs(metrosEntre(cm, { lat: mae.s, lng: mae.o }) - rm) < 2));
ok(() => assert.ok(rm <= 50000));
for (const f of filhasDaCelula(mae)!) {
  const { centro, raio } = circuloDaCelula(f);
  ok(() => assert.ok(metrosEntre(cm, centro) + raio <= rm + 1, "filha fora da mãe"));
}

// ─── a divisão: 4 filhas até o mínimo; depois grupos de tipo; depois 1 tipo; depois saturada ───
ok(() => {
  const f = filhasDaCelula(mae)!;
  assert.equal(f.length, 4);
  assert.ok(f.every((x) => x.nivel === 1 && !x.tipos));
  const area = f.reduce((a, c) => a + (c.n - c.s) * (c.l - c.o), 0);
  assert.ok(Math.abs(area - (mae.n - mae.s) * (mae.l - mae.o)) < 1e-12);
});
let pequena: Celula = mae;
while (filhasDaCelula(pequena)?.length === 4 && !filhasDaCelula(pequena)![0].tipos) pequena = filhasDaCelula(pequena)![0];
ok(() => assert.ok(ladoDaCelula(pequena) >= LADO_MINIMO_M && ladoDaCelula(pequena) / 2 < LADO_MINIMO_M));
ok(() => {
  const grupos = filhasDaCelula(pequena)!;
  assert.equal(grupos.length, GRUPOS_DE_TIPOS.length);
  assert.ok(grupos.every((g) => g.s === pequena.s && g.n === pequena.n && g.tipos!.length === 10));
  const umTipo = filhasDaCelula(grupos[0])!;
  assert.equal(umTipo.length, 10);
  assert.ok(umTipo.every((u) => u.tipos!.length === 1));
  assert.equal(filhasDaCelula(umTipo[0]), null);
});

// ─── aplicar as respostas do lote ───
ok(() => {
  const lote = [raizes[0], raizes[1], raizes[2]];
  const r = aplicarRespostas([raizes[5]], lote, [
    { celulaId: raizes[0].id, bruto: MAXIMO_POR_CHAMADA }, // cheia: 4 filhas
    { celulaId: raizes[1].id, bruto: 3 }, // pronta
    // raizes[2] não voltou (erro): volta para a fila
  ]);
  assert.equal(r.respondidas, 2);
  assert.deepEqual(r.pendentes.map((c) => c.id), ["r2", "r0.0", "r0.1", "r0.2", "r0.3", "r5"]);
  assert.equal(r.saturadas.length, 0);
});
ok(() => {
  const umTipo = filhasDaCelula(filhasDaCelula(pequena)![0])![0];
  const r = aplicarRespostas([], [umTipo], [{ celulaId: umTipo.id, bruto: 20 }]);
  assert.equal(r.saturadas.length, 1);
  assert.equal(r.pendentes.length, 0);
});
// O lote respeita o que sobra do grátis.
ok(() => assert.equal(escolherLote(raizes, 3).lote.length, 3));
ok(() => assert.equal(escolherLote(raizes, 0).lote.length, 0));
ok(() => assert.equal(escolherLote(raizes, Infinity).lote.length, 8));
ok(() => assert.equal(escolherLote(raizes, Infinity).pendentes.length, 12));

// ─── os lugares: dedupe e leitura do Google ───
const lugar = (id: string, nome = "X", lat = -22.5, lng = -41.9): LugarDoMapa => ({ id, nome, endereco: "", lat, lng, tipo: null, mapsUrl: null, origem: "google" });
ok(() => {
  const m = juntarLugares([lugar("ChIJaaaaaaaa", "A"), lugar("ChIJbbbbbbbb")], [lugar("ChIJaaaaaaaa", "A novo"), lugar("ChIJcccccccc")]);
  assert.equal(m.size, 3);
  assert.equal(m.get("ChIJaaaaaaaa")!.nome, "A novo");
});
ok(() => {
  const doJs = lugarDoGoogle({ id: "ChIJxyz12345", displayName: "Pizzaria Bella", formattedAddress: "Rua 1", location: { lat: () => -22.5, lng: () => -41.9 }, primaryType: "pizza_restaurant", googleMapsURI: "https://maps.google.com/?cid=1" });
  assert.equal(doJs?.nome, "Pizzaria Bella");
  assert.equal(doJs?.lat, -22.5);
  assert.equal(doJs?.mapsUrl, "https://maps.google.com/?cid=1");
  const doRest = lugarDoGoogle({ id: "ChIJxyz12345", displayName: { text: "Bar do Zé" }, location: { latitude: -22.4, longitude: -41.8 } });
  assert.equal(doRest?.nome, "Bar do Zé");
  assert.equal(doRest?.lng, -41.8);
  assert.equal(lugarDoGoogle({ id: "ChIJxyz12345", businessStatus: "CLOSED_PERMANENTLY", location: { lat: () => 1, lng: () => 1 } }), null);
  assert.equal(lugarDoGoogle({ id: "ChIJxyz12345" }), null);
});

// ─── OpenStreetMap: a consulta, a leitura e o cruzamento ───
ok(() => assert.match(consultaDoOverpass(RIO), /amenity"~"\^\(restaurant\|fast_food\|cafe\|bar\|ice_cream\|food_court\)\$".*\(-22\.5624592,-42\.0635168,-22\.3767508,-41\.8177902\)/));
const osm = lerRespostaDoOverpass({
  elements: [
    { type: "node", id: 111, lat: -22.5, lon: -41.9, tags: { amenity: "restaurant", name: "Pizzaria Bella Napoli", phone: "+55 22 99999-0000", "addr:street": "Rua A", "addr:housenumber": "10" } },
    { type: "way", id: 222, center: { lat: -22.51, lon: -41.91 }, tags: { amenity: "fast_food", name: "Lanchonete Nova Onda" } },
    { type: "node", id: 333, lat: -22.52, lon: -41.92, tags: { amenity: "bar" } },
    { type: "node", id: 444, tags: { amenity: "cafe", name: "Sem ponto" } },
  ],
});
ok(() => assert.equal(osm.length, 3));
ok(() => assert.equal(osm[0].id, "osm-node-111"));
ok(() => assert.equal(osm[0].telefone, "+55 22 99999-0000"));
ok(() => assert.equal(osm[0].endereco, "Rua A, 10"));
ok(() => assert.equal(osm[1].id, "osm-way-222"));
ok(() => assert.equal(osm[1].tipo, "fast_food_restaurant"));
ok(() => assert.equal(osm[2].nome, "Sem nome"));
ok(() => {
  const google = [
    lugar("ChIJbella0001", "Bella Napoli Pizzaria", -22.5003, -41.9002), // ~40 m: a mesma
    lugar("ChIJbarbar001", "Bar do Porto", -22.52005, -41.92002), // ~10 m do bar sem nome
  ];
  const r = cruzarComOsm(google, osm);
  assert.deepEqual(r.soNoOsm.map((l) => l.id), ["osm-way-222"]);
  assert.deepEqual([...r.tambemNoOsm].sort(), ["ChIJbarbar001", "ChIJbella0001"]);
});
// Mesmo nome a 2 km é outro lugar.
ok(() => assert.equal(cruzarComOsm([lugar("ChIJbella0001", "Pizzaria Bella Napoli", -22.52, -41.9)], [osm[0]]).soNoOsm.length, 1));

// ─── a estimativa ───
ok(() => assert.equal(lugaresEsperados(156491, 77), 1043));
ok(() => assert.equal(lugaresEsperados(null, 77), 770));
ok(() => assert.equal(lugaresEsperados(null, 0), null));
const estRio = estimarChamadas(RIO, 156491, 77)!;
const estGoiania = estimarChamadas(GOIANIA, 1437366, 455)!;
ok(() => assert.equal(estRio, 20 + Math.ceil(1043 * 0.35)));
ok(() => assert.equal(estGoiania, 49 + Math.ceil(9582 * 0.35)));
ok(() => assert.equal(estimarChamadas(RIO, null, 0), null));
ok(() => assert.ok(estimarChamadas(GOIANIA, 50_000_000, 0)! <= TETO_DE_CHAMADAS_POR_CIDADE));

// ─── custo zero: grátis do mês, trava do dia (pricing do Google, 18/10/2026) ───
ok(() => assert.deepEqual([SKUS.nearby.gratis, SKUS.texto.gratis, SKUS.detalhes.gratis, SKUS.contato.gratis, SKUS.mapa.gratis], [5000, 5000, 5000, 1000, 10000]));
ok(() => assert.deepEqual([tetoDoMes("nearby"), tetoDoMes("texto"), tetoDoMes("detalhes"), tetoDoMes("contato"), tetoDoMes("mapa")], [4900, 4900, 4900, 980, 9800]));
// A trava do Cloud × 31 fica abaixo do grátis do SKU MAIS CARO que o método alcança (o GetPlace é do nome e do telefone).
for (const [cota, t] of Object.entries(TRAVAS_DO_CLOUD)) {
  const menorGratis = Math.min(...(t.skus as readonly Sku[]).map((k) => SKUS[k].gratis));
  ok(() => assert.ok(t.porDia * 31 < menorGratis, `${cota}: ${t.porDia} × 31 >= ${menorGratis}`));
}
ok(() => assert.equal(TRAVAS_DO_CLOUD.SearchNearbyRequest.porDia, 160));
ok(() => assert.equal(TRAVAS_DO_CLOUD.GetPlaceRequest.porDia, 32));
ok(() => assert.deepEqual([limiteDoDia("SearchNearbyRequest"), limiteDoDia("SearchTextRequest"), limiteDoDia("GetPlaceRequest"), limiteDoDia("Map loads")], [155, 155, 31, 291]));
ok(() => assert.equal(VARREDURA_POR_DIA, 115));
// O app para antes da trava do Cloud em todo SKU (a tela avisa em vez do erro do Google).
for (const sku of Object.keys(SKUS) as Sku[]) ok(() => assert.ok(limiteDoDia(SKUS[sku].cota as CotaDoCloud) < TRAVAS_DO_CLOUD[SKUS[sku].cota as CotaDoCloud].porDia));
const zero = () => ({ nearby: 0, texto: 0, detalhes: 0, contato: 0, mapa: 0 });
const uso = (hoje: Partial<Record<Sku, number>>, noMes: Partial<Record<Sku, number>> = {}): UsoDoGoogle =>
  ({ dia: "2026-10-18", mes: "2026-10", hoje: { ...zero(), ...hoje }, noMes: { ...zero(), ...hoje, ...noMes } });
ok(() => assert.deepEqual(vagas(uso({}), "nearby"), { qtd: 155, trava: "dia" }));
// O nome (Pro) e o telefone (Enterprise) dividem o GetPlaceRequest do dia.
ok(() => assert.deepEqual(vagas(uso({ contato: 20, detalhes: 11 }), "contato"), { qtd: 0, trava: "dia" }));
ok(() => assert.deepEqual(vagas(uso({ contato: 20 }), "detalhes"), { qtd: 11, trava: "dia" }));
// Fim do mês: o teto do mês manda.
ok(() => assert.deepEqual(vagas(uso({ contato: 2 }, { contato: 975 }), "contato"), { qtd: 5, trava: "mes" }));
ok(() => assert.deepEqual(vagasDaVarredura(uso({ nearby: 100 })), { qtd: 15, trava: "dia" }));
ok(() => assert.deepEqual(vagasDaVarredura(uso({ nearby: 0 }, { nearby: 4890 })), { qtd: 10, trava: "mes" }));
ok(() => assert.deepEqual(vagasDaVarredura(uso({ nearby: 140 })), { qtd: 0, trava: "dia" }));
// A varredura deixa os últimos 40 do dia para os nomes; os nomes alcançam até 155.
ok(() => assert.equal(vagas(uso({ nearby: 115 }), "nearby").qtd, 40));
ok(() => assert.equal(mesDaCotaDoGoogle(new Date("2026-11-01T06:59:00Z")), "2026-10")); // ainda 31/10 no Pacífico
ok(() => assert.equal(mesDaCotaDoGoogle(new Date("2026-11-01T07:00:00Z")), "2026-11"));
// Retomada: amanhã (trava do dia) ou dia 1º do mês seguinte (grátis do mês), no dia do Pacífico.
ok(() => assert.equal(quandoContinua("dia", new Date("2026-10-18T15:00:00Z")), "2026-10-19"));
ok(() => assert.equal(quandoContinua("mes", new Date("2026-10-18T15:00:00Z")), "2026-11-01"));
ok(() => assert.equal(quandoContinua("dia", new Date("2026-10-31T20:00:00Z")), "2026-11-01"));
ok(() => assert.equal(quandoContinua("mes", new Date("2026-12-20T15:00:00Z")), "2027-01-01"));
ok(() => assert.equal(diasDaVarredura(386), 4));
ok(() => assert.equal(diasDaVarredura(3403), 30));
ok(() => assert.equal(faltamEstimadas({ estado: "pausada", chamadas: 100, estimativa: 386, pendentes: 30 }), 286));
ok(() => assert.equal(faltamEstimadas({ estado: "pausada", chamadas: 500, estimativa: 386, pendentes: 30 }), 30));
ok(() => assert.equal(faltamEstimadas({ estado: "completa", chamadas: 500, estimativa: 386, pendentes: 0 }), 0));
ok(() => assert.equal(percentualDaVarredura(115, 271, false), 29));
ok(() => assert.equal(percentualDaVarredura(386, 0, false), 99));
ok(() => assert.equal(percentualDaVarredura(386, 0, true), 100));

// ─── termos do Google: o que vai para o banco ───
ok(() => {
  const g = paraGuardar({ id: "ChIJxyz12345", nome: "Pizzaria Bella", endereco: "Rua 1", lat: -22.5, lng: -41.9, tipo: "pizza_restaurant", mapsUrl: "https://maps.google.com/?cid=1", origem: "google", lojaId: "loja1" });
  assert.deepEqual(g, { id: "ChIJxyz12345", nome: "", endereco: "", lat: -22.5, lng: -41.9, tipo: null, mapsUrl: null, origem: "google", lojaId: "loja1" });
});
ok(() => assert.equal(paraGuardar(osm[0]).nome, "Pizzaria Bella Napoli")); // OSM (ODbL) pode

// ─── os nomes sob demanda: Nearby por distância em volta dos pinos ───
ok(() => assert.deepEqual(planoDeNomes([{ id: "a", lat: -22.5, lng: -41.9 }], [], 1), [{ centro: { lat: -22.5, lng: -41.9 }, raio: 30, cobre: ["a"] }]));
ok(() => assert.equal(planoDeNomes([], [], 3).length, 0));
ok(() => {
  // 45 pinos em 3 grupos: 3 buscas; e o máximo é respeitado.
  const grupo = (lat: number, n: number, p: string) => Array.from({ length: n }, (_, i) => ({ id: `${p}${i}`, lat: lat + i * 0.0001, lng: -41.9 }));
  const alvos = [...grupo(-22.50, 15, "a"), ...grupo(-22.52, 15, "b"), ...grupo(-22.54, 15, "c")];
  assert.ok(planoDeNomes(alvos, alvos, 10).length <= 3);
  assert.equal(planoDeNomes(alvos, alvos, 1).length, 1);
  assert.ok(planoDeNomes(alvos, alvos, 10).every((x) => x.raio >= 30 && x.raio <= 2000));
});

// ─── o selo ───
type Selo = Parameters<typeof seloDaCobertura>[0];
const base: Selo = { estado: "completa", motivo: null, detalhe: null, saturadas: [], pendentes: 0, chamadas: 300, faltamEstimadas: 0, percentual: 100, continuaEm: null };
const hoje = new Date("2026-10-18T15:00:00Z");
ok(() => assert.deepEqual(seloDaCobertura(base, hoje), { tipo: "completa", texto: "Cobertura completa" }));
ok(() => assert.match(seloDaCobertura({ ...base, saturadas: [{ lat: 1, lng: 1 }] }, hoje).texto, /^Quase completa: 1 ponto tem mais de 20/));
ok(() => assert.equal(seloDaCobertura({ ...base, saturadas: [{ lat: 1, lng: 1 }] }, hoje).tipo, "parcial"));
ok(() => assert.equal(seloDaCobertura({ ...base, estado: "pausada", motivo: "gratis_do_mes", percentual: 62, continuaEm: "2026-11-01" }, hoje).texto,
  "Varrida 62% · continua em 01/11 (o grátis do mês do Google acabou; sem custo). O que já veio está no mapa"));
ok(() => assert.match(seloDaCobertura({ ...base, estado: "pausada", motivo: "trava_do_dia", percentual: 29, continuaEm: "2026-10-19" }, hoje).texto, /^Varrida 29% · continua amanhã \(a busca grátis de hoje acabou; sem custo\)/));
ok(() => assert.match(seloDaCobertura({ ...base, estado: "pausada", motivo: "google", detalhe: "RESOURCE_EXHAUSTED", percentual: 10 }, hoje).texto, /Google parou.*RESOURCE_EXHAUSTED.*amanhã/));
ok(() => assert.match(seloDaCobertura({ ...base, estado: "pausada", motivo: "interrompida", percentual: 40 }, hoje).texto, /parou no meio/));
ok(() => assert.equal(seloDaCobertura({ ...base, estado: "nova" }, hoje).tipo, "nenhuma"));
// Nenhum texto fala em pagar: custo zero, sem exceção.
for (const m of ["gratis_do_mes", "trava_do_dia", "google", "interrompida", "teto_da_cidade"] as const) {
  ok(() => assert.doesNotMatch(seloDaCobertura({ ...base, estado: "pausada", motivo: m, percentual: 50, continuaEm: "2026-11-01" }, hoje).texto, /US\$|pag|autoriz/i));
}

// ─── A VARREDURA INTEIRA contra a cidade falsa (o mesmo laço do servidor + navegador) ───
/** Roda a varredura dia a dia, com o limite do dia e o teto do mês, como o servidor. */
function varrerCidade(cidade: LugarFalso[], caixa: typeof RIO, o: { porDia?: number; noMes?: number } = {}) {
  const porDia = o.porDia ?? Infinity;
  const noMes = o.noMes ?? Infinity;
  let pendentes = celulasRaiz(caixa);
  const achados = new Map<string, LugarFalso>();
  let chamadas = 0;
  let dias = 1;
  let hojeFeitas = 0;
  const saturadas: Celula[] = [];
  let cheias = 0;
  for (let voltas = 0; voltas < 100_000; voltas++) {
    const vaga = Math.min(porDia - hojeFeitas, noMes - chamadas);
    if (pendentes.length && vaga <= 0) {
      if (noMes - chamadas <= 0) break; // grátis do mês acabou: pausa (no dia 1º continua)
      dias++; hojeFeitas = 0; continue; // trava do dia: continua amanhã
    }
    const { lote, pendentes: resto } = escolherLote(pendentes, vaga);
    if (!lote.length) { pendentes = resto; break; }
    chamadas += lote.length;
    hojeFeitas += lote.length;
    const respostas = lote.map((c) => {
      const { centro, raio } = circuloDaCelula(c);
      const veio = nearbyFalso(cidade, { centro, raio, tipos: c.tipos || [...TIPOS_DE_COMIDA], maximo: MAXIMO_POR_CHAMADA });
      for (const l of veio) if (!l.fechado) achados.set(l.id, l);
      if (veio.length >= MAXIMO_POR_CHAMADA) cheias++;
      return { celulaId: c.id, bruto: veio.length };
    });
    const r = aplicarRespostas(resto, lote, respostas);
    pendentes = r.pendentes;
    saturadas.push(...r.saturadas);
  }
  return { achados, chamadas, saturadas, cheias, pendentes, dias };
}

// A cidade falsa: 600 lugares no centro de Rio das Ostras, 30 deles na mesma praça de alimentação.
const centroDoRio = { lat: -22.5175, lng: -41.9455 };
const falsa = cidadeFalsa({ centro: centroDoRio, total: 600 });
const abertos = falsa.filter((l) => !l.fechado && l.lat >= RIO.sul && l.lat <= RIO.norte && l.lng >= RIO.oeste && l.lng <= RIO.leste);
const v = varrerCidade(falsa, RIO);
ok(() => assert.equal(v.achados.size, abertos.length, `achou ${v.achados.size} de ${abertos.length}`));
ok(() => assert.equal(v.saturadas.length, 0));
ok(() => assert.ok(v.cheias > 20, "a grade tem que ter se dividido"));
// A busca de 4 termos de antes (máx. 20 cada) trazia no máximo 80.
ok(() => assert.ok(v.achados.size > 80 * 6));
// Chamadas por lugar ficam na faixa que a estimativa usa (0,25 a 0,45).
ok(() => assert.ok(v.chamadas / abertos.length > 0.15 && v.chamadas / abertos.length < 0.6, `${v.chamadas} chamadas`));

// Na velocidade do dia (115): a mesma cidade, inteira, em 2 dias — nunca passa de 115 num dia.
const devagar = varrerCidade(falsa, RIO, { porDia: VARREDURA_POR_DIA, noMes: tetoDoMes("nearby") });
ok(() => assert.equal(devagar.achados.size, abertos.length));
ok(() => assert.equal(devagar.dias, Math.ceil(v.chamadas / VARREDURA_POR_DIA)));
ok(() => assert.equal(devagar.chamadas, v.chamadas));

// Grátis do mês no fim: para no teto, a fila fica guardada e o resto do mês seguinte termina a cidade.
const mes1 = varrerCidade(falsa, RIO, { porDia: VARREDURA_POR_DIA, noMes: 50 });
ok(() => assert.equal(mes1.chamadas, 50));
ok(() => assert.ok(mes1.pendentes.length > 0));
ok(() => {
  // Mês seguinte: continua da fila guardada (aplicarRespostas/escolherLote só olham a fila).
  let pendentes = mes1.pendentes;
  const achados = new Map(mes1.achados);
  let chamadas = 0;
  while (pendentes.length) {
    const { lote, pendentes: resto } = escolherLote(pendentes, Infinity);
    chamadas += lote.length;
    const resp = lote.map((c) => {
      const { centro, raio } = circuloDaCelula(c);
      const veio = nearbyFalso(falsa, { centro, raio, tipos: c.tipos || [...TIPOS_DE_COMIDA], maximo: MAXIMO_POR_CHAMADA });
      for (const l of veio) if (!l.fechado) achados.set(l.id, l);
      return { celulaId: c.id, bruto: veio.length };
    });
    pendentes = aplicarRespostas(resto, lote, resp).pendentes;
  }
  assert.equal(achados.size, abertos.length);
  assert.equal(50 + chamadas, v.chamadas);
});

// Praça com 25 do MESMO tipo no mesmo ponto: não dá para separar → saturada, e o selo explica.
const lotada = [
  ...cidadeFalsa({ centro: centroDoRio, total: 100, semente: 7, pracaDeAlimentacao: 0 }),
  ...Array.from({ length: 25 }, (_, i) => ({ id: `ChIJlotada${String(i).padStart(3, "0")}`, nome: `Box ${i}`, endereco: "", lat: -22.5, lng: -41.95, tipos: ["restaurant"], popularidade: i / 25 })),
];
const vl = varrerCidade(lotada, RIO);
ok(() => assert.ok(vl.saturadas.length >= 1));
ok(() => assert.ok(vl.achados.size >= lotada.length - 5 - 2, "fora os 5 que não cabem, acha o resto"));

// ─── os nomes de uma página da lista (20 mais perto do centro): poucas buscas, dentro do teto ───
ok(() => {
  const pagina = abertos.map((l) => ({ l, m: metrosEntre(centroDoRio, l) })).sort((a, b) => a.m - b.m).slice(20, 40).map((x) => x.l);
  const nomes = new Set<string>();
  let buscas = 0;
  for (const passo of planoDeNomes(pagina, abertos, 4)) {
    buscas++;
    for (const l of nearbyFalso(falsa, { centro: passo.centro, raio: passo.raio, tipos: [...TIPOS_DE_COMIDA], maximo: 20, porDistancia: true })) nomes.add(l.id);
  }
  assert.ok(buscas <= 4);
  const comNome = pagina.filter((l) => nomes.has(l.id)).length;
  assert.ok(comNome >= 15, `só ${comNome} de 20 com nome em ${buscas} buscas`);
  // A 1ª página (os 20 mais perto do centro) sai numa busca só.
  const primeira = abertos.map((l) => ({ l, m: metrosEntre(centroDoRio, l) })).sort((a, b) => a.m - b.m).slice(0, 20).map((x) => x.l);
  assert.ok(planoDeNomes(primeira, abertos, 4).length <= 2);
});
// O pino tocado sai na 1ª busca por distância (raio 30 m), fora da praça lotada.
ok(() => {
  const alvo = abertos[200];
  const veio = nearbyFalso(falsa, { centro: alvo, raio: planoDeNomes([alvo], abertos, 1)[0].raio, tipos: [...TIPOS_DE_COMIDA], maximo: 20, porDistancia: true });
  assert.ok(veio.some((l) => l.id === alvo.id));
});

console.log(`✅ teste-varredura: ${casos} casos ok (cidade falsa: ${abertos.length} lugares, ${v.chamadas} buscas, ${v.cheias} células cheias, ${devagar.dias} dias a ${VARREDURA_POR_DIA}/dia)`);
