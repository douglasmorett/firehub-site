/**
 * Trava o casamento do descarte do FireCheck com o cardápio/estoque
 * (lib/cmv/firecheck.ts).
 *   DATABASE_URL=postgres://x npx tsx scripts/teste-firecheck-descarte.ts
 */
import { casarItem, lerDescarte, naUnidadeDoInsumo, normalizarNome, type ProdutoComFicha } from "../src/lib/cmv/firecheck";

let falhas = 0;
const confere = (oQue: string, ok: boolean, obtido: unknown) => {
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}`}`);
};

const produtos: ProdutoComFicha[] = [
  { id: "p1", nome: "Esfirra de Carne", ficha: [{ stockItemId: "massa", quantidade: 1 }, { stockItemId: "recheio", quantidade: 30 }] },
  { id: "p2", nome: "Esfirra de Calabresa", ficha: [{ stockItemId: "massa", quantidade: 1 }] },
  { id: "p3", nome: "Refrigerante Lata", ficha: [] },
];
const insumos = [
  { id: "queijo", nome: "Queijo Muçarela", unidade: "g" },
  { id: "massa", nome: "Massa de esfirra", unidade: "un" },
];

confere("normaliza acento, caixa e 'de'", normalizarNome("  Esfirra DE Calabresa! ") === "esfirra calabresa", normalizarNome("  Esfirra DE Calabresa! "));

const c1 = casarItem("esfirra carne", produtos, insumos);
confere("produto casa sem o 'de'", c1.tipo === "PRODUTO" && c1.produto.id === "p1", c1);
const c2 = casarItem("Esfirras de Calabresa", produtos, insumos);
confere("produto casa no plural", c2.tipo === "PRODUTO" && c2.produto.id === "p2", c2);
const c3 = casarItem("queijo mucarela", produtos, insumos);
confere("insumo casa sem acento", c3.tipo === "INSUMO" && c3.insumo.id === "queijo", c3);
const c4 = casarItem("Refrigerante Lata", produtos, insumos);
confere("produto sem ficha não casa", c4.tipo === "NADA", c4);
const c5 = casarItem("Esfirra de frango", produtos, insumos);
confere("parecido não casa", c5.tipo === "NADA", c5);

confere("kg → g", naUnidadeDoInsumo(1.5, "kg", "g") === 1500, naUnidadeDoInsumo(1.5, "kg", "g"));
confere("g → kg", naUnidadeDoInsumo(250, "g", "kg") === 0.25, naUnidadeDoInsumo(250, "g", "kg"));
confere("sem unidade usa a do insumo", naUnidadeDoInsumo(3, null, "un") === 3, naUnidadeDoInsumo(3, null, "un"));
confere("un × kg não converte", naUnidadeDoInsumo(3, "un", "kg") === null, naUnidadeDoInsumo(3, "un", "kg"));

const d = lerDescarte({ idExterno: 42, item: "Esfirra de carne", quantidade: "6", unidade: "un", valorEstimado: 15, registradoEm: "2026-10-11T20:00:00Z", foto: "data:xx" });
confere("lê o corpo do FireCheck (id número, qtd texto, foto não-http vira null)", typeof d !== "string" && d.idExterno === "42" && d.quantidade === 6 && d.foto === null, d);
confere("sem item é recusado", lerDescarte({ idExterno: 1 }) === "item obrigatório", lerDescarte({ idExterno: 1 }));
const d2 = lerDescarte({ idExterno: "7", item: "x", quantidade: null });
confere("quantidade nula fica nula", typeof d2 !== "string" && d2.quantidade === null, d2);

console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo.");
if (falhas) process.exit(1);
