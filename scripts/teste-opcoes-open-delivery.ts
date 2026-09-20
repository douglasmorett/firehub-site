/**
 * scripts/teste-opcoes-open-delivery.ts
 *
 * Trava o que fazia ADICIONAL SUMIR antes de chegar à cozinha.
 *
 * Vale para a Brendi E para o JotaJá: os dois usam a mesma função.
 * A extração das opções encadeava os nove nomes de lista do Open Delivery com
 * `??` e ficava com o PRIMEIRO array não-vazio. Item com a escolha obrigatória
 * em `options` e o bacon extra em `additions` chegava sem o bacon: a comanda
 * imprimia o que veio, e o que veio já estava incompleto. Queixa do Frangoso,
 * 19/09/2026.
 *
 *   npx tsx scripts/teste-opcoes-open-delivery.ts
 */
import { extrairOpcoesDoItem, valorOpenDelivery } from "../src/lib/opcoes-open-delivery";

let ok = 0;
let falhou = 0;
function conferir(nome: string, obtido: unknown, esperado: unknown) {
  const a = JSON.stringify(obtido);
  const b = JSON.stringify(esperado);
  if (a === b) {
    ok++;
    console.log(`  ok   ${nome}`);
  } else {
    falhou++;
    console.log(`  FALHOU ${nome}\n         esperado: ${b}\n         obtido:   ${a}`);
  }
}
const nomes = (item: any) => extrairOpcoesDoItem(item).map((o: any) => o.name);

console.log("\n== O bug: adicional em outra lista que não a primeira ==");
conferir(
  "options + additions traz as duas",
  nomes({ options: [{ name: "Peito de frango" }], additions: [{ name: "Bacon extra", price: 4 }] }),
  ["Peito de frango", "Bacon extra"],
);
conferir(
  "options + toppings + customizations",
  nomes({
    options: [{ name: "Ponto da carne" }],
    toppings: [{ name: "Cheddar" }],
    customizations: [{ name: "Sem cebola" }],
  }),
  // A ordem é a da lista de nomes conhecidos (customizations vem antes de
  // toppings), não a ordem em que o originador escreveu o JSON.
  ["Ponto da carne", "Sem cebola", "Cheddar"],
);
conferir("item sem lista nenhuma", nomes({ name: "Coca 2L" }), []);

console.log("\n== Sem repetir o que veio duas vezes ==");
const mesmaLista = [{ id: "a1", name: "Queijo" }];
conferir(
  "subItems e sub_items com a MESMA referência",
  nomes({ subItems: mesmaLista, sub_items: mesmaLista }),
  ["Queijo"],
);
conferir(
  "cópias equivalentes (mesmo id, nome e quantidade)",
  nomes({ subItems: [{ id: "a1", name: "Queijo", quantity: 1 }], sub_items: [{ id: "a1", name: "Queijo", quantity: 1 }] }),
  ["Queijo"],
);
conferir(
  "mesmo nome em quantidades diferentes NÃO é repetição",
  nomes({ options: [{ name: "Queijo", quantity: 1 }], additions: [{ name: "Queijo", quantity: 2 }] }),
  ["Queijo", "Queijo"],
);

console.log("\n== Grupo entra pelos filhos, folha entra por si ==");
conferir(
  "grupo 'Molhos' some e os molhos ficam",
  nomes({ options: [{ name: "Molhos", options: [{ name: "Barbecue" }, { name: "Maionese" }] }] }),
  ["Barbecue", "Maionese"],
);

console.log("\n== Preço: booleano nunca vira dinheiro ==");
conferir("addition: true não é preço", extrairOpcoesDoItem({ options: [{ name: "Peito", addition: true }] })[0].price, 0);
conferir("preço em objeto { value }", valorOpenDelivery({ value: 7.5, currency: "BRL" }), 7.5);
conferir("preço número puro", valorOpenDelivery(3), 3);
conferir("texto que não é número", valorOpenDelivery("grátis"), 0);
conferir("nulo", valorOpenDelivery(null), 0);
conferir(
  "o adicional pago mantém o valor",
  extrairOpcoesDoItem({ options: [{ name: "X" }], additions: [{ name: "Bacon", price: 4.5 }] })[1].price,
  4.5,
);

console.log(`\n${ok} ok, ${falhou} falharam`);
process.exit(falhou > 0 ? 1 : 0);
