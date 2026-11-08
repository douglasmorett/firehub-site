/**
 * O bairro pelo ponto do cliente vem do IBGE, e o bairro digitado não é trocado.
 *
 * Caso real: Divinos Burguer (Cabo Frio), pedido 29 de 07/11/2026 — saiu
 * "Rua Monte Alegre, 99 - Gamboa" com o GPS em (-22.85774, -42.03045). No
 * CNEFE 2022 (C:\Users\Micro\dados-ibge), os endereços a até 250 m desse ponto
 * são 849 do MONTE ALEGRE, 41 da BOCA DO MATO e 32 de PORTO DO CARRO — nenhum
 * da GAMBOA (o centro dela fica a ~2 km). O reverse do OSM chama a região de
 * "Gamboa" (suburb). Os pontos abaixo são do CNEFE; o teste não vai à rede.
 *
 *   DATABASE_URL="postgresql://banco-falso/teste" NEXTAUTH_SECRET=x npx tsx scripts/teste-bairro-do-ponto-pelo-ibge.ts
 */
import { bairroDoEnderecoMaisPerto } from "../src/lib/enderecos-ibge";
import { bairroDoPontoNaTela } from "../src/lib/entrega-no-checkout";
import { bairroDoPonto, decidirBairroDoPedido, type BuscasDoBairro } from "../src/lib/bairro-pela-coordenada";

let falhas = 0;
function conferir(nome: string, ok: boolean, detalhe?: unknown) {
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHOU"} ${nome}${!ok && detalhe !== undefined ? ` — ${JSON.stringify(detalhe)}` : ""}`);
}

const GPS_29 = { lat: -22.85774425451876, lng: -42.03045282136035 };
const TRECHOS = [
  // Travessa Ernesto Cardoso da Fonseca 97/101 — a ~5–20 m do GPS.
  { bairro: "MONTE ALEGRE", lats: [-22.857674, -22.857634], lngs: [-42.030633, -42.030239] },
  // Rua Monte Alegre nº 88/90 — ~150 m.
  { bairro: "MONTE ALEGRE", lats: [-22.857379, -22.857356], lngs: [-42.029067, -42.029016] },
  // Rua Maria José da Silva 45 — o endereço da Boca do Mato mais perto (~200 m).
  { bairro: "BOCA DO MATO", lats: [-22.859534], lngs: [-42.029893] },
  // Rua Jorge Veiga 5/340 — Gamboa, ~2,4 km.
  { bairro: "GAMBOA", lats: [-22.876514, -22.875497], lngs: [-42.020178, -42.019316] },
];

(async () => {
  console.log("Endereço do IBGE mais perto do ponto");
  const achado = bairroDoEnderecoMaisPerto(GPS_29, TRECHOS);
  conferir("pedido 29: Monte Alegre, não Gamboa", achado?.bairro === "MONTE ALEGRE" && achado.km < 0.05, achado);
  const perto = bairroDoEnderecoMaisPerto({ lat: -22.8595, lng: -42.0299 }, TRECHOS);
  conferir("ponto na Boca do Mato → Boca do Mato", perto?.bairro === "BOCA DO MATO", perto);
  const longe = bairroDoEnderecoMaisPerto({ lat: -22.865, lng: -42.025 }, TRECHOS);
  conferir("nenhum endereço a 200 m → null (segue o mapa)", longe === null, longe);
  conferir("sem trechos → null", bairroDoEnderecoMaisPerto(GPS_29, []) === null);

  console.log("Checkout: o bairro que o GPS escreve na tela");
  conferir("bairro digitado fica (mapa diz Gamboa)", bairroDoPontoNaTela("Monte Alegre", null, "Gamboa") === null);
  conferir("bairro digitado fica (nem o IBGE troca)", bairroDoPontoNaTela("Boca do Mato", "Monte Alegre", "Gamboa") === null);
  conferir("campo vazio: IBGE vence o mapa", bairroDoPontoNaTela("", "Monte Alegre", "Gamboa") === "Monte Alegre");
  conferir("campo só com espaço conta como vazio", bairroDoPontoNaTela("   ", "Monte Alegre", "Gamboa") === "Monte Alegre");
  conferir("sem IBGE: o nome do mapa, como antes", bairroDoPontoNaTela("", null, "Gamboa") === "Gamboa");
  conferir("nada → null", bairroDoPontoNaTela("", null, "") === null);

  console.log("Servidor: bairro pelo ponto (robô, rascunho)");
  const REVERSO = {
    road: "Rua Monte Alegre", suburb: "Gamboa", city: "Cabo Frio", state: "Rio de Janeiro", "ISO3166-2-lvl4": "BR-RJ", country: "Brasil",
  };
  const loja = { city: "Cabo Frio", deliveryZones: [{ km: 1, fee: 5 }], deliveryZoneType: "KM" };
  const comIbge: BuscasDoBairro = { reverso: async () => REVERSO, correios: async () => null, ibge: async () => "Monte Alegre" };
  const r1 = await bairroDoPonto(GPS_29, loja, comIbge);
  conferir("IBGE antes do mapa", r1?.bairro === "Monte Alegre" && r1.fonte === "ibge", r1);
  const r2 = await bairroDoPonto(GPS_29, loja, { ...comIbge, correios: async () => "Gamboa" });
  conferir("IBGE antes dos Correios", r2?.bairro === "Monte Alegre" && r2.fonte === "ibge", r2);
  const r3 = await bairroDoPonto(GPS_29, loja, { ...comIbge, ibge: async () => null });
  conferir("sem IBGE: o mapa, como antes", r3?.bairro === "Gamboa" && r3.fonte === "mapa", r3);
  const r4 = await bairroDoPonto(GPS_29, loja, { ...comIbge, ibge: async () => { throw new Error("banco fora"); } });
  conferir("IBGE com erro: o mapa, como antes", r4?.bairro === "Gamboa" && r4.fonte === "mapa", r4);

  const pedido = { customerAddress: "Rua Monte Alegre, 99", customerLatLng: { ...GPS_29, origem: "gps" }, deliveryType: "DELIVERY", source: "WHATSAPP_IA" };
  const d1 = await decidirBairroDoPedido(pedido, loja, comIbge);
  conferir("pedido sem bairro ganha '- Monte Alegre'", d1.mudar && d1.endereco === "Rua Monte Alegre, 99 - Monte Alegre", d1);
  const d2 = await decidirBairroDoPedido({ ...pedido, customerAddress: "Rua Monte Alegre, 99 - Monte Alegre" }, loja, comIbge);
  conferir("pedido com bairro não é tocado", !d2.mudar && d2.motivo === "ja-tem-bairro", d2);

  console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo ok");
  process.exit(falhas ? 1 : 0);
})();
