/**
 * Trava como a baixa do estoque acha a opção do combo (lib/stock.ts) — em
 * especial o nome curto que o iFood manda ("Carne" para "Esfirra de Carne",
 * Hakim, out/2026).
 *
 *   npx tsx scripts/teste-baixa-do-combo.ts
 */
import { acharOpcaoDoCombo, indexarOpcoes, normalizarEscolhasDoCombo, type OpcaoDeCombo } from "../src/lib/stock";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

const opcao = (id: string, nome: string, grupo = "g10"): OpcaoDeCombo => ({
  id: `item-${id}`, comboGroupId: grupo, menuProductId: id,
  comboGroup: { menuProductId: "c10", priceRule: null },
  menuProduct: { name: nome, recipeItems: [] },
});
const indice = indexarOpcoes([
  opcao("carne", "Esfirra de Carne"),
  opcao("carnecat", "Esfirra de Carne c/ Catupiry"),
  opcao("frangocat", "Esfirra de Frango c/ Catupiry"),
  opcao("calmus", "Esfirra de Calabresa com Mussarela"),
  opcao("qt", "Esfirra de Queijo Temperado"),
  opcao("5q", "Esfirra 5 Queijos"),
  opcao("guara", "Guaravita 280ml", "gbeb"),
]);
const acha = (bruto: unknown) => normalizarEscolhasDoCombo(bruto).map((e) => acharOpcaoDoCombo(indice, e)?.menuProductId ?? null);

confere("site: nome igual ao da opção", acha({ g10: { "Esfirra de Carne": 2 } }), ["carne"]);
confere("iFood: nome curto casa com a única opção que termina com ele",
  acha([{ name: "Carne", quantity: 5 }, { name: "Queijo Temperado", quantity: 3 }, { name: "Guaravita", quantity: 1 }]),
  ["carne", "qt", "guara"]);
confere("iFood: \"5 Queijos\" é o sabor, não 5 de queijo", acha([{ name: "5 Queijos", quantity: 1 }]), ["5q"]);
confere("ambíguo não baixa: \"Catupiry\" serve a carne e a frango", acha([{ name: "Catupiry", quantity: 1 }]), [null]);
confere("nome que não está no combo não baixa: \"Calabresa\" (o combo só tem a com mussarela)", acha([{ name: "Calabresa", quantity: 2 }]), [null]);
confere("\"Carne\" não vira a com catupiry (essa termina em catupiry)", acha([{ name: "Carne c/ Catupiry", quantity: 1 }]), ["carnecat"]);

console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
