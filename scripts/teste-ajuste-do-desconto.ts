/**
 * Ajustar o desconto do pedido (lib/edicao-de-pedido.ts, ajusteDoDescontoDaEdicao).
 * Divinos #22, 09/10/2026: itens 96, taxa 5, desconto 31 por engano → volta.
 * Rodar: npx tsx scripts/teste-ajuste-do-desconto.ts
 */
import { ajusteDoDescontoDaEdicao as ajuste } from "../src/lib/edicao-de-pedido";

let falhas = 0;
const confere = (nome: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHOU"} ${nome}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`}`);
};
const pedido = { itens: [{ price: 96, quantity: 1 }], discountTotal: 31, deliveryFee: 5, totalAmount: 70 };
const a = ajuste({ ...pedido, novo: 2.2 });
confere("31 → 2,20: total sobe 28,80", [a.novo, a.delta, a.total, a.problema], [2.2, -28.8, 98.8, ""]);
const b = ajuste({ ...pedido, novo: 0 });
confere("tirar tudo: total 101", [b.novo, b.total], [0, 101]);
// Desde 30/10/2026 o desconto vai até itens + entrega (96 + 5 = 101); a taxa do pedido não muda.
const entrega = ajuste({ ...pedido, novo: 97 });
confere("passa dos itens e come R$ 1 da entrega: total 4", [entrega.novo, entrega.total, entrega.problema], [97, 4, ""]);
const cortesia = ajuste({ ...pedido, novo: 101 });
confere("cortesia completa (itens + entrega): total 0", [cortesia.novo, cortesia.delta, cortesia.total, cortesia.problema], [101, 70, 0, ""]);
confere("maior que itens + entrega: recusa", ajuste({ ...pedido, novo: 101.01 }).problema, "O desconto é maior que o valor do pedido (itens + entrega).");
confere("sem o total gravado, a conta itens − desconto + taxa também dá 0", ajuste({ ...pedido, totalAmount: null, novo: 101 }).total, 0);
confere("negativo: recusa", !!ajuste({ ...pedido, novo: -1 }).problema, true);
confere("igual: nada a fazer", ajuste({ ...pedido, novo: 31 }).problema, "O desconto já é esse.");
confere("aumentar também vale", ajuste({ ...pedido, novo: 40 }).total, 61);
console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
