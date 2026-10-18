/**
 * Mapa de prospecção (lib/prospeccao/regras.ts): casar lugar do Google com loja
 * do FireHub, nome da cidade, dia da cota do Google e os links do cartão.
 * Roda sem banco: npx tsx scripts/teste-prospeccao.ts
 */
import assert from "node:assert/strict";
import {
  CAMPOS_DA_BUSCA, LIMITES_DO_DIA, diaDaCotaDoGoogle, dentroDaCaixa, linkComoChegar, linkDoWhatsapp,
  lojaDoLugar, nomeDaCidade, parecencaDosNomes, type LojaDoMapa,
  areaParaVarrer, dividirCelula, gradeDaArea, metrosEntre,
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
// Os limites ficam abaixo da trava do Google (160 buscas e 32 contatos por dia).
ok(() => assert.ok(LIMITES_DO_DIA.texto < 160 && LIMITES_DO_DIA.area < 160 && LIMITES_DO_DIA.contato < 32));

// ─── varredura por áreas ───
// Rio das Ostras urbano: ~25 km de litoral × ~6 km.
const rio = { sul: -22.56, norte: -22.50, oeste: -42.02, leste: -41.79 };
const grade = gradeDaArea(rio);
ok(() => assert.ok(grade.length > 1 && grade.length <= 30, `células: ${grade.length}`));
// As células cobrem a área inteira, sem buraco: a soma das áreas bate com a caixa.
const areaDe = (c: { sul: number; norte: number; oeste: number; leste: number }) => (c.norte - c.sul) * (c.leste - c.oeste);
ok(() => assert.ok(Math.abs(grade.reduce((s, c) => s + areaDe(c), 0) - areaDe(rio)) < 1e-9));
// O círculo de cada busca cobre a célula (meia diagonal) e respeita os 50 km do Google.
ok(() => assert.ok(grade.every((c) => c.raio >= metrosEntre(c.centro, { lat: c.norte, lng: c.leste }) - 1 && c.raio <= 50000)));
ok(() => assert.equal(new Set(grade.map((c) => c.id)).size, grade.length));
// Cidade pequena: célula de pelo menos 1,2 km — não gasta 30 buscas num bairro.
ok(() => assert.equal(gradeDaArea({ sul: -16.66, norte: -16.65, oeste: -49.50, leste: -49.49 }).length, 1));
// A célula cheia vira 4 do nível seguinte, cobrindo a mesma área.
const filhas = dividirCelula(grade[0]);
ok(() => assert.equal(filhas.length, 4));
ok(() => assert.ok(filhas.every((f) => f.nivel === 1 && f.raio < grade[0].raio)));
ok(() => assert.ok(Math.abs(filhas.reduce((s, c) => s + areaDe(c), 0) - areaDe(grade[0])) < 1e-12));
// A área a varrer é onde há restaurante (com folga), cortada pela caixa do município.
const municipio = { sul: -22.65, norte: -22.40, oeste: -42.10, leste: -41.75 };
const varrer = areaParaVarrer([{ lat: -22.52, lng: -41.95 }, { lat: -22.53, lng: -41.93 }, { lat: -22.51, lng: -41.94 }], municipio)!;
ok(() => assert.ok(varrer.sul > municipio.sul && varrer.norte < municipio.norte && varrer.oeste > municipio.oeste && varrer.leste < municipio.leste));
ok(() => assert.ok(varrer.sul < -22.53 && varrer.norte > -22.51 && varrer.oeste < -41.95 && varrer.leste > -41.93));
const naBorda = areaParaVarrer([{ lat: -22.645, lng: -41.80 }, { lat: -22.60, lng: -41.76 }], municipio)!;
ok(() => assert.ok(naBorda.sul >= municipio.sul && naBorda.leste <= municipio.leste));
// Poucos pontos: fica a caixa do município.
ok(() => assert.deepEqual(areaParaVarrer([{ lat: -22.52, lng: -41.95 }], municipio), municipio));

console.log(`✅ teste-prospeccao: ${casos} casos ok`);
