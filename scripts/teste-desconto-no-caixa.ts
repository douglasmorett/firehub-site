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
 *   • o cupom do iFood continua sendo do iFood;
 *   • a cortesia de 100% com a entrega (Annalu, 30/10/2026): total 0, a taxa e
 *     o repasse do motoboy intactos, e o caixa, o Vendas por período, o
 *     Faturamento por dia, o Cupons e descontos e a comanda fecham sem nada
 *     negativo.
 */
import { apurarVendasDoTurno } from "../src/lib/apuracao-do-turno";
import { contaDoDescontoDaEdicao, descontoDaLojaDepoisDaEdicao } from "../src/lib/edicao-de-pedido";
import type { DescontoManual } from "../src/lib/desconto-manual";
import { ganhoDoPedido, lerAcerto } from "../src/lib/ganho-do-entregador";
import { dinheiroDaParte, partesDaEntrega } from "../src/lib/resumo-do-entregador";
import { outrasTaxasDoPedido, resumoDeVendas } from "../src/lib/relatorios/vendas";
import { faturamentoPorDia } from "../src/lib/relatorios/faturamento-por-dia";
import { descontoDoPedido as descontoDoPedidoNoRelatorio } from "../src/lib/relatorios/descontos";
import { contaDoPedido } from "../src/lib/conta-do-pedido";

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

// ── CORTESIA DE 100% COM A ENTREGA (Annalu, 30/10/2026) ──────────────────
// Pizza de 50 + entrega de 8, site no dinheiro, motoboy da loja com repasse de
// 6 gravado. A rota grava desconto de 58 e total 0; a taxa continua 8.
console.log("\n— cortesia de 100% com a entrega —");
const cortesia = darDesconto({
  ...base, id: "d", dailyOrderNumber: 4, source: "SITE", paymentMethod: "Dinheiro", motoboyId: "mb1",
  totalAmount: 58, deliveryFee: 8, motoboyFee: 6, discountTotal: null, discountIfood: null, discountMerchant: null,
  items: [{ price: 50, quantity: 1 }],
}, { tipo: "percent", valor: 100, motivo: "Cortesia da casa" });
ok(
  cortesia.totalAmount === 0 && cortesia.discountTotal === 58 && cortesia.discountMerchant === 58 && cortesia.deliveryFee === 8 && cortesia.motoboyFee === 6,
  "gravado: total 0, desconto 58 (loja), taxa 8 e repasse 6 intocados",
  cortesia,
);

const rc = apurarVendasDoTurno([cortesia, site], []);
ok(Math.abs(rc.expected.cash - 62) < 0.005 && Math.abs(rc.expected.total - 62) < 0.005, "gaveta espera só os 62 do outro pedido: a cortesia não cobra nada", rc.expected);
const dc = rc.retrato.porTipo.find((b) => b.chave === "DELIVERY")!;
console.log("Bloco Delivery:", JSON.stringify({ valor: dc.valor, produtos: dc.produtos, taxa: dc.taxaDeEntrega, desconto: dc.desconto, ajustes: dc.ajustes }));
ok(
  dc.produtos === 110 && dc.taxaDeEntrega.valor === 15 && dc.desconto.valor === 63 && dc.ajustes === 0 && dc.valor === 62,
  "bloco fecha: produtos 110 + taxa 15 − desconto 63 = 62, sem ajuste e sem nada negativo",
  dc,
);
const corrida = rc.entregasProprias.find((e) => e.motoboyId === "mb1");
ok(corrida?.pedido.deliveryFee === 8 && corrida?.pedido.motoboyFee === 6, "o fechamento leva a corrida com a taxa cheia ao acerto do motoboy", corrida);
ok(ganhoDoPedido({ acerto: lerAcerto({ paymentType: "PER_DELIVERY", perDeliveryRate: 5 }), pedido: corrida!.pedido }).valor === 6, "o motoboy recebe os mesmos R$ 6 gravados");
ok(partesDaEntrega(cortesia).reduce((s, p) => s + dinheiroDaParte(p), 0) === 0, "o motoboy não traz dinheiro dessa entrega");

// Os relatórios: itens + entrega − desconto = total, sem linha negativa.
const paraRelatorio = (o: any) => ({ ...o, franchiseeId: "loja", status: "ENTREGUE" });
const vendas = resumoDeVendas([paraRelatorio(cortesia), paraRelatorio(site)]);
console.log("Vendas por período:", JSON.stringify({ total: vendas.totalPedidos, itens: vendas.totalItens, taxa: vendas.taxaEntrega, descontos: vendas.descontos, outras: vendas.outrasTaxas }));
ok(
  vendas.totalPedidos === 62 && vendas.totalItens === 110 && vendas.taxaEntrega.valor === 15 && vendas.descontos.total === 63 && vendas.descontos.loja === 63 && vendas.outrasTaxas.valor === 0,
  "Vendas por período: 110 + 15 − 63 = 62, sem 'outras taxas'",
  vendas,
);
ok(outrasTaxasDoPedido(paraRelatorio(cortesia)) === 0, "a cortesia sozinha não sobra em 'outras taxas'");
const hoje = new Date().toISOString().slice(0, 10);
const fat = faturamentoPorDia({ de: hoje, ate: hoje, hoje, tz: "UTC", pedidos: [paraRelatorio(cortesia), paraRelatorio(site)] });
const dia = fat.dias.find((d) => d.dia === hoje)!;
console.log("Faturamento por dia:", JSON.stringify({ valor: dia.valor, itens: dia.itens, entrega: dia.entrega, descontos: dia.descontos, outros: dia.outros }));
ok(dia.valor === 62 && dia.itens === 110 && dia.entrega === 15 && dia.descontos === 63 && dia.outros === 0, "Faturamento por dia: fecha no dia, sem 'outros'", dia);
const noRelatorioDeDescontos = descontoDoPedidoNoRelatorio(paraRelatorio(cortesia));
ok(noRelatorioDeDescontos.total === 58 && noRelatorioDeDescontos.loja === 58 && noRelatorioDeDescontos.plataforma === 0, "Cupons e descontos: R$ 58 do bolso da loja", noRelatorioDeDescontos);
const conta = contaDoPedido(cortesia);
ok(conta.subtotal === 50 && conta.taxaEntrega === 8 && conta.total === 0 && conta.ajustes.length === 1 && conta.ajustes[0].valor === -58, "comanda: Subtotal 50 · Desconto −58 · Entrega 8 · Total 0", conta);

console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo");
process.exit(falhas ? 1 : 0);
