/**
 * "Separados" na impressora: uma linha por unidade — o item E a escolha de
 * dentro do combo —, pelos DOIS trilhos que chegam ao Assistente.
 *
 * 1. O "2 Burguers por R$ 32,99" chega com quantidade 1 e "BBQ Burguer x2"
 *    dentro: saía "- 2x BBQ Burguer" numa linha (Frangoso, 13/10/2026, #74).
 * 2. Pela FILA DA NUVEM o "Separados" nunca chegou ao papel: o Assistente
 *    monta o pedido de cada destino sem a marca `separarItens` (server.js, o
 *    laço dos `destinos`), e o #1 da Brendi de 16/10/2026 saiu
 *    "2x 2 Burguers / - 2x Onion Rings Burguer / - 2x Frangoso" — a foto que
 *    o Lucas mandou. O servidor agora manda os itens já separados.
 *
 *   npx tsx scripts/teste-escolha-separada-do-combo.ts
 */
import { comandaDoAssistente } from "../src/lib/gerado/comanda-do-assistente";
import { escolhasUmaPorUnidade, itensUmaLinhaPorUnidade } from "../src/lib/parse-combo";

let ok = 0, falhas = 0;
const confere = (c: boolean, m: string) => { c ? ok++ : falhas++; console.log(c ? "  ✓" : "  ✗", m); };
const texto = (bytes: unknown) => String(bytes).replace(/[\x00-\x09\x0B-\x1F]./g, "").replace(/[^\x20-\x7E\n]/g, "");
const linhas = (order: any) => texto(comandaDoAssistente(order, "Frangoso", 48)).split("\n").map((l) => l.trim());
// (o "T" de "Total" vem colado no código do negrito e o `texto` o come: casa pelo resto)
const valores = (ls: string[]) => ls.filter((x) => /(Subtotal|otal):/.test(x)).join(" | ");
/** As linhas de item e de escolha, na ordem do papel. */
const doResumo = (ls: string[]) => ls.filter((x) => /^\d+x |^- /.test(x));

/** Trilho do NAVEGADOR (lib/print.ts): a marca vai no pedido, e os itens já separados. */
const peloNavegador = (p: any) => ({ ...p, separarItens: true, items: itensUmaLinhaPorUnidade(p.items, true) });
/** Trilho da FILA DA NUVEM: o Assistente usa `destino.items` e NÃO recebe a marca. */
const pelaFila = (p: any) => ({ ...p, items: itensUmaLinhaPorUnidade(p.items, true) });

// ── [1] O #1 de 16/10 (Brendi), com os itens como estão no banco ───────────
console.log("\n[1] #1 da Brendi, 16/10 — a foto do Lucas");
const pedido1 = {
  id: "t1", dailyOrderNumber: 1, source: "BRENDI", customerName: "Cliente", totalAmount: 95.97, deliveryFee: 0,
  items: [
    { name: "2 Burguers por 29,99", qty: 2, price: 35.99, comboSelections: [
      { name: "Onion Rings Burguer", quantity: 1, price: 3 },
      { name: "Frangoso", quantity: 1, price: 3 },
    ] },
    { name: "SalzBurg", qty: 1, price: 23.99 },
  ],
};
const antes = doResumo(linhas(pedido1));
console.log("  fila, como estava →", antes.join(" | "));
confere(antes.some((x) => /^2x 2 Burguers/.test(x)) && antes.some((x) => /^- 2x Onion Rings/.test(x)), "sem a correção a fila desenha '2x 2 Burguers / - 2x Onion Rings' (a foto)");

const fila = doResumo(linhas(pelaFila(pedido1)));
console.log("  fila, corrigida   →", fila.join(" | "));
confere(fila.filter((x) => /^1x 2 Burguers por 29,99/.test(x)).length === 2, "fila: duas linhas '1x 2 Burguers por 29,99'");
confere(fila.filter((x) => /^- Onion Rings Burguer/.test(x)).length === 2 && fila.filter((x) => /^- Frangoso/.test(x)).length === 2, "fila: Onion Rings e Frangoso uma vez em cada combo");
confere(!fila.some((x) => /^\d+x /.test(x) && !/^1x /.test(x)) && !fila.some((x) => /^- \dx /.test(x)), "fila: nenhum '2x' no papel");
confere(fila.filter((x) => /^1x SalzBurg/.test(x)).length === 1, "fila: o SalzBurg (quantidade 1) não muda");

const nav = doResumo(linhas(peloNavegador(pedido1)));
confere(JSON.stringify(nav) === JSON.stringify(fila), "navegador e fila desenham o MESMO papel");
confere(/R\$ 95,97/.test(valores(linhas(pelaFila(pedido1)))) && valores(linhas(pedido1)) === valores(linhas(pelaFila(pedido1))), `subtotal e total iguais ao agrupado (${valores(linhas(pelaFila(pedido1)))})`);

// ── [2] O #74 de 13/10: um combo com dois lanches iguais dentro ────────────
console.log("\n[2] #74, '2 Burguers' com 'BBQ Burguer x2'");
const pedido74 = {
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
confere(linhas(pedido74).some((x) => /^- 2x BBQ Burguer/.test(x)), "agrupado: continua '- 2x BBQ Burguer'");
for (const [trilho, montar] of [["fila", pelaFila], ["navegador", peloNavegador]] as const) {
  const ls = linhas(montar(pedido74));
  const bbq = ls.filter((x) => /^- BBQ Burguer/.test(x));
  confere(bbq.length === 2 && !ls.some((x) => /\dx BBQ/.test(x)), `${trilho}: duas linhas '- BBQ Burguer'`);
  confere(ls.filter((x) => /Peito de frango/.test(x)).length === 1, `${trilho}: escolha de quantidade 1 não muda`);
  confere(valores(ls) === valores(linhas(pedido74)), `${trilho}: subtotal e total iguais ao agrupado`);
}

// ── [3] Adicional pago: cada linha com o preço dela, a soma igual ─────────
console.log("\n[3] adicional pago");
const comAdicional = { ...pedido74, items: [{ name: "2 Burguers por R$32,99", qty: 1, price: 36.99, comboSelections: [{ name: "Classic salada", quantity: 2, price: 2 }] }], totalAmount: 36.99 };
const classic = linhas(pelaFila(comAdicional)).filter((x) => /Classic salada/.test(x));
console.log("  →", classic.join(" | "));
confere(classic.length === 2 && classic.every((x) => /R\$ 2,00/.test(x)), "duas linhas de +R$ 2,00 (era uma de +R$ 4,00)");

// ── [4] 2x combo de dois lanches: quatro lanches, cada um numa linha ──────
console.log("\n[4] 2x combo de dois lanches");
const doisCombos = { ...pedido74, items: [{ name: "2 Burguers por R$32,99", qty: 2, price: 32.99, comboSelections: [{ name: "BBQ Burguer", quantity: 2, price: 0 }] }], totalAmount: 65.98 };
for (const [trilho, montar] of [["fila", pelaFila], ["navegador", peloNavegador]] as const) {
  const ls = linhas(montar(doisCombos));
  confere(ls.filter((x) => x.startsWith("1x 2 Burguers")).length === 2, `${trilho}: duas linhas '1x 2 Burguers'`);
  confere(ls.filter((x) => /^- BBQ Burguer/.test(x)).length === 4, `${trilho}: quatro '- BBQ Burguer', nenhum '2x'`);
}

// ── [5] O que NÃO muda ────────────────────────────────────────────────────
console.log("\n[5] o que não muda");
const meia = itensUmaLinhaPorUnidade([{ name: "Pizza", qty: 0.5, price: 30 }], true);
confere(meia.length === 1 && meia[0].qty === 0.5, "fração (0,5 pizza) não desdobra");
confere(JSON.stringify(escolhasUmaPorUnidade([{ name: "Meia Calabresa", quantity: 0.5 }])) === JSON.stringify([{ name: "Meia Calabresa", quantity: 0.5 }]), "escolha fracionada não desdobra");
confere(itensUmaLinhaPorUnidade(pedido1.items, false) === pedido1.items, "sem Separados: a lista volta a mesma");
const jaSeparada = itensUmaLinhaPorUnidade(pedido1.items, true);
confere(JSON.stringify(itensUmaLinhaPorUnidade(jaSeparada, true)) === JSON.stringify(jaSeparada), "separar o que já está separado não muda nada");
const doBanco = itensUmaLinhaPorUnidade([{ productName: "X", quantity: 3, price: 10 } as any], true);
confere(doBanco.length === 3 && doBanco.every((i: any) => i.quantity === 1 && i.qty === 1), "item do banco (só `quantity`) também separa");
confere(escolhasUmaPorUnidade(null) === null, "sem escolhas: null");

console.log(`\n${ok} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
