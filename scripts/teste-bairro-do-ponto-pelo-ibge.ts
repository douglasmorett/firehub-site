/**
 * Na cidade com a base do IBGE, o texto do ponto (rua, número, bairro) vem só
 * do IBGE — nunca do OSM —, e o bairro digitado não é trocado.
 *
 * Caso real: Divinos Burguer (Cabo Frio), pedido 29 de 07/11/2026 — saiu
 * "Rua Monte Alegre, 99 - Gamboa" com o GPS em (-22.85774, -42.03045). No
 * CNEFE 2022 (C:\Users\Micro\dados-ibge), os endereços a até 250 m desse ponto
 * são 849 do MONTE ALEGRE, 41 da BOCA DO MATO e 32 de PORTO DO CARRO — nenhum
 * da GAMBOA (o centro dela fica a ~2 km). O mais perto (5 m) é a Travessa
 * Ernesto Cardoso da Fonseca 97. O reverse do OSM chama a região de "Gamboa"
 * (suburb). Os pontos abaixo são do CNEFE; o teste não vai à rede.
 *
 *   DATABASE_URL="postgresql://banco-falso/teste" NEXTAUTH_SECRET=x npx tsx scripts/teste-bairro-do-ponto-pelo-ibge.ts
 */
import { bairroDoEnderecoMaisPerto, enderecoDoPontoNoIbge } from "../src/lib/enderecos-ibge";
import { enderecoDoPontoNaTela } from "../src/lib/entrega-no-checkout";
import { bairroDoPonto, decidirBairroDoPedido, type BuscasDoBairro } from "../src/lib/bairro-pela-coordenada";

let falhas = 0;
function conferir(nome: string, ok: boolean, detalhe?: unknown) {
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHOU"} ${nome}${!ok && detalhe !== undefined ? ` — ${JSON.stringify(detalhe)}` : ""}`);
}

const GPS_29 = { lat: -22.85774425451876, lng: -42.03045282136035 };
const TRECHOS = [
  // Travessa Ernesto Cardoso da Fonseca 97/101 — a ~5–20 m do GPS.
  { tipo: "travessa", nome: "ERNESTO CARDOSO DA FONSECA", chave: "ernesto cardoso fonseca", bairro: "MONTE ALEGRE", numeros: [97, 101], lats: [-22.8577, -22.857634], lngs: [-42.030462, -42.030239] },
  // Rua Monte Alegre nº 88/90 — ~150 m.
  { tipo: "rua", nome: "MONTE ALEGRE", chave: "monte alegre", bairro: "MONTE ALEGRE", numeros: [88, 90], lats: [-22.857379, -22.857356], lngs: [-42.029067, -42.029016] },
  // Rua Maria José da Silva 45 — o endereço da Boca do Mato mais perto (~200 m).
  { tipo: "rua", nome: "MARIA JOSE DA SILVA", chave: "maria jose silva", bairro: "BOCA DO MATO", numeros: [45], lats: [-22.859534], lngs: [-42.029893] },
  // "Rua Sem Saída" (nome genérico) num ponto inventado, longe dos outros.
  { tipo: "rua", nome: "SEM SAIDA", chave: "sem saida", bairro: "BOCA DO MATO", numeros: [0], lats: [-22.862], lngs: [-42.033] },
  // Rua Jorge Veiga 5/340 — Gamboa, ~2,4 km.
  { tipo: "rua", nome: "JORGE VEIGA", chave: "jorge veiga", bairro: "GAMBOA", numeros: [5, 340], lats: [-22.876514, -22.875497], lngs: [-42.020178, -42.019316] },
];
const MAPA_29 = { rua: "Rua Monte Alegre", numero: "", bairro: "Gamboa" };
const SEM_NADA = { municipioTemBase: true, rua: null, numero: null, bairro: null };

(async () => {
  console.log("Endereço do IBGE mais perto do ponto");
  const achado = bairroDoEnderecoMaisPerto(GPS_29, TRECHOS);
  conferir("pedido 29: Monte Alegre, não Gamboa", achado?.bairro === "MONTE ALEGRE" && achado.km < 0.05, achado);
  const e29 = enderecoDoPontoNoIbge(GPS_29, TRECHOS);
  conferir("pedido 29: rua do CNEFE em caixa de título, nº e bairro", e29.rua === "Travessa Ernesto Cardoso da Fonseca" && e29.numero === "97" && e29.bairro === "Monte Alegre", e29);
  const bocaDoMato = enderecoDoPontoNoIbge({ lat: -22.8592, lng: -42.0299 }, TRECHOS);
  conferir("a ~40 m da Maria José: rua e bairro, sem número", bocaDoMato.rua === "Rua Maria José da Silva" && bocaDoMato.numero === null && bocaDoMato.bairro === "Boca do Mato", bocaDoMato);
  const r150 = enderecoDoPontoNoIbge({ lat: -22.8584, lng: -42.029 }, TRECHOS);
  conferir("endereço a >70 m: bairro sim, rua não", r150.rua === null && r150.bairro === "Monte Alegre", r150);
  const generica = enderecoDoPontoNoIbge({ lat: -22.862, lng: -42.033 }, TRECHOS);
  conferir("'Rua Sem Saída' não vira rua; o bairro vale", generica.rua === null && generica.bairro === "Boca do Mato", generica);
  const longe = enderecoDoPontoNoIbge({ lat: -22.865, lng: -42.025 }, TRECHOS);
  conferir("nenhum endereço a 200 m → tudo null", longe.rua === null && longe.numero === null && longe.bairro === null, longe);
  const malha = enderecoDoPontoNoIbge(GPS_29, TRECHOS, "PORTO DO CARRO");
  conferir("o polígono da malha vence a localidade", malha.bairro === "Porto do Carro", malha);

  console.log("Checkout: o que o GPS escreve na tela");
  const vazio = { street: "", number: "", neighborhood: "" };
  const gps = { sobrescrever: true };
  const comBase = { municipioTemBase: true, ...e29 };
  const t1 = enderecoDoPontoNaTela(vazio, gps, comBase, MAPA_29);
  conferir("#29 com base: rua, nº e bairro do IBGE (nunca Gamboa)", t1.street === "Travessa Ernesto Cardoso da Fonseca" && t1.number === "97" && t1.neighborhood === "Monte Alegre", t1);
  const t2 = enderecoDoPontoNaTela({ street: "Rua Monte Alegre", number: "99", neighborhood: "Monte Alegre" }, gps, comBase, MAPA_29);
  conferir("bairro digitado nunca é trocado", t2.neighborhood === undefined, t2);
  const t3 = enderecoDoPontoNaTela({ ...vazio, neighborhood: "Boca do Mato" }, gps, comBase, MAPA_29);
  conferir("bairro digitado fica mesmo com o IBGE diferente", t3.neighborhood === undefined, t3);
  const t4 = enderecoDoPontoNaTela(vazio, gps, SEM_NADA, MAPA_29);
  conferir("com base e sem endereço perto: tudo vazio, nada do OSM", Object.keys(t4).length === 0, t4);
  const t5 = enderecoDoPontoNaTela({ street: "Rua Digitada", number: "10", neighborhood: "" }, gps, SEM_NADA, MAPA_29);
  conferir("com base e IBGE em erro/prazo: o digitado fica, nada do OSM", Object.keys(t5).length === 0, t5);
  const t6 = enderecoDoPontoNaTela(vazio, gps, { ...SEM_NADA, municipioTemBase: false }, MAPA_29);
  conferir("cidade sem base: o mapa, como antes", t6.street === "Rua Monte Alegre" && t6.neighborhood === "Gamboa", t6);
  const t7 = enderecoDoPontoNaTela(vazio, gps, null, MAPA_29);
  conferir("rota fora do ar (null): o mapa, como antes", t7.street === "Rua Monte Alegre" && t7.neighborhood === "Gamboa", t7);
  const t8 = enderecoDoPontoNaTela({ street: "Rua Digitada", number: "10", neighborhood: "" }, { sobrescrever: false }, comBase, MAPA_29);
  conferir("pino: só preenche o vazio", t8.street === undefined && t8.number === undefined && t8.neighborhood === "Monte Alegre", t8);
  conferir("campo só com espaço conta como vazio", enderecoDoPontoNaTela({ neighborhood: "  " }, gps, comBase, null).neighborhood === "Monte Alegre");
  conferir("sem nada → nada muda", Object.keys(enderecoDoPontoNaTela(vazio, gps, null, null)).length === 0);

  console.log("Servidor: bairro pelo ponto (robô, rascunho)");
  const REVERSO = {
    road: "Rua Monte Alegre", suburb: "Gamboa", city: "Cabo Frio", state: "Rio de Janeiro", "ISO3166-2-lvl4": "BR-RJ", country: "Brasil",
  };
  const loja = { city: "Cabo Frio", deliveryZones: [{ km: 1, fee: 5 }], deliveryZoneType: "KM" };
  let perguntasAoMapa = 0;
  const reverso = async () => { perguntasAoMapa++; return REVERSO; };
  const comIbge: BuscasDoBairro = { reverso, correios: async () => "Gamboa", ibge: async () => ({ municipioTemBase: true, bairro: "Monte Alegre" }) };
  const r1 = await bairroDoPonto(GPS_29, loja, comIbge);
  conferir("cidade com base: IBGE, sem perguntar ao mapa", r1?.bairro === "Monte Alegre" && r1.fonte === "ibge" && perguntasAoMapa === 0, { r1, perguntasAoMapa });
  const r2 = await bairroDoPonto(GPS_29, loja, { ...comIbge, ibge: async () => ({ municipioTemBase: true, bairro: null }) });
  conferir("cidade com base e IBGE sem resposta: sem bairro, nada do OSM", r2 === null && perguntasAoMapa === 0, r2);
  const r3 = await bairroDoPonto(GPS_29, loja, { ...comIbge, correios: async () => null, ibge: async () => ({ municipioTemBase: false, bairro: null }) });
  conferir("cidade sem base: o mapa, como antes", r3?.bairro === "Gamboa" && r3.fonte === "mapa", r3);
  const r4 = await bairroDoPonto(GPS_29, loja, { ...comIbge, correios: async () => null, ibge: async () => { throw new Error("banco fora"); } });
  conferir("IBGE quebrou antes de saber da base: como antes", r4?.bairro === "Gamboa" && r4.fonte === "mapa", r4);
  const lojaPorBairro = { city: "Cabo Frio", deliveryZones: [{ name: "Monte Alegre", fee: 5 }], deliveryZoneType: "NEIGHBORHOOD" };
  const r5 = await bairroDoPonto(GPS_29, lojaPorBairro, comIbge);
  conferir("loja por bairro: o nome cadastrado que casa com o IBGE", r5?.bairro === "Monte Alegre" && r5.fonte === "zona-da-loja", r5);

  const pedido = { customerAddress: "Rua Monte Alegre, 99", customerLatLng: { ...GPS_29, origem: "gps" }, deliveryType: "DELIVERY", source: "WHATSAPP_IA" };
  const d1 = await decidirBairroDoPedido(pedido, loja, comIbge);
  conferir("pedido sem bairro ganha '- Monte Alegre'", d1.mudar && d1.endereco === "Rua Monte Alegre, 99 - Monte Alegre", d1);
  const d2 = await decidirBairroDoPedido({ ...pedido, customerAddress: "Rua Monte Alegre, 99 - Monte Alegre" }, loja, comIbge);
  conferir("pedido com bairro não é tocado", !d2.mudar && d2.motivo === "ja-tem-bairro", d2);

  console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo ok");
  process.exit(falhas ? 1 : 0);
})();
