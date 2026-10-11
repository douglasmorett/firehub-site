/**
 * O QUE O APP DEVE À LOJA NO FECHAMENTO DE CAIXA — e o que o entregador do app
 * cobrou na porta, que nunca passou pela gaveta.
 *
 *   npx tsx scripts/teste-caixa-entrega-do-app.ts
 *
 * Dois achados da frente do 99Food (11/10/2026):
 *  1. A linha "99Food (Pago Online)" somava a TAXA DE SERVIÇO DO APP (o
 *     `service_price`, que fica com o 99) como dinheiro da loja. Brazza, pedido
 *     cmv3axi01020trq013j1ullg6: R$ 43,11 na linha × R$ 41,79 a receber
 *     (itens 39,80 + entrega 5,99 − desconto da loja 4,00).
 *  2. Pedido do 99 (e do iFood) entregue pelo entregador DELES e pago na porta
 *     era cobrado da gaveta: quem recebe é o entregador do app. Em 60 dias, 42
 *     do 99 (R$ 2.796,31) e 43 do iFood.
 * E a régua única "é entrega da loja?" (lib/resumo-do-entregador.ts), a mesma
 * do acerto do motoboy, com a exceção do carimbo "DELIVERED" que o app do
 * motoboy gravava até 17/09/2026.
 */
import { apurarVendasDoTurno } from "../src/lib/apuracao-do-turno";
import { ehEntregaDaLoja } from "../src/lib/resumo-do-entregador";

let falhas = 0;
const confere = (nome: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "ok    " : "FALHOU"} ${nome}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`}`);
};
const r2 = (n: number) => Math.round(n * 100) / 100;
let seq = 0;
const ped = (p: Record<string, unknown>) => ({
  id: `p${++seq}`, createdAt: "2026-10-10T22:00:00Z", status: "ENTREGUE", deliveryType: "DELIVERY", source: "ONLINE",
  paymentMethod: "Dinheiro", totalAmount: 10, deliveryFee: 0, discountIfood: 0, discountTotal: 0, discountMerchant: 0, notes: null,
  tableSessionId: null, paymentMethods: null, paymentPaidAt: null, gatewayProvider: null, openDeliveryChannel: null, ifoodOrderId: null,
  deliveryBy: null, motoboyId: null, items: [], ...p,
});
const so = (p: Record<string, unknown>) => apurarVendasDoTurno([ped(p)], []);

console.log("\n— 1. O repasse do app sai sem a taxa de serviço dele —");
// O pedido da Brazza como o 99 manda: order_price 39,80; itens 15,92 de
// desconto (99 pagou tudo); entrega 5,99 com 5,99 de desconto (4,00 da loja);
// service_price 1,32. O cliente pagou 25,20.
const brazza = { source: "99FOOD", openDeliveryChannel: "99FOOD", deliveryBy: "99FOOD", paymentMethod: "Pago Online (99Food)",
  deliveryFee: 5.99, discountIfood: 17.91, discountMerchant: 4, discountTotal: 21.91, items: [{ price: 39.8, quantity: 1 }] };
confere("Brazza (total gravado certo, 25,20): a linha do 99 = 41,79", r2(so({ ...brazza, totalAmount: 25.2 }).expected.food99Online), 41.79);
confere("Brazza (total gravado cheio, 39,80 — dado antigo): também 41,79", r2(so({ ...brazza, totalAmount: 39.8 }).expected.food99Online), 41.79);
const brazzaApurado = so({ ...brazza, totalAmount: 25.2 });
confere("a taxa do 99 (1,32) aparece no bloco como 'taxa de serviço do app'", brazzaApurado.retrato.porTipo[0].ajustesDoApp, 1.32);
confere("o recebido do pedido continua o que o cliente pagou (25,20)", brazzaApurado.retrato.recebido.valor, 25.2);
// iFood pago no app: itens 50, entrega 5,99, cupom do iFood 10, da loja 2, taxa do app 0,99 → total 44,98.
const ifood = so({ source: "IFOOD", ifoodOrderId: "if-1", deliveryBy: "MERCHANT", paymentMethod: "Crédito (Pago Online)", totalAmount: 44.98,
  deliveryFee: 5.99, discountIfood: 10, discountMerchant: 2, discountTotal: 12, items: [{ price: 50, quantity: 1 }] });
confere("iFood pago no app: o repasse é 50 + 5,99 − 2 (sem os 0,99 do app)", r2(ifood.expected.ifoodOnline), 53.99);
confere("…e a linha por canal diz o mesmo", ifood.retrato.onlinePorCanal, [{ nome: "iFood", qtd: 1, valor: 53.99 }]);
// Sem os itens gravados não dá para separar: fica total + cupom, como era.
confere("sem itens gravados: total + cupom", r2(so({ source: "IFOOD", ifoodOrderId: "if-2", paymentMethod: "Pago Online", totalAmount: 30, discountIfood: 5 }).expected.ifoodOnline), 35);
// Site pago pelo cardápio: não há taxa de app, o gateway cobra o total.
confere("site pago pelo cardápio: o total", r2(so({ source: "ONLINE", paymentMethod: "PIX", gatewayProvider: "asaas", paymentPaidAt: "2026-10-10T22:01:00Z", totalAmount: 33, deliveryFee: 5, items: [{ price: 30, quantity: 1 }] }).expected.ifoodOnline), 33);

console.log("\n— 2. O entregador do app cobrou na porta: não é da gaveta —");
const dinheiro99 = so({ source: "99FOOD", openDeliveryChannel: "99FOOD", deliveryBy: "99FOOD", paymentMethod: "Dinheiro (cobrar na entrega)",
  totalAmount: 74.99, deliveryFee: 7.99, items: [{ price: 67, quantity: 1 }] });
confere("99 em dinheiro com o entregador do 99: a gaveta não espera nada", r2(dinheiro99.expected.cash), 0);
confere("…vai para a linha travada do 99 (o que o 99 repassa)", r2(dinheiro99.expected.food99Online), 74.99);
confere("…com o seu nome no retrato", dinheiro99.retrato.porForma.map((f) => f.nome), ["Cobrado pelo entregador 99Food"]);
confere("…e em lista própria, por canal", dinheiro99.retrato.cobradoPeloApp, [{ nome: "99Food", qtd: 1, valor: 74.99 }]);
confere("…fora do pago online por canal", dinheiro99.retrato.onlinePorCanal, []);
const debitoIfood = so({ source: "IFOOD", ifoodOrderId: "if-3", deliveryBy: "IFOOD", paymentMethod: "Débito (Cobrar na Entrega)", totalAmount: 48.9 });
confere("iFood no débito com o entregador do iFood: fora do débito da loja", [r2(debitoIfood.expected.debit), r2(debitoIfood.expected.ifoodOnline)], [0, 48.9]);
const dinheiroLoja = so({ source: "99FOOD", openDeliveryChannel: "99FOOD", deliveryBy: "MERCHANT", paymentMethod: "Dinheiro (cobrar na entrega)", totalAmount: 50, motoboyId: "mb1" });
confere("99 em dinheiro com o motoboy DA LOJA: continua na gaveta", [r2(dinheiroLoja.expected.cash), r2(dinheiroLoja.expected.food99Online)], [50, 0]);
confere("o total da conferência continua a soma das linhas", r2(dinheiro99.expected.total), r2(dinheiro99.expected.cash + dinheiro99.expected.food99Online));
confere("a entrega do 99 conta como entrega parceira, não do motoboy", [dinheiro99.retrato.entregaParceira.qtd, dinheiro99.entregasProprias.length], [1, 0]);

console.log("\n— 3. É entrega da loja? —");
confere("deliveryBy MERCHANT", ehEntregaDaLoja({ source: "IFOOD", deliveryBy: "MERCHANT" }), true);
confere("deliveryBy IFOOD", ehEntregaDaLoja({ source: "IFOOD", deliveryBy: "IFOOD" }), false);
confere("deliveryBy 99FOOD", ehEntregaDaLoja({ source: "99FOOD", deliveryBy: "99FOOD" }), false);
confere("site sem deliveryBy", ehEntregaDaLoja({ source: "ONLINE" }), true);
confere("iFood com entregador do iFood a caminho (sem deliveryBy)", ehEntregaDaLoja({ source: "IFOOD", ifoodDriverStatus: "GOING_TO_ORIGIN" }), false);
// Frangoso, 12–17/09/2026: o app do motoboy da LOJA carimbava "DELIVERED".
confere("carimbo DELIVERED do app do motoboy, com motoboy da loja: é da loja", ehEntregaDaLoja({ source: "IFOOD", motoboyId: "mb1", ifoodDriverStatus: "DELIVERED" }), true);
confere("DELIVERED sem motoboy da loja: parceira", ehEntregaDaLoja({ source: "IFOOD", ifoodDriverStatus: "DELIVERED" }), false);
const frangoso = so({ source: "IFOOD", ifoodOrderId: "if-4", motoboyId: "mb1", ifoodDriverStatus: "DELIVERED", paymentMethod: "Crédito (Cobrar na Entrega)", totalAmount: 79.48 });
confere("o crédito cobrado pelo motoboy da Frangoso continua da maquininha da loja", [r2(frangoso.expected.credit), frangoso.entregasProprias.length], [79.48, 1]);

console.log("\n— 4. O acréscimo do vale no balcão não é 'taxa do app' (M7) —");
// venda-presencial soma "Taxa de vale (5%)" ao total: itens 40 + 2 = 42 no Voucher/Vale.
const vale = so({ source: "PRESENCIAL", deliveryType: "RETIRADA", paymentMethod: "Voucher/Vale", totalAmount: 42, items: [{ price: 40, quantity: 1 }] });
const balcao = vale.retrato.porTipo[0];
confere("o bloco Balcão tem R$ 2 de ajuste, todo da loja (nenhum do app)", [balcao.chave, balcao.ajustes, balcao.ajustesDoApp], ["BALCAO", 2, 0]);
// E o iFood: a sobra é a taxa do app.
confere("no iFood, a sobra é a taxa de serviço do app", [ifood.retrato.porTipo[0].ajustes, ifood.retrato.porTipo[0].ajustesDoApp], [0.99, 0.99]);

console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
