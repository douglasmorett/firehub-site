/**
 * "2x X Tudo" com 1 Fanta em cada: a comanda do Assistente tem que dizer
 * "2x Fanta" (Map Grill, 01/10/2026) — a mesma conta do KDS.
 *
 *   node --experimental-strip-types scripts/teste-quantidade-da-opcao-na-comanda.mjs
 */
import { comandaDoAssistente } from "../src/lib/gerado/comanda-do-assistente.ts";

let ok = 0, falhas = 0;
const confere = (c, m) => { c ? ok++ : falhas++; console.log(c ? "  ✓" : "  ✗", m); };
const texto = (bytes) => String(bytes).replace(/[\x00-\x09\x0B-\x1F]./g, "").replace(/[^\x20-\x7E\n]/g, "");
const linhas = (order) => texto(comandaDoAssistente(order, "Map Grill", 48)).split("\n").map((l) => l.trim());

const pedido = {
  id: "t1", dailyNumber: 7, source: "SITE", customerName: "Cliente", totalAmount: 100, deliveryFee: 0,
  items: [
    { name: "X Duplo", qty: 1, price: 30, comboSelections: [{ name: "BATATA FRITA", quantity: 1 }, { name: "Fanta Uva 350ml", quantity: 1 }, { name: "Tomate", quantity: 1, price: 2 }] },
    { name: "X Tudo", qty: 2, price: 35, comboSelections: [{ name: "Fanta Uva 350ml", quantity: 1 }, { name: "BATATA FRITA", quantity: 1 }, { name: "Bacon", quantity: 2, price: 3 }] },
  ],
};

const l = linhas(pedido);
const depoisDo = (nome) => l.slice(l.findIndex((x) => x.includes(nome)) + 1);
const xTudo = depoisDo("2x X Tudo").slice(0, 3).join(" | ");
const xDuplo = depoisDo("1x X Duplo").slice(0, 3).join(" | ");
console.log("X Tudo  →", xTudo);
console.log("X Duplo →", xDuplo);
confere(/- 2x Fanta Uva 350ml/.test(xTudo), "2x X Tudo: sai 2x Fanta");
confere(/- 2x BATATA FRITA/.test(xTudo), "2x X Tudo: sai 2x Batata");
confere(/- 4x Bacon.*R\$ 12,00/.test(xTudo), "2x X Tudo com 2 bacons em cada: 4x Bacon, +R$ 12,00");
confere(/- Fanta Uva 350ml/.test(xDuplo) && !/\dx Fanta/.test(xDuplo), "1x X Duplo: Fanta sem multiplicar");

const separado = linhas({ ...pedido, separarItens: true });
const fantasSoltas = separado.filter((x) => /^- (\dx )?Fanta Uva/.test(x));
confere(separado.filter((x) => x.startsWith("1x X Tudo")).length === 2, "itens separados: duas linhas de 1x X Tudo");
confere(fantasSoltas.length === 3 && fantasSoltas.every((x) => !/\dx Fanta/.test(x)), "itens separados: uma Fanta por linha, sem 2x");

const cozinha = linhas({ ...pedido, semValores: true }).join("\n");
confere(!/R\$/.test(cozinha) && /- 2x Fanta Uva/.test(cozinha), "via da cozinha: 2x Fanta e nenhum valor");

console.log(`\n${ok} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
