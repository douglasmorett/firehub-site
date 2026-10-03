/**
 * O DESCONTO DADO NA EDIÇÃO DO PEDIDO NO FECHAMENTO DE CAIXA.
 *
 *   npx tsx scripts/teste-desconto-no-caixa.ts
 *
 * Os pedidos são gravados com as MESMAS funções da rota de edição
 * (contaDoDescontoDaEdicao + descontoDaLojaDepoisDaEdicao) e passam pela MESMA
 * apuração do fechamento (apurarVendasDoTurno). Confere:
 *   • a gaveta e a maquininha esperam o valor COM desconto (o que o entregador cobra);
 *   • o bloco Delivery fecha: produtos + taxa − desconto = total, sem "ajustes";
 *   • o cupom antigo da loja (Wabiz) não vira "cupom da plataforma";
 *   • o cupom do iFood continua sendo do iFood.
 */
import { apurarVendasDoTurno } from "../src/lib/apuracao-do-turno";
import { contaDoDescontoDaEdicao, descontoDaLojaDepoisDaEdicao } from "../src/lib/edicao-de-pedido";
import type { DescontoManual } from "../src/lib/desconto-manual";

let falhas = 0;
const ok = (cond: boolean, nome: string, detalhe?: unknown) => {
  if (!cond) falhas++;
  console.log(`${cond ? "✓" : "✗"} ${nome}${cond ? "" : ` → ${JSON.stringify(detalhe)}`}`);
};

/** O que a rota grava ao dar `desconto` no pedido (sem mexer em item). */
function darDesconto(o: any, desconto: DescontoManual) {
  const itens = o.items.map((i: any) => ({ price: i.price, quantity: i.quantity }));
  const conta = contaDoDescontoDaEdicao({ itens, discountTotal: o.discountTotal, deliveryFee: o.deliveryFee, desconto });
  if (conta.problema) throw new Error(conta.problema);
  return { ...o, totalAmount: conta.total, discountTotal: conta.discountTotal, discountMerchant: descontoDaLojaDepoisDaEdicao(o, conta.valor) };
}

const agora = new Date();
const base = { status: "ENTREGUE", deliveryType: "DELIVERY", createdAt: agora, customerName: "Cliente", motoboyId: null };

// O pedido do print: iFood cobrado na entrega no crédito, cupom do iFood de 11,01.
const ifood = darDesconto({
  ...base, id: "a", dailyOrderNumber: 1, source: "IFOOD", ifoodOrderId: "x", paymentMethod: "Crédito (Cobrar na Entrega)",
  totalAmount: 48.89, deliveryFee: 0, discountTotal: 11.01, discountIfood: 11.01, discountMerchant: null,
  items: [{ price: 59.9, quantity: 1 }],
}, { tipo: "percent", valor: 10, motivo: "Pedido atrasado" });

// Site em dinheiro, sem desconto antes (sem as colunas).
const site = darDesconto({
  ...base, id: "b", dailyOrderNumber: 2, source: "SITE", paymentMethod: "Dinheiro",
  totalAmount: 67, deliveryFee: 7, discountTotal: null, discountIfood: null, discountMerchant: null,
  items: [{ price: 30, quantity: 2 }],
}, { tipo: "valor", valor: 5, motivo: "Embalagem" });

// Wabiz em dinheiro com cupom da LOJA de R$ 10 gravado só em discountTotal.
const wabiz = darDesconto({
  ...base, id: "c", dailyOrderNumber: 3, source: "WABIZ", paymentMethod: "Dinheiro (Cobrar na Entrega)",
  totalAmount: 45, deliveryFee: 5, discountTotal: 10, discountIfood: null, discountMerchant: null,
  items: [{ price: 50, quantity: 1 }],
}, { tipo: "valor", valor: 5, motivo: "" });

console.log("Gravado:", { ifood: [ifood.totalAmount, ifood.discountTotal, ifood.discountMerchant], site: [site.totalAmount, site.discountTotal, site.discountMerchant], wabiz: [wabiz.totalAmount, wabiz.discountTotal, wabiz.discountMerchant] });
ok(ifood.totalAmount === 44 && site.totalAmount === 62 && wabiz.totalAmount === 40, "totais com desconto: 44, 62 e 40");

const r = apurarVendasDoTurno([ifood, site, wabiz], []);
const e = r.expected;
console.log("Esperado:", e);
ok(Math.abs(e.cash - 102) < 0.005, "gaveta espera R$ 102,00 (62 + 40), o que o entregador cobrou", e.cash);
ok(Math.abs(e.credit - 44) < 0.005, "crédito espera R$ 44,00 (o iFood cobrado na entrega)", e.credit);
ok(Math.abs(e.total - 146) < 0.005, "total da conferência R$ 146,00", e.total);
ok(Math.abs(e.ifoodCoupons - 11.01) < 0.005, "cupom do iFood continua R$ 11,01 (informativo, fora da gaveta)", e.ifoodCoupons);

const delivery = r.retrato.porTipo.find((b) => b.chave === "DELIVERY")!;
console.log("Bloco Delivery:", JSON.stringify({ valor: delivery.valor, produtos: delivery.produtos, taxa: delivery.taxaDeEntrega, desconto: delivery.desconto, ajustes: delivery.ajustes }));
ok(delivery.ajustes === 0, "bloco Delivery fecha sem 'outras taxas e ajustes'", delivery.ajustes);
// Desconto da loja no bloco: 4,89 (iFood) + 5 (site) + 15 (Wabiz: cupom 10 + 5) = 24,89
ok(Math.abs(delivery.desconto.valor - 24.89) < 0.005, "desconto da loja no bloco R$ 24,89", delivery.desconto);

const plataforma = r.retrato.cupomDaPlataforma;
console.log("Cupom da plataforma:", JSON.stringify(plataforma));
ok(!JSON.stringify(plataforma).includes("Wabiz"), "o cupom da loja na Wabiz não virou cupom da plataforma", plataforma);

console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo");
process.exit(falhas ? 1 : 0);
