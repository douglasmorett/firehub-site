/**
 * Mapa de prospecção (lib/prospeccao/regras.ts): casar lugar do Google com loja
 * do FireHub, nome da cidade, dia da cota do Google e os links do cartão.
 * Roda sem banco: npx tsx scripts/teste-prospeccao.ts
 */
import assert from "node:assert/strict";
import {
  CAMPOS_DA_BUSCA, consultaDaCidade, diaDaCotaDoGoogle, dentroDaCaixa, linkComoChegar, linkDoWhatsapp,
  lojaDoLugar, nomeDaCidade, parecencaDosNomes, type LojaDoMapa,
} from "../src/lib/prospeccao/regras";

let casos = 0;
const ok = (f: () => void) => { f(); casos++; };

// ─── cidade ───
ok(() => assert.equal(nomeDaCidade("Trindade - GO"), "trindade"));
ok(() => assert.equal(nomeDaCidade("trindade/go"), "trindade"));
ok(() => assert.equal(nomeDaCidade("  Rio das Ostras  "), "rio das ostras"));
ok(() => assert.equal(nomeDaCidade("Goiânia, GO"), "goiania"));
ok(() => assert.equal(nomeDaCidade("Goiânia (GO)"), "goiania"));
ok(() => assert.equal(nomeDaCidade(null), ""));
// O Nominatim com "Trindade - GO" devolve ruas; com vírgula, a cidade.
ok(() => assert.equal(consultaDaCidade("Trindade - GO"), "Trindade, GO, Brasil"));
ok(() => assert.equal(consultaDaCidade("Goiânia (GO)"), "Goiânia, GO, Brasil"));
ok(() => assert.equal(consultaDaCidade("rio das ostras/rj"), "rio das ostras, rj, Brasil"));
ok(() => assert.equal(consultaDaCidade("Rio das Ostras"), "Rio das Ostras, Brasil"));

// ─── nomes ───
ok(() => assert.equal(parecencaDosNomes("Pizzaria Bella Napoli", "Bella Napoli Delivery"), 1));
ok(() => assert.equal(parecencaDosNomes("Pizzaria Central", "Lanchonete do Zé"), 0));
// Só palavra genérica não casa ninguém.
ok(() => assert.equal(parecencaDosNomes("Pizzaria", "Pizzaria Delivery"), 0));
ok(() => assert.equal(parecencaDosNomes("Frangoso", "Frangosos"), 0.8));

// ─── casar lugar com loja ───
const loja = (id: string, nome: string, lat: number | null, lng: number | null): LojaDoMapa =>
  ({ id, nome, lat, lng, endereco: null, slug: id, semCardapio: false, vendedor: null });
const lojas = [
  loja("a", "Frangoso Trindade", -16.6495, -49.4889),
  loja("b", "Pizzaria Bella Napoli", -16.6600, -49.4950),
  loja("c", "Açaí da Praça", null, null),
];
ok(() => assert.equal(lojaDoLugar({ nome: "Frangoso - Trindade", lat: -16.6497, lng: -49.4887 }, lojas)?.id, "a"));
// Nome igual, mas longe (outra unidade, 5 km): não é a nossa loja.
ok(() => assert.equal(lojaDoLugar({ nome: "Frangoso Trindade", lat: -16.69, lng: -49.49 }, lojas), null));
// Loja sem ponto: casa só com o nome inteiro.
ok(() => assert.equal(lojaDoLugar({ nome: "Açaí da Praça", lat: -16.65, lng: -49.49 }, lojas)?.id, "c"));
ok(() => assert.equal(lojaDoLugar({ nome: "Praça do Açaí Gourmet", lat: -16.65, lng: -49.49 }, lojas)?.id, "c"));
ok(() => assert.equal(lojaDoLugar({ nome: "Restaurante Sabor Caseiro", lat: -16.6496, lng: -49.4888 }, lojas), null));

// ─── caixa ───
const caixa = { sul: -16.75, norte: -16.55, oeste: -49.6, leste: -49.4 };
ok(() => assert.equal(dentroDaCaixa({ lat: -16.65, lng: -49.49 }, caixa), true));
ok(() => assert.equal(dentroDaCaixa({ lat: -16.68, lng: -49.25 }, caixa), false));

// ─── dia da cota do Google (meia-noite do Pacífico) ───
// 18/10 às 06:59Z ainda é 17/10 no Pacífico (PDT, UTC-7); às 07:00Z vira 18/10.
ok(() => assert.equal(diaDaCotaDoGoogle(new Date("2026-10-18T06:59:00Z")), "2026-10-17"));
ok(() => assert.equal(diaDaCotaDoGoogle(new Date("2026-10-18T07:00:00Z")), "2026-10-18"));
// Em dezembro (PST, UTC-8).
ok(() => assert.equal(diaDaCotaDoGoogle(new Date("2026-12-10T07:30:00Z")), "2026-12-09"));

// ─── links ───
ok(() => assert.equal(linkDoWhatsapp("(62) 99999-0000"), "https://wa.me/5562999990000"));
ok(() => assert.equal(linkDoWhatsapp("(62) 3333-0000"), "https://wa.me/556233330000"));
ok(() => assert.equal(linkDoWhatsapp("0800"), null));
ok(() => assert.equal(linkDoWhatsapp(null), null));
ok(() => assert.match(linkComoChegar({ nome: "X", lat: -16.65, lng: -49.49, placeId: "ChIJabc" }), /destination=-16\.65%2C-49\.49.*destination_place_id=ChIJabc/));

// ─── a busca não pede campo Enterprise (telefone/site/nota): a cota grátis da busca é a Pro ───
for (const caro of ["nationalPhoneNumber", "internationalPhoneNumber", "websiteURI", "rating", "userRatingCount", "regularOpeningHours", "photos", "reviews"]) {
  ok(() => assert.ok(!(CAMPOS_DA_BUSCA as readonly string[]).includes(caro), caro));
}
// A busca não pede campo Enterprise nem os de nível Pro mais raros: id, nome, ponto, endereço, tipo, status, link.
ok(() => assert.deepEqual([...CAMPOS_DA_BUSCA], ["id", "displayName", "formattedAddress", "location", "primaryType", "businessStatus", "googleMapsURI"]));

console.log(`✅ teste-prospeccao: ${casos} casos ok`);
