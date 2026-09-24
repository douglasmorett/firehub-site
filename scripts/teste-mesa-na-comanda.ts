/**
 * Trava a mesa e o garçom na comanda (lib/mesa-na-comanda.ts) e o "Em outra
 * impressora" (restoDoPedido, lib/roteamento-de-impressao.ts).
 *
 *   npx tsx scripts/teste-mesa-na-comanda.ts
 *
 * O caso de origem: pedido #3 da Ragnar Burger, Mesa 4, garçom Rafaela Cereja
 * (24/09/2026). A comanda saía "(3) MESA", sem a mesa e sem o garçom, e com
 * "Outros valores do pedido: R$ 36,00" — os dois sucos que foram para a outra
 * cozinha. O papel em si é conferido do lado do Assistente
 * (firehub-print-assistant/scripts/teste-mesa-na-comanda.js); aqui é o que o
 * SITE manda.
 */
import {
  numeroDaMesa, garcomDaMesa, camposDaMesaParaImpressao, nomeComMesa, nomeDoClienteNaComanda,
} from "../src/lib/mesa-na-comanda";
import { restoDoPedido, destinosDoPedido } from "../src/lib/roteamento-de-impressao";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`  ${ok ? "ok   " : "FALHA"} ${oQue}`);
  if (!ok) console.log(`        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(obtido)}`);
};

const RODADA = {
  deliveryType: "MESA",
  customerName: "Matheus ",
  customerAddress: "Mesa 4",
  tableSessionId: "cmug1lynz00q2k801tuws8tlv",
  tableSession: { waiterName: "Rafaela Cereja", waiter: { name: "Rafaela Cereja" }, table: { number: 4 } },
};

console.log("\n1) O número da mesa");
confere("da conta aberta", numeroDaMesa(RODADA), "4");
confere("do rótulo, quando não há conta (PDV)", numeroDaMesa({ deliveryType: "MESA", customerAddress: "Mesa 20" }), "20");
confere("rótulo com espaço dobrado (\"Mesa  10\", visto no banco)", numeroDaMesa({ deliveryType: "MESA", customerAddress: "Mesa  10" }), "10");
confere("a conta manda sobre o rótulo", numeroDaMesa({ ...RODADA, customerAddress: "Mesa 9" }), "4");
confere("entrega não tem mesa", numeroDaMesa({ deliveryType: "DELIVERY", customerAddress: "Mesa Redonda, 12 - Centro" }), "");
confere("rótulo sem número não vira mesa", numeroDaMesa({ deliveryType: "MESA", customerAddress: "Mesa" }), "");

console.log("\n2) O garçom");
confere("o do cadastro", garcomDaMesa(RODADA), "Rafaela Cereja");
confere("o cadastro vence o nome gravado na abertura", garcomDaMesa({ ...RODADA, tableSession: { ...RODADA.tableSession, waiter: { name: "Rafaela C." } } }), "Rafaela C.");
confere("sem cadastro, o nome gravado", garcomDaMesa({ ...RODADA, tableSession: { waiterName: "  Joana   Dias ", waiter: null, table: { number: 4 } } }), "Joana Dias");
confere("mesa sem garçom", garcomDaMesa({ ...RODADA, tableSession: { waiterName: null, waiter: null, table: { number: 4 } } }), "");
confere("fora da mesa, nada", garcomDaMesa({ deliveryType: "DELIVERY", tableSession: RODADA.tableSession }), "");

console.log("\n3) Os campos próprios");
confere("mesa e garçom", camposDaMesaParaImpressao(RODADA), { mesa: "4", garcom: "Rafaela Cereja" });
confere("PDV sem conta: só a mesa", camposDaMesaParaImpressao({ deliveryType: "MESA", customerAddress: "Mesa 20" }), { mesa: "20" });
confere("entrega: nada", camposDaMesaParaImpressao({ deliveryType: "DELIVERY", customerAddress: "Rua A, 1" }), {});

console.log("\n4) O nome para o Assistente antigo");
confere("nome + mesa + garçom", nomeComMesa("Matheus ", { mesa: "4", garcom: "Rafaela Cereja" }), "Matheus · Mesa 4 · Garçom Rafaela Cereja");
confere("o nome já é a mesa: ela não repete", nomeComMesa("Mesa 4", { mesa: "4", garcom: "Rafaela Cereja" }), "Mesa 4 · Garçom Rafaela Cereja");
confere("mesa 4 não confunde com mesa 40", nomeComMesa("Mesa 40", { mesa: "4" }), "Mesa 40 · Mesa 4");
confere("apelido que não é a mesa (\"Émily m17\")", nomeComMesa("Émily m17", { mesa: "17" }), "Émily m17 · Mesa 17");
confere("sem nome", nomeComMesa("", { mesa: "4" }), "Mesa 4");
confere("fora da mesa, intacto", nomeComMesa("Ana", {}), "Ana");

console.log("\n5) O nome completo, na ordem que o Assistente desfaz");
confere("rodada da Ragnar", nomeDoClienteNaComanda(RODADA), "Matheus · Mesa 4 · Garçom Rafaela Cereja");
confere("o documento continua por último", nomeDoClienteNaComanda({ ...RODADA, customerCpfCnpj: "52998224725" }), "Matheus · Mesa 4 · Garçom Rafaela Cereja · CPF 529.982.247-25");
confere("balcão com pager e CPF, como antes", nomeDoClienteNaComanda({ deliveryType: "RETIRADA", customerName: "João", pagerNumber: "12", customerCpfCnpj: "52998224725" }), "João · PAGER 12 · CPF 529.982.247-25");

console.log("\n6) O que foi para a outra impressora");
const thor = { name: "Thor", quantity: 2, price: 39.9, category: "Burgers" };
const batata = { name: "Batata Frita", quantity: 1, price: 12.9, category: "Entradas" };
const abacaxi = { name: "Suco de Abacaxi", quantity: 1, price: 18, category: "Sucos" };
const morango = { name: "Suco de Morango", quantity: 1, price: 18, category: "Sucos" };
const itens = [thor, abacaxi, morango, batata];
confere("os dois sucos da Ragnar", restoDoPedido(itens, [thor, batata]), { itens: 2, valor: 36 });
confere("quantidade conta como itens", restoDoPedido(itens, [abacaxi, morango]), { itens: 3, valor: 92.7 });
confere("pedido inteiro nesta impressora: nada", restoDoPedido(itens, itens), undefined);
confere("o que ficou fora não tem preço: nada", restoDoPedido([thor, { name: "Brinde", quantity: 1, price: 0 }], [thor]), undefined);
confere("formato do navegador (qty)", restoDoPedido([{ qty: 3, price: 5 }, { qty: 1, price: 2 }].slice(), []), { itens: 4, valor: 17 });

console.log("\n7) Com as impressoras da Ragnar (roteamento real)");
const impressoras = [
  { name: "BALCAO", modulos: ["salao"] as any, categories: ["Cerveja", "Entretenimento e Presentes"] },
  { name: "COZINHA PIZZA", modulos: ["delivery", "salao"] as any, categories: ["Pizzas Especiais", "Sucos", "Sobremesas", "Refrigerantes"] },
  { name: "COZINHA ENTREGA RAGNA", modulos: ["delivery", "salao"] as any, categories: ["Burgers", "Adicionais Burger", "Combos", "Entradas", "Refrigerantes"] },
];
const pedido = { source: "PRESENCIAL", items: itens };
const porImpressora = Object.fromEntries(
  destinosDoPedido(impressoras, pedido).map((d) => [d.impressora.name, restoDoPedido(pedido.items, d.itens) ?? null])
);
confere("cozinha dos burgers: os sucos ficaram fora", porImpressora["COZINHA ENTREGA RAGNA"], { itens: 2, valor: 36 });
confere("cozinha da pizza: os burgers e a batata ficaram fora", porImpressora["COZINHA PIZZA"], { itens: 3, valor: 92.7 });
// Nenhum item é do balcão: ele não recebe a rodada (a divisão por categoria de
// 24/09/2026 acabou com o "nenhum item casou, imprime tudo").
confere("balcão sem item desta rodada: não recebe a comanda", "BALCAO" in porImpressora, false);

console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTUDO OK");
process.exitCode = falhas ? 1 : 0;
