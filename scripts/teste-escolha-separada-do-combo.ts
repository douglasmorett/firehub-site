/**
 * "Separados" na impressora: a escolha DENTRO do combo também sai uma por
 * linha. O "2 Burguers por R$ 32,99" chega com quantidade 1 e "BBQ Burguer x2"
 * dentro — saía "- 2x BBQ Burguer" numa linha só e a cozinha mandava um
 * lanche (Frangoso, 13/10/2026, pedido #74 da Brendi).
 *
 *   npx tsx scripts/teste-escolha-separada-do-combo.ts
 */
import { comandaDoAssistente } from "../src/lib/gerado/comanda-do-assistente";
import { escolhasUmaPorUnidade, itensComEscolhasSeparadas } from "../src/lib/parse-combo";

let ok = 0, falhas = 0;
const confere = (c: boolean, m: string) => { c ? ok++ : falhas++; console.log(c ? "  ✓" : "  ✗", m); };
const texto = (bytes: unknown) => String(bytes).replace(/[\x00-\x09\x0B-\x1F]./g, "").replace(/[^\x20-\x7E\n]/g, "");
const linhas = (order: any) => texto(comandaDoAssistente(order, "Frangoso", 48)).split("\n").map((l) => l.trim());

// O #74 de 13/10, como o servidor manda para o Assistente.
const pedido = {
  id: "t74", dailyOrderNumber: 74, source: "BRENDI", customerName: "Cliente", totalAmount: 88.98, deliveryFee: 0,
  items: [
    { name: "Combo Box de Frango P", qty: 1, price: 43.99, comboSelections: [
      { name: "Peito de frango", quantity: 1, price: 0 },
      { name: "Sache Barbecue", quantity: 1, price: 2 },
    ] },
    { name: "2 Burguers por R$32,99", qty: 1, price: 32.99, comboSelections: [{ name: "BBQ Burguer", quantity: 2, price: 0 }] },
    { name: "Pepsi Cola 1,5l", qty: 1, price: 12 },
  ],
};
const separado = (p: any) => ({ ...p, separarItens: true, items: itensComEscolhasSeparadas(p.items, true) });

// 1. Agrupado continua como sempre foi.
const agrupado = linhas(pedido);
confere(agrupado.some((x) => /^- 2x BBQ Burguer/.test(x)), "agrupado: continua '- 2x BBQ Burguer'");

// 2. Separado: dois lanches, duas linhas, sem "2x".
const sep = linhas(separado(pedido));
const bbq = sep.filter((x) => /BBQ Burguer/.test(x) && x.startsWith("-"));
console.log("separado →", bbq.join(" | "));
confere(bbq.length === 2 && bbq.every((x) => !/\dx BBQ/.test(x)), "separado: duas linhas '- BBQ Burguer'");
confere(sep.filter((x) => /Peito de frango/.test(x)).length === 1, "separado: escolha de quantidade 1 não muda");

// 3. O total não muda.
// (o "T" de "Total" vem colado no código do negrito e o `texto` o come: casa pelo resto)
const valores = (ls: string[]) => ls.filter((x) => /(Subtotal|otal):/.test(x)).join(" | ");
confere(/R\$ 88,98/.test(valores(sep)) && valores(agrupado) === valores(sep), `subtotal e total iguais nos dois (${valores(sep)})`);

// 4. Adicional pago: cada linha leva o preço dela, a soma é a mesma.
const comAdicional = { ...pedido, items: [{ name: "2 Burguers por R$32,99", qty: 1, price: 36.99, comboSelections: [{ name: "Classic salada", quantity: 2, price: 2 }] }], totalAmount: 36.99 };
const classic = linhas(separado(comAdicional)).filter((x) => /Classic salada/.test(x));
console.log("adicional →", classic.join(" | "));
confere(classic.length === 2 && classic.every((x) => /R\$ 2,00/.test(x)), "adicional: duas linhas de +R$ 2,00 (era uma de +R$ 4,00)");

// 5. Dois combos de dois lanches: quatro linhas, duas em cada combo.
const doisCombos = { ...pedido, items: [{ name: "2 Burguers por R$32,99", qty: 2, price: 32.99, comboSelections: [{ name: "BBQ Burguer", quantity: 2, price: 0 }] }], totalAmount: 65.98 };
const l5 = linhas(separado(doisCombos));
confere(l5.filter((x) => x.startsWith("1x 2 Burguers")).length === 2, "2x combo: duas linhas '1x 2 Burguers'");
confere(l5.filter((x) => /^- BBQ Burguer/.test(x)).length === 4, "2x combo: quatro '- BBQ Burguer', nenhum '2x'");

// 6. Fração e sem "Separados" ficam como estão.
confere(JSON.stringify(escolhasUmaPorUnidade([{ name: "Meia Calabresa", quantity: 0.5 }])) === JSON.stringify([{ name: "Meia Calabresa", quantity: 0.5 }]), "fração não desdobra");
confere(itensComEscolhasSeparadas(pedido.items, false) === pedido.items, "sem Separados: a lista volta a mesma");
confere(escolhasUmaPorUnidade(null) === null, "sem escolhas: null");

console.log(`\n${ok} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
