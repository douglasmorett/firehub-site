/**
 * O contorno de onde a loja entrega, por cima do raio (lib/limite-de-atendimento.ts).
 *
 *   npx tsx scripts/teste-limite-de-atendimento.ts
 *
 * O caso é o da R&D Pizzaria (Nova Iguaçu, 27/09/2026): faixas por km e um
 * contorno desenhado que para na Dutra. Dentro do contorno vale a faixa;
 * fora dele a loja não atende, por mais perto que seja. A área de risco
 * continua vencendo tudo, e no método "Desenhar no mapa" o contorno não vale.
 *
 * Roda SEM mapa: só pontos com coordenada (pino/GPS), que é o caminho que
 * não depende de rede. O ponto achado pelo texto passa pela mesma função
 * (foraDoLimiteDeAtendimento) no ramo KM de avaliarEntrega.
 */
import { avaliarEntrega, descreverVeredicto } from "../src/lib/area-de-entrega";
import { foraDoLimiteDeAtendimento, limitesDeAtendimento, temLimiteDeAtendimento } from "../src/lib/limite-de-atendimento";

let ok = 0, falhou = 0;
function conferir(nome: string, obtido: unknown, esperado: unknown) {
  if (JSON.stringify(obtido) === JSON.stringify(esperado)) { ok++; console.log(`  ok   ${nome}`); }
  else { falhou++; console.log(`  FALHOU ${nome}\n         esperado: ${JSON.stringify(esperado)}\n         obtido:   ${JSON.stringify(obtido)}`); }
}

// A loja e um contorno de ~2 km de lado só para o LESTE dela (a "Dutra" passa
// a oeste, em lng = LOJA.lng - 0.002).
const LOJA = { lat: -22.7584, lng: -43.4685 };
const quadrado = (lat: number, lng: number, d: number): [number, number][] => [
  [lat - d, lng - d], [lat - d, lng + d], [lat + d, lng + d], [lat + d, lng - d],
];
const CONTORNO = quadrado(LOJA.lat, LOJA.lng + 0.008, 0.01); // vai de lng -0.002 a +0.018
const DENTRO_PERTO = { lat: LOJA.lat, lng: LOJA.lng + 0.005 };      // ~0,5 km, dentro
const FORA_PERTO = { lat: LOJA.lat, lng: LOJA.lng - 0.006 };        // ~0,6 km, do outro lado da "Dutra"
const FORA_LONGE = { lat: LOJA.lat, lng: LOJA.lng + 0.06 };         // ~6 km, dentro de nada
const RISCO = quadrado(LOJA.lat + 0.004, LOJA.lng + 0.004, 0.001);  // dentro do contorno

const lojaKm = (deliveryConfig: any, tipo = "KM"): any => ({
  storeAddress: "Rua Carlos Gomes, Nova Iguaçu",
  storeLatLng: LOJA,
  city: "Nova Iguaçu",
  deliveryZoneType: tipo,
  deliveryZones: [{ km: 1, fee: 0, time: 30 }, { km: 3, fee: 0, time: 45 }],
  deliveryConfig,
});

async function main() {
  console.log("\n== Leitura do cadastro ==");
  conferir("lista limpa: só polígonos com 3+ pontos", limitesDeAtendimento({ limiteDeAtendimento: [
    { nome: "Dutra", pontos: CONTORNO },
    { nome: "Linha", pontos: [[0, 0], [1, 1]] },
    { nome: "Lixo", pontos: [["a", "b"], [null, 2], [3, 4]] },
  ] }).map((l) => l.nome), ["Dutra"]);
  conferir("aceita a lista direto (a tela manda só o array)", limitesDeAtendimento([{ nome: "X", pontos: CONTORNO }]).length, 1);
  conferir("{lat,lng} também", limitesDeAtendimento([{ nome: "X", pontos: CONTORNO.map(([lat, lng]) => ({ lat, lng })) }])[0].pontos.length, 4);
  conferir("sem cadastro: não tem limite", temLimiteDeAtendimento({ areasDeRisco: [] }), false);
  conferir("todos desligados: não tem limite", temLimiteDeAtendimento({ limiteDeAtendimento: [{ nome: "X", pontos: CONTORNO, ativa: false }] }), false);

  console.log("\n== foraDoLimiteDeAtendimento ==");
  const cfg = { limiteDeAtendimento: [{ nome: "Lado de cá da Dutra", pontos: CONTORNO }] };
  conferir("dentro: null", foraDoLimiteDeAtendimento(DENTRO_PERTO, cfg), null);
  conferir("fora: o nome do contorno", foraDoLimiteDeAtendimento(FORA_PERTO, cfg), "Lado de cá da Dutra");
  conferir("sem ponto: null (não se recusa ninguém)", foraDoLimiteDeAtendimento(null, cfg), null);
  conferir("sem contorno: null", foraDoLimiteDeAtendimento(FORA_PERTO, {}), null);
  conferir("contorno desligado: null", foraDoLimiteDeAtendimento(FORA_PERTO, { limiteDeAtendimento: [{ nome: "X", pontos: CONTORNO, ativa: false }] }), null);
  conferir("dois contornos = união: dentro do segundo é dentro", foraDoLimiteDeAtendimento(FORA_PERTO, { limiteDeAtendimento: [
    { nome: "Leste", pontos: CONTORNO },
    { nome: "Oeste", pontos: quadrado(LOJA.lat, LOJA.lng - 0.006, 0.002) },
  ] }), null);

  console.log("\n== avaliarEntrega, modo KM, com o pino do cliente ==");
  const pino = (coords: { lat: number; lng: number }) => ({ endereco: "qualquer", coords, origemDasCoords: "pino" as const });

  const semContorno = await avaliarEntrega(lojaKm({}), pino(FORA_PERTO), { prazoMs: 1 });
  conferir("sem contorno, 0,6 km do outro lado: ATENDE (como hoje)", semContorno.resultado, "ATENDE");

  const dentro = await avaliarEntrega(lojaKm(cfg), pino(DENTRO_PERTO), { prazoMs: 1 });
  conferir("dentro do contorno, 0,5 km: ATENDE pela faixa de 1 km", [dentro.resultado, dentro.faixaKm, dentro.taxa], ["ATENDE", 1, 0]);

  const fora = await avaliarEntrega(lojaKm(cfg), pino(FORA_PERTO), { prazoMs: 1 });
  conferir("fora do contorno, 0,6 km: FORA, com o nome do contorno", [fora.resultado, fora.foraDoLimite], ["FORA", "Lado de cá da Dutra"]);
  conferir("o veredicto descrito diz o contorno, não o raio", descreverVeredicto(fora), "fora do contorno de atendimento da loja (Lado de cá da Dutra)");
  conferir("o ponto do cliente vai no veredicto (o checkout abre o mapa nele)", fora.ponto && [fora.ponto.lat, fora.ponto.lng, fora.ponto.origem], [FORA_PERTO.lat, FORA_PERTO.lng, "pino"]);

  const foraLonge = await avaliarEntrega(lojaKm(cfg), pino(FORA_LONGE), { prazoMs: 1 });
  conferir("fora do contorno E do raio: FORA pelo contorno (checado antes)", [foraLonge.resultado, !!foraLonge.foraDoLimite], ["FORA", true]);

  const risco = await avaliarEntrega(lojaKm({ ...cfg, areasDeRisco: [{ nome: "Beco", pontos: RISCO }] }), pino({ lat: LOJA.lat + 0.004, lng: LOJA.lng + 0.004 }), { prazoMs: 1 });
  conferir("área de risco dentro do contorno: FORA pela área de risco (ela vence)", [risco.resultado, risco.areaDeRisco, risco.foraDoLimite], ["FORA", "Beco", undefined]);

  const desligado = await avaliarEntrega(lojaKm({ limiteDeAtendimento: [{ nome: "X", pontos: CONTORNO, ativa: false }] }), pino(FORA_PERTO), { prazoMs: 1 });
  conferir("contorno desligado: ATENDE (não limita)", desligado.resultado, "ATENDE");

  console.log("\n== Rota e bairro também obedecem; desenho não ==");
  const rota = await avaliarEntrega(lojaKm(cfg, "ROTA"), pino(FORA_PERTO), { prazoMs: 1 });
  conferir("ROTA: fora do contorno é FORA", [rota.resultado, rota.foraDoLimite], ["FORA", "Lado de cá da Dutra"]);

  const lojaBairro: any = { ...lojaKm(cfg, "NEIGHBORHOOD"), deliveryZones: [{ name: "Centro", fee: 5, time: 30 }] };
  const bairroFora = await avaliarEntrega(lojaBairro, { endereco: "Rua X, Centro", bairro: "Centro", coords: FORA_PERTO, origemDasCoords: "pino" }, { prazoMs: 1 });
  conferir("BAIRRO cadastrado, mas pino fora do contorno: FORA", [bairroFora.resultado, bairroFora.foraDoLimite], ["FORA", "Lado de cá da Dutra"]);
  const bairroDentro = await avaliarEntrega(lojaBairro, { endereco: "Rua X, Centro", bairro: "Centro", coords: DENTRO_PERTO, origemDasCoords: "pino" }, { prazoMs: 1 });
  conferir("BAIRRO cadastrado, pino dentro: ATENDE pelo bairro", [bairroDentro.resultado, bairroDentro.bairro, bairroDentro.taxa], ["ATENDE", "Centro", 5]);

  const lojaDesenho: any = { ...lojaKm(cfg, "POLIGONO"), deliveryZones: [{ nome: "Tudo", pontos: quadrado(LOJA.lat, LOJA.lng, 0.03), fee: 7, time: 40 }] };
  const desenho = await avaliarEntrega(lojaDesenho, pino(FORA_PERTO), { prazoMs: 1 });
  conferir("POLIGONO: o contorno não vale — a área desenhada decide (ATENDE)", [desenho.resultado, desenho.taxa, desenho.foraDoLimite], ["ATENDE", 7, undefined]);

  console.log(`\n${falhou === 0 ? "✅" : "❌"} ${ok} ok, ${falhou} falhou`);
  process.exit(falhou === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
