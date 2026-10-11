/**
 * Pedido mínimo por bairro (src/lib/minimo-do-bairro.ts) e a gravação dele no
 * cadastro dos bairros (src/lib/cadastro-da-entrega.ts).
 *
 *   npx tsx scripts/teste-minimo-do-bairro.ts
 *
 * Caso da Sabor da Praça (09/10/2026): mínimo geral R$ 20, Mussurepe longe
 * com R$ 40, Centro sem mínimo, Baixa Grande seguindo o geral.
 */
import assert from "node:assert/strict";
import { bairrosComMinimoProprio, menorMinimoDeEntrega, minimoDaEntregaNoBairro } from "../src/lib/minimo-do-bairro";
import { normalizarBairros } from "../src/lib/cadastro-da-entrega";
import { linhasDoMinimoNosDados, regraDoPedidoMinimo } from "../src/lib/fatos-da-loja";

let ok = 0;
const caso = (nome: string, f: () => void) => {
  f();
  ok++;
  console.log(`  ✓ ${nome}`);
};

const loja = {
  deliveryZoneType: "NEIGHBORHOOD",
  deliveryZones: [
    { name: "Mussurepe", fee: 3, time: 50, minimo: 40 },
    { name: "Centro", fee: 0, time: 30, minimo: 0 },
    { name: "Baixa Grande", fee: 3, time: 40 },
  ],
};

caso("bairro com mínimo próprio usa o dele (maior que o geral)", () => {
  assert.equal(minimoDaEntregaNoBairro(loja, "Mussurepe", 20), 40);
});
caso("0 no bairro = sem mínimo, mesmo com mínimo geral", () => {
  assert.equal(minimoDaEntregaNoBairro(loja, "Centro", 20), 0);
});
caso("bairro sem o campo segue o geral", () => {
  assert.equal(minimoDaEntregaNoBairro(loja, "Baixa Grande", 20), 20);
});
caso("casa o bairro dentro do endereço, sem acento", () => {
  assert.equal(minimoDaEntregaNoBairro(loja, "Rua da Igreja, 101, mussurepe", 20), 40);
});
caso("bairro desconhecido = o geral", () => {
  assert.equal(minimoDaEntregaNoBairro(loja, "Outro Lugar", 20), 20);
});
caso("fora do modo bairro o campo é ignorado", () => {
  const km = { deliveryZoneType: "KM", deliveryZones: [{ km: 3, fee: 5, time: 30, minimo: 99 }] };
  assert.equal(minimoDaEntregaNoBairro(km, "Mussurepe", 20), 20);
  assert.deepEqual(bairrosComMinimoProprio(km), []);
});
caso("menor mínimo antes de saber o bairro", () => {
  assert.equal(menorMinimoDeEntrega(loja, 20), 0); // Centro
  const semZero = { ...loja, deliveryZones: loja.deliveryZones.filter((z) => z.name !== "Centro") };
  assert.equal(menorMinimoDeEntrega(semZero, 20), 20); // Baixa Grande segue o geral
  const todosProprios = { ...loja, deliveryZones: [{ name: "A", fee: 1, time: 1, minimo: 35 }, { name: "B", fee: 1, time: 1, minimo: 50 }] };
  assert.equal(menorMinimoDeEntrega(todosProprios, 20), 35); // nenhum segue o geral
});
caso("lista dos bairros com mínimo próprio", () => {
  assert.deepEqual(bairrosComMinimoProprio(loja), [{ name: "Mussurepe", minimo: 40 }, { name: "Centro", minimo: 0 }]);
});

caso("cadastro grava o mínimo do bairro (com vírgula) e omite o vazio", () => {
  const r = normalizarBairros([
    { name: "Mussurepe", fee: "3", time: "50", minimo: "40,00" },
    { name: "Baixa Grande", fee: "3", time: "40", minimo: "" },
    { name: "Centro", fee: "0", time: "30", minimo: 0 },
  ]);
  assert.equal(r.ok, true, JSON.stringify(r.problemas));
  assert.equal(r.zonas[0].minimo, 40);
  assert.equal("minimo" in r.zonas[1], false);
  assert.equal(r.zonas[2].minimo, 0);
});
caso("cadastro recusa mínimo negativo e o absurdo", () => {
  const r = normalizarBairros([
    { name: "A", fee: 3, time: 40, minimo: -1 },
    { name: "B", fee: 3, time: 40, minimo: 4000 },
  ]);
  assert.equal(r.ok, false);
  assert.equal(r.problemas.filter((p) => p.campo === "minimo").length, 2);
});

caso("prompt: sem mínimo geral, mas com bairro — não manda 'NUNCA diga'", () => {
  const fatos = { minimoEntrega: 0, minimoRetirada: 0, aceitaRetirada: true, bairrosComMinimo: [{ name: "Mussurepe", minimo: 40 }] };
  const dados = linhasDoMinimoNosDados(fatos);
  assert.match(dados, /Mussurepe R\$ 40,00/);
  assert.doesNotMatch(dados, /NUNCA diga/);
  const regra = regraDoPedidoMinimo(fatos);
  assert.match(regra, /Mussurepe R\$ 40,00/);
  assert.doesNotMatch(regra, /NUNCA diga/);
});
caso("prompt: sem bairro com mínimo, texto de antes", () => {
  const fatos = { minimoEntrega: 0, minimoRetirada: 0, aceitaRetirada: true };
  assert.match(linhasDoMinimoNosDados(fatos), /NUNCA diga/);
  assert.match(regraDoPedidoMinimo(fatos), /NUNCA diga/);
});
caso("prompt: mínimo geral e bairro com mínimo menor", () => {
  const fatos = { minimoEntrega: 30, minimoRetirada: 0, aceitaRetirada: true, bairrosComMinimo: [{ name: "Centro", minimo: 0 }] };
  assert.match(regraDoPedidoMinimo(fatos), /Centro sem mínimo/);
  assert.match(linhasDoMinimoNosDados(fatos), /R\$ 30,00[\s\S]*Centro sem mínimo/);
});

console.log(`\n${ok} casos ok`);
