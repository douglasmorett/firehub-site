/**
 * scripts/teste-area-desenhada.ts
 *
 * A modalidade "desenhe no mapa onde você entrega".
 *
 * Trava o que a loja comprou: dentro do contorno atende pela taxa daquele
 * contorno, fora não atende, e SEM PONTO NO MAPA a resposta é "não sei" —
 * nunca "atende". Foi esse último caso que deixou entrar um pedido de 10,8 km
 * numa loja de raio 4 km (R&D Pizzaria, 19/09/2026): endereço que o mapa não
 * acha virava pedido aceito com frete zero.
 *
 *   npx tsx scripts/teste-area-desenhada.ts
 */
import { avaliarEntrega, modoDaArea, areasDesenhadas } from "../src/lib/area-de-entrega";

let ok = 0, falhou = 0;
function conferir(nome: string, obtido: unknown, esperado: unknown) {
  if (JSON.stringify(obtido) === JSON.stringify(esperado)) { ok++; console.log(`  ok   ${nome}`); }
  else { falhou++; console.log(`  FALHOU ${nome}\n         esperado: ${JSON.stringify(esperado)}\n         obtido:   ${JSON.stringify(obtido)}`); }
}

// Um quadrado de ~2 km de lado em volta da loja, e outro colado a leste.
const LOJA = { lat: -22.7584, lng: -43.4685 };
const quadrado = (lat: number, lng: number, d: number): [number, number][] => [
  [lat - d, lng - d], [lat - d, lng + d], [lat + d, lng + d], [lat + d, lng - d],
];
const loja: any = {
  storeAddress: "Rua Carlos Gomes, Nova Iguaçu",
  storeLatLng: LOJA,
  city: "Nova Iguaçu",
  deliveryZoneType: "POLIGONO",
  deliveryZones: [
    { nome: "Perto", pontos: quadrado(LOJA.lat, LOJA.lng, 0.01), fee: 5, time: 30 },
    { nome: "Longe", pontos: quadrado(LOJA.lat, LOJA.lng + 0.015, 0.02), fee: 12, time: 60 },
  ],
  deliveryConfig: {},
};

async function main() {
  console.log("\n== O cadastro é lido como área desenhada ==");
  conferir("modo", modoDaArea(loja), "POLIGONO");
  conferir("duas áreas válidas", areasDesenhadas(loja).length, 2);
  conferir("contorno com 2 pontos não é área", areasDesenhadas({ deliveryZones: [{ nome: "x", pontos: [[1, 2], [3, 4]] }] } as any).length, 0);

  console.log("\n== Dentro, fora, e a sobreposição ==");
  const dentroPerto = await avaliarEntrega(loja, { endereco: "casa do cliente", coords: { lat: LOJA.lat + 0.005, lng: LOJA.lng + 0.005 } });
  conferir("dentro da área Perto → ATENDE", [dentroPerto.resultado, dentroPerto.taxa, dentroPerto.tempoMin], ["ATENDE", 5, 30]);
  conferir("o nome da área vai junto", dentroPerto.bairro, "Perto");

  const dentroLonge = await avaliarEntrega(loja, { endereco: "casa do cliente", coords: { lat: LOJA.lat, lng: LOJA.lng + 0.03 } });
  conferir("dentro da área Longe → taxa da Longe", [dentroLonge.resultado, dentroLonge.taxa], ["ATENDE", 12]);

  // O ponto cai nas duas: a de menor taxa ganha, porque a sobreposição é
  // descuido de cadastro e não pode custar caro ao cliente.
  // lng +0.005 cai nas DUAS: dentro de Perto (até +0,01) e de Longe (de -0,005 a +0,035).
  const sobreposto = await avaliarEntrega(loja, { endereco: "casa do cliente", coords: { lat: LOJA.lat, lng: LOJA.lng + 0.005 } });
  conferir("sobreposição cobra a MENOR taxa", [sobreposto.resultado, sobreposto.taxa], ["ATENDE", 5]);

  const fora = await avaliarEntrega(loja, { endereco: "casa do cliente", coords: { lat: LOJA.lat + 0.2, lng: LOJA.lng } });
  conferir("fora de todos os contornos → FORA", fora.resultado, "FORA");

  console.log("\n== A área de risco continua vencendo tudo ==");
  const comRisco = { ...loja, deliveryConfig: { areasDeRisco: [{ nome: "Beco", ativa: true, pontos: quadrado(LOJA.lat, LOJA.lng, 0.002) }] } };
  const noRisco = await avaliarEntrega(comRisco, { endereco: "casa do cliente", coords: { lat: LOJA.lat, lng: LOJA.lng } });
  conferir("dentro da entrega MAS dentro do risco → FORA", noRisco.resultado, "FORA");
  conferir("e diz qual área recusou", noRisco.areaDeRisco, "Beco");

  console.log("\n== Sem ponto no mapa, a resposta é 'não sei' ==");
  const semPonto = await avaliarEntrega(loja, { endereco: "Estrada Ananias, 570 - Boa Vista", coords: null });
  conferir("endereço que o mapa não acha → DESCONHECIDO", semPonto.resultado, "DESCONHECIDO");
  conferir("e nunca ATENDE por omissão", semPonto.taxa, null);
  const semNada = await avaliarEntrega(loja, { endereco: "", coords: null });
  conferir("endereço vazio → DESCONHECIDO", semNada.resultado, "DESCONHECIDO");

  console.log(`\n${ok} ok, ${falhou} falharam`);
  process.exit(falhou > 0 ? 1 : 0);
}
main();
