/**
 * npx tsx scripts/teste-meia-no-combo-ifood.ts
 *
 * Pizza meio a meio dentro de combo do iFood: os sabores ganham "1/2".
 * Caso do print do Douglas (22/10/2026).
 */
import { opcoesDoItem } from "../src/lib/ifood-itens";

let falhas = 0;
function confere(titulo: string, item: any, esperado: string[]) {
  const nomes = opcoesDoItem(item).map((o) => o.name);
  const ok = JSON.stringify(nomes) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "OK " : "ERRO"} ${titulo}${ok ? "" : `\n   saiu     ${JSON.stringify(nomes)}\n   esperado ${JSON.stringify(esperado)}`}`);
}

const op = (name: string, groupName?: string, quantity = 1) => ({ name, groupName, quantity, price: 0 });

confere(
  "combo de uma pizza com 2 sabores",
  {
    id: "x1",
    name: "Combo Pizza Grande + 4 Esfirras Doces + Coca-Cola 21",
    quantity: 1,
    options: [
      op("Calabresa com Catupiry", "Escolha os sabores"),
      op("Bacon com Catupiry", "Escolha os sabores"),
      op("Esfirra de Romeu e Julieta", "Sabores das esfirras doces", 2),
      op("Esfirra de Chocolate ao Leite", "Sabores das esfirras doces", 2),
      op("Coca-Cola 21", "Bebida"),
    ],
  },
  ["1/2 Calabresa com Catupiry", "1/2 Bacon com Catupiry", "Esfirra de Romeu e Julieta", "Esfirra de Chocolate ao Leite", "Coca-Cola 21"],
);

confere(
  "combo de uma pizza com 1 sabor: inteira",
  { id: "x2", name: "Combo Pizza Grande + Coca", quantity: 1, options: [op("Calabresa", "Sabor"), op("Coca-Cola 2L", "Bebida")] },
  ["Calabresa", "Coca-Cola 2L"],
);

confere(
  "combo de 2 pizzas: são duas inteiras",
  { id: "x3", name: "Combo 2 Pizzas Grandes", quantity: 1, options: [op("Calabresa", "Sabores"), op("Mussarela", "Sabores")] },
  ["Calabresa", "Mussarela"],
);

confere(
  "grupo diz 'pizza' mesmo com o nome do item sem pizza",
  { id: "x4", name: "Combo Família", quantity: 1, options: [op("Calabresa", "Sabores da pizza"), op("Portuguesa", "Sabores da pizza"), op("Frango", "Sabores da pizza")] },
  ["1/3 Calabresa", "1/3 Portuguesa", "1/3 Frango"],
);

confere(
  "esfirras no combo de pizza não viram fração",
  { id: "x5", name: "Combo Pizza + Esfihas", quantity: 1, options: [op("Carne", "Sabores das esfihas"), op("Queijo", "Sabores das esfihas")] },
  ["Carne", "Queijo"],
);

confere(
  "já veio com 1/2: não repete",
  { id: "x6", name: "Pizza Grande 2 Sabores", quantity: 1, options: [op("1/2 Calabresa", "Sabores"), op("1/2 Bacon", "Sabores")] },
  ["1/2 Calabresa", "1/2 Bacon"],
);

confere(
  "sem groupName: como era",
  { id: "x7", name: "Combo Pizza Grande", quantity: 1, options: [op("Calabresa"), op("Bacon")] },
  ["Calabresa", "Bacon"],
);

console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo");
process.exit(falhas ? 1 : 0);
