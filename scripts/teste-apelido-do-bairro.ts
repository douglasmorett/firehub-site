/**
 * O apelido do bairro (`aliases` na zona) vale como o nome na decisão de
 * entrega (lib/area-de-entrega.ts, bairroCadastrado) — robô, site e gravação.
 *
 *   npx tsx scripts/teste-apelido-do-bairro.ts
 *
 * Caso da Charlie Brown Pizzas (Poços de Caldas, 07 a 12/11/2026): o cliente
 * diz o condomínio ou o loteamento ("Ville de France", "Royal Park"), e o robô
 * respondia "não entregamos" num bairro que a loja atende.
 */
import assert from "node:assert/strict";
import { bairroCadastrado, bairrosAtendidos } from "../src/lib/area-de-entrega";

let ok = 0;
const caso = (nome: string, f: () => void) => {
  f();
  ok++;
  console.log(`  ✓ ${nome}`);
};

const loja = {
  deliveryZoneType: "NEIGHBORHOOD",
  deliveryZones: [
    { name: "Country Club", fee: 4, time: 40, aliases: ["Ville de France", "Jardim Country Club"] },
    { name: "Residencial Veredas", fee: 4, time: 40, aliases: "Royal Park, Royal Parque" },
    { name: "Vila Togni", fee: 3, time: 40 },
  ],
} as any;

caso("o nome continua casando", () => {
  assert.equal(bairroCadastrado("Rua Timbiras 19, Vila Togni", loja)?.name, "Vila Togni");
});
caso("apelido por extenso devolve o bairro cadastrado, com a taxa dele", () => {
  const b = bairroCadastrado("Ville de France bloco 8 apt 403", loja);
  assert.equal(b?.name, "Country Club");
  assert.equal(b?.fee, 4);
});
caso("apelido gravado como texto com vírgulas também vale", () => {
  assert.equal(bairroCadastrado("Rua Jovina Moraes Dinis 600 Royal Park", loja)?.name, "Residencial Veredas");
});
caso("apelido igual ao texto (sem acento, sem caixa)", () => {
  assert.equal(bairroCadastrado("royal parque", loja)?.name, "Residencial Veredas");
});
caso("pedaço de palavra não casa", () => {
  assert.equal(bairroCadastrado("Rua Villeneuve", loja), null);
});
caso("bairro fora da lista continua fora", () => {
  assert.equal(bairroCadastrado("Rua Itatiaia 110, Jardim dos Estados", loja), null);
});
caso("loja sem apelido: igual a antes", () => {
  const semApelido = { deliveryZoneType: "NEIGHBORHOOD", deliveryZones: [{ name: "Centro", fee: 15, time: 50 }] } as any;
  assert.deepEqual(bairrosAtendidos(semApelido)[0].aliases, []);
  assert.equal(bairroCadastrado("Rua X, 10, Centro", semApelido)?.name, "Centro");
});

console.log(`\n${ok} casos ok`);
