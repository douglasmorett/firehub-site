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
confere("maior que os itens: recusa", ajuste({ ...pedido, novo: 97 }).problema, "O desconto é maior que o valor dos itens.");
confere("negativo: recusa", !!ajuste({ ...pedido, novo: -1 }).problema, true);
confere("igual: nada a fazer", ajuste({ ...pedido, novo: 31 }).problema, "O desconto já é esse.");
confere("aumentar também vale", ajuste({ ...pedido, novo: 40 }).total, 61);
console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
