/**
 * scripts/teste-pagamento-brendi.ts
 *
 * Trava o comportamento que, errado, COBRA O CLIENTE DUAS VEZES.
 *
 * Um pedido que chega pago (PIX/cartao online) e sai na comanda como "cobrar na
 * entrega" faz o motoboy cobrar de novo. O contrario — pedido a receber saindo
 * como pago — e a loja entregando de graca. Nao ha teste automatizado neste
 * repositorio, entao este script existe para ser rodado a mao antes de mexer em
 * lib/payment-parser.ts:
 *
 *   npx tsx scripts/teste-pagamento-brendi.ts
 *
 * Os formatos abaixo sao os que o SUPORTE DA BRENDI confirmou em 05/09/2026
 * (type ONLINE/OFFLINE; method PIX/CARD/CASH/IFOOD/VALE) mais o `type: "PENDING"`
 * que medimos no pedido real B-6001 e que nao estava na lista deles.
 */
import { parseOrderPaymentInfo } from "../src/lib/payment-parser";

const casos: [string, any, boolean][] = [
  // MEDIDO no pedido real 6005, pago de verdade: o `type` chega "PREPAID",
  // e nao "ONLINE" como o suporte descreveu — do mesmo jeito que o a receber
  // chega "PENDING" e nao "OFFLINE". As quatro grafias sao tratadas.
  ["PREPAID:PIX (medido no 6005, pago)", { payments: { prepaid: 50, pending: 0, methods: [{ type: "PREPAID", method: "PIX", value: 50 }] } }, true],
  ["ONLINE:PIX (pago)", { payments: { prepaid: 25, pending: 0, methods: [{ type: "ONLINE", method: "PIX", value: 25 }] } }, true],
  ["ONLINE:CARD (pago)", { payments: { prepaid: 25, pending: 0, methods: [{ type: "ONLINE", method: "CARD", value: 25 }] } }, true],
  ["OFFLINE:CASH (cobrar)", { payments: { prepaid: 0, pending: 25, methods: [{ type: "OFFLINE", method: "CASH", value: 25, changeFor: 50 }] } }, false],
  ["OFFLINE:CARD (maquininha)", { payments: { prepaid: 0, pending: 25, methods: [{ type: "OFFLINE", method: "CARD", value: 25 }] } }, false],
  ["PENDING:CASH (medido no B-6001)", { payments: { prepaid: 0, pending: 25, methods: [{ type: "PENDING", method: "CASH", value: 25, changeFor: 25 }] } }, false],
  ["ONLINE:IFOOD (pago pelo iFood)", { payments: { prepaid: 25, pending: 0, methods: [{ type: "ONLINE", method: "IFOOD", value: 25 }] } }, true],
  // O suporte alertou que PREPAID nao prova que o dinheiro entrou: o que vale
  // e o `status`. Pedido marcado PREPAID mas com status nao aprovado NAO pode
  // sair como pago, senao a loja entrega de graca.
  ["PREPAID:PIX com status PENDING (nao pago)", { payments: { prepaid: 50, pending: 0, methods: [{ type: "PREPAID", method: "PIX", status: "PENDING", value: 50 }] } }, false],
  ["PREPAID:PIX com status CONFIRMED (pago)", { payments: { prepaid: 50, pending: 0, methods: [{ type: "PREPAID", method: "PIX", status: "CONFIRMED", value: 50 }] } }, true],
  ["OFFLINE:VALE (vale na entrega)", { payments: { prepaid: 0, pending: 25, methods: [{ type: "OFFLINE", method: "VALE", value: 25 }] } }, false],
];

let falhas = 0;
for (const [nome, payload, esperadoPago] of casos) {
  const r = parseOrderPaymentInfo(payload, "BRENDI");
  const ok = r.isPrepaid === esperadoPago;
  if (!ok) falhas++;
  console.log(`${ok ? "OK " : "ERRO"} | ${nome.padEnd(32)} -> "${r.paymentMethod}"${r.changeAmount ? ` | troco ${r.changeAmount}` : ""}`);
}
console.log(falhas === 0 ? "\nTodos os casos corretos." : `\n${falhas} caso(s) ERRADO(S).`);
process.exit(falhas === 0 ? 0 : 1);
