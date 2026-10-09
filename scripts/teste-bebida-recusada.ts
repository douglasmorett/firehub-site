/**
 * "Não quero a bebida." não é bebida (src/lib/beverage.ts) — o modal do
 * pedido e a lista "você entregou a bebida?" do motoboy. A notinha tem o
 * mesmo teste no Assistente (firehub-print-assistant/scripts/teste-bebida-recusada.js).
 * Rodar: npx tsx scripts/teste-bebida-recusada.ts
 */
import { isBeverageName, isBeverageItem, getBeveragesFromOrder, ehRecusaDeBebida } from "../src/lib/beverage";

let falhas = 0;
const confere = (nome: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHOU"} ${nome}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`}`);
};

confere("recusas", ["Não quero a bebida.", "Sem refrigerante", "Não quero refri", "Dispenso a bebida"].map(ehRecusaDeBebida), [true, true, true, true]);
confere("recusa não é nome de bebida", isBeverageName("Não quero a bebida."), false);
confere("'Sem Feijão' não é recusa de bebida", ehRecusaDeBebida("Sem Feijão"), false);
confere("'Refrigerante sem Açúcar' continua bebida", isBeverageName("Refrigerante sem Açúcar Coca-Cola 1,5l"), true);
confere("Coca Lata continua bebida", isBeverageName("Coca-Cola Lata 350ml"), true);

// O pedido real da Delícias de Casa: o prato fala de Coca, o cliente recusou.
const prato = {
  productName: "Parmegiana de Frango C/ Purê de Batata + 2 Coca-Cola 200ml", quantity: 1,
  comboSelections: [{ name: "Não Quero Nuggets" }, { name: "Sem Feijão" }, { name: "Não quero a bebida." }],
};
confere("prato com recusa: não é item de bebida", isBeverageItem(prato), false);
confere("prato com recusa: motoboy não confere bebida", getBeveragesFromOrder({ items: [prato] }), []);

const comCoca = { productName: "Frango à Milanesa", quantity: 2, comboSelections: [{ name: "Coca-Cola Lata 350ml" }] };
confere("combo com Coca: bebida", isBeverageItem(comCoca), true);
confere("combo com Coca: motoboy confere 2", getBeveragesFromOrder({ items: [comCoca] }), [{ name: "Coca-Cola Lata 350ml", quantity: 2 }]);

console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
