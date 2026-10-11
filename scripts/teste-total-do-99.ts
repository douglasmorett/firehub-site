/**
 * Trava o TOTAL do pedido do 99Food (lib/food99-pedido.ts): o que o cliente
 * pagou, quanto a loja recebe e a forma de pagamento desconhecida.
 *
 *   npx tsx scripts/teste-total-do-99.ts
 *
 * ── O que estava errado (auditoria de 11/10/2026) ───────────────────────────
 *
 * O `order/detail` do 99 NÃO manda `real_pay_price` quando quem entrega é o
 * motoboy do 99: faltou em 328 de 328 pedidos de entrega do 99, e veio em 500
 * de 500 de entrega da loja. Sem ele o tradutor caía em `order_price` — os
 * itens CHEIOS, sem desconto, sem entrega e sem taxa do app. O caixa, que soma
 * `totalAmount` + a parte do 99, contava o subsídio do 99 duas vezes; na
 * semana de 05/10 foram 177 dos 349 pedidos do 99 e R$ 4.416,78 a mais no
 * valor vendido.
 *
 * Os `price` e `promotions` abaixo são os de pedidos REAIS, copiados do
 * `discountDetails.precoCru`/`promocoes` gravados (só números: nenhum dado do
 * cliente). Função pura, sem banco.
 */
import {
  descontoDoPreco99, formaDePagamento99, taxasDoCliente99, totalPagoDoPreco99, traduzirPedido99Food,
} from "../src/lib/food99-pedido";
import { formaDoTexto } from "../src/lib/relatorios/formas-de-pagamento";
import { formaDaNota } from "../src/lib/fiscal-emissao";
import { apurarVendasDoTurno } from "../src/lib/apuracao-do-turno";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};
const r2 = (n: number) => Math.round(n * 100) / 100;

// O tradutor avisa no log quando falta coordenada ou código de coleta — aqui
// os pedidos só têm o preço, e o aviso só polui a saída do teste.
const avisoOriginal = console.warn;
const traduzir = (order: Record<string, unknown>) => {
  console.warn = () => {};
  try { return traduzirPedido99Food(order); } finally { console.warn = avisoOriginal; }
};
/** O mesmo `price` sem os campos de total — como chega no pedido entregue pelo 99. */
const semTotal = (price: Record<string, unknown>) => {
  const { real_pay_price: _a, customer_need_paying_money: _b, real_price: _c, delivery_price: _d, ...resto } = price;
  return resto;
};
/** A conta da nota: itens − desconto + entrega + taxa do app + complemento do mínimo. */
const contaDaNota = (price: Record<string, unknown>, p: ReturnType<typeof traduzirPedido99Food>) =>
  r2(Number(price.order_price) / 100 - p.descontos.total + p.taxaEntrega + p.descontos.taxaServico + p.descontos.complementoMinimo);

// ── 1. O pedido entregue pelo 99, sem real_pay_price ─────────────────────────
console.log("\n1) Entregue pelo motoboy do 99: o 99 não manda o total");
// Brazza Burguer, 11/10/2026 (cmv3axi01020trq013j1ullg6): R$ 39,80 de itens,
// R$ 15,92 de cupom do 99, frete de R$ 5,99 grátis (R$ 4 da loja, R$ 1,99 do
// 99) e R$ 1,32 de taxa do app. Gravou R$ 39,80; o cliente pagou R$ 25,20.
const BRAZZA = {
  order_id: "brazza", delivery_type: 1, pay_type: 1,
  price: { order_price: 3980, others_fees: { service_price: 132, meal_top_up_price: 0 }, refund_price: 0, items_discount: 1592, delivery_discount: 599, in_sale_refund_to_c_fee: 0, store_charged_delivery_price: 599 },
  promotions: [{ promo_type: 11, promo_discount: 1592, shop_subside_price: 0 }, { promo_type: 3, promo_discount: 599, shop_subside_price: 400 }],
};
const brazza = traduzir(BRAZZA);
confere("total = o que o cliente pagou: R$ 25,20 (antes: R$ 39,80, os itens cheios)", brazza.total, 25.2);
confere("…montado pelas partes, e o pedido diz isso", brazza.descontos.totalCalculado, true);
confere("entrega cobrada R$ 5,99; desconto R$ 21,91 = loja 4,00 + 99Food 17,91",
  [brazza.taxaEntrega, brazza.descontos.total, brazza.descontos.loja, brazza.descontos.plataforma], [5.99, 21.91, 4, 17.91]);
confere("a loja recebe R$ 41,79 = pago 25,20 + 99Food 17,91 − taxa do app 1,32 (antes: R$ 56,39)", brazza.descontos.recebeLoja, 41.79);
confere("…que é itens 39,80 + entrega 5,99 − a parte da loja 4,00", r2(39.8 + 5.99 - 4), brazza.descontos.recebeLoja);
confere("a nota fecha: 39,80 − 21,91 + 5,99 + 1,32 = 25,20", contaDaNota(BRAZZA.price, brazza), brazza.total);

// O caixa soma totalAmount + a parte do 99 na linha "99Food (Pago Online)".
const pedidoDoCaixa = (p: ReturnType<typeof traduzirPedido99Food>) => ({
  id: "c1", status: "ENTREGUE", source: "99FOOD", openDeliveryChannel: "99FOOD", deliveryType: "DELIVERY",
  paymentMethod: p.pagamento.texto, totalAmount: p.total, deliveryFee: p.taxaEntrega,
  discountTotal: p.descontos.total, discountMerchant: p.descontos.loja, discountIfood: p.descontos.plataforma,
  discountDetails: { ...p.descontos, precoCru: BRAZZA.price }, createdAt: new Date("2026-10-11T04:07:00Z"), items: [],
});
const caixa = apurarVendasDoTurno([pedidoDoCaixa(brazza)], []);
confere("caixa: a linha do 99 soma o que o cliente pagou + o cupom do 99 uma vez só (25,20 + 17,91; antes 39,80 + 17,91 = 57,71)",
  r2(caixa.expected.food99Online), 43.11);

// ── 2. A conta montada é a mesma do real_pay_price ───────────────────────────
console.log("\n2) Nos pedidos que trazem real_pay_price, a conta montada dá o mesmo número");
// Entrega da loja: o 99 manda o total. Tirando os campos de total do mesmo
// `price`, a conta pelas partes tem de chegar ao mesmo centavo — foi assim em
// 500 de 500 pedidos do banco (scratch da auditoria de 11/10/2026).
const COM_TOTAL: [string, Record<string, unknown>, unknown[], number][] = [
  // Frangoso - Trindade, 11/10/2026: promoção da loja nos itens e no frete.
  ["Frangoso: promoção da loja (itens 9,00 + frete 10,00)",
    { real_price: 7172, order_price: 7698, others_fees: { service_price: 374, coupon_discount: 1900, total_tip_money: 0, meal_top_up_price: 0, small_order_price: 0 }, refund_price: 0, delivery_price: 0, items_discount: 900, real_pay_price: 7172, delivery_discount: 1000, in_sale_refund_to_c_fee: 0, customer_need_paying_money: 7172, store_charged_delivery_price: 1000 },
    [{ promo_type: 2, promo_discount: 900, shop_subside_price: 900 }, { promo_type: 3, promo_discount: 1000, shop_subside_price: 1000 }], 71.72],
  // Dugaburguer, 11/10/2026: cupom de R$ 30 pago pelo 99.
  ["Dugaburguer: cupom de R$ 30 do 99",
    { real_price: 8149, order_price: 7880, others_fees: { service_price: 269, coupon_discount: 0, total_tip_money: 0, meal_top_up_price: 0, small_order_price: 0 }, refund_price: 0, delivery_price: 0, items_discount: 3000, real_pay_price: 5149, delivery_discount: 0, in_sale_refund_to_c_fee: 0, customer_need_paying_money: 5149, store_charged_delivery_price: 0 },
    [{ promo_type: 11, promo_discount: 3000, shop_subside_price: 0 }], 51.49],
  // Map Grill, 11/10/2026: entrega cobrada (R$ 5,00) sem desconto no frete.
  ["Map Grill: frete cobrado de R$ 5,00",
    { real_price: 3665, order_price: 6000, others_fees: { service_price: 165, coupon_discount: 3000, total_tip_money: 0, meal_top_up_price: 0, small_order_price: 0 }, refund_price: 0, delivery_price: 500, items_discount: 3000, real_pay_price: 3665, delivery_discount: 0, in_sale_refund_to_c_fee: 0, customer_need_paying_money: 3665, store_charged_delivery_price: 500 },
    [{ promo_type: 4, promo_discount: 3000, shop_subside_price: 3000 }], 36.65],
];
for (const [nome, price, promotions, pago] of COM_TOTAL) {
  const com = traduzir({ order_id: nome, price, promotions });
  const sem = traduzir({ order_id: nome, price: semTotal(price), promotions });
  confere(`${nome}: R$ ${pago.toFixed(2).replace(".", ",")} com o total do 99 e montado sem ele`, [com.total, sem.total, com.descontos.totalCalculado, sem.descontos.totalCalculado], [pago, pago, false, true]);
  confere(`${nome}: a mesma divisão e o mesmo "a loja recebe" nos dois`,
    [sem.descontos.loja, sem.descontos.plataforma, sem.descontos.recebeLoja], [com.descontos.loja, com.descontos.plataforma, com.descontos.recebeLoja]);
}
confere("others_fees.coupon_discount (a parte da LOJA nas promoções) não desconta de novo: Frangoso tem 19,00 lá e 19,00 nos campos",
  descontoDoPreco99(COM_TOTAL[0][1], COM_TOTAL[0][2]), 1900);
confere("real_price NÃO é o pago: Dugaburguer sem real_pay_price, só com real_price (R$ 81,49), dá R$ 51,49",
  totalPagoDoPreco99({ ...semTotal(COM_TOTAL[1][1]), real_price: 8149 }, COM_TOTAL[1][2]), { centavos: 5149, calculado: true });

// ── 3. O complemento do pedido mínimo ────────────────────────────────────────
console.log("\n3) O complemento do pedido mínimo (meal_top_up_price) é dinheiro do cliente");
// Showrrascão, 03/10/2026: itens R$ 24,90, mínimo R$ 29,00 → complemento
// R$ 4,10. Sem ele a conta dava R$ 21,02 e o 99 dizia R$ 25,12 — eram os
// R$ 23,90 de diferença da Showrrascão no mês (7 pedidos). Os R$ 2,13 da NIK
// são R$ 2,30 de complemento (1 pedido) menos os R$ 0,17 da seção 4.
const SHOWRRASCAO = { real_price: 2512, order_price: 2490, others_fees: { service_price: 110, coupon_discount: 998, total_tip_money: 0, meal_top_up_price: 410, small_order_price: 0 }, refund_price: 0, delivery_price: 0, items_discount: 498, real_pay_price: 2512, delivery_discount: 500, in_sale_refund_to_c_fee: 0, customer_need_paying_money: 2512, store_charged_delivery_price: 500 };
const PROMO_SHOW = [{ promo_type: 2, promo_discount: 498, shop_subside_price: 498 }, { promo_type: 3, promo_discount: 500, shop_subside_price: 500 }];
const show = traduzir({ order_id: "show", price: semTotal(SHOWRRASCAO), promotions: PROMO_SHOW });
confere("Showrrascão: R$ 25,12 montado, igual ao real_pay_price", show.total, 25.12);
confere("…com o complemento de R$ 4,10 guardado no pedido", show.descontos.complementoMinimo, 4.1);
confere("…e a nota fecha com ele: 24,90 − 9,98 + 5,00 + 1,10 + 4,10 = 25,12", contaDaNota(SHOWRRASCAO, show), 25.12);
confere("sem o complemento seria R$ 21,02 (a conta da auditoria)", r2(show.total - taxasDoCliente99(SHOWRRASCAO).complementoMinimo / 100), 21.02);
// Pizzaria 17, 06/10/2026, entregue pelo 99: itens R$ 39,90 + R$ 10,10 até o
// mínimo de R$ 50,00; cupom do 99 R$ 12,00; frete R$ 3,49 grátis. Gravou
// R$ 39,90 (os itens); o cliente pagou R$ 39,54.
const P17 = traduzir({
  order_id: "p17", delivery_type: 1,
  price: { order_price: 3990, others_fees: { service_price: 154, meal_top_up_price: 1010 }, refund_price: 0, items_discount: 1200, delivery_discount: 349, in_sale_refund_to_c_fee: 0, store_charged_delivery_price: 349 },
  promotions: [{ promo_type: 11, promo_discount: 1200, shop_subside_price: 0 }, { promo_type: 3, promo_discount: 349, shop_subside_price: 349 }],
});
confere("Pizzaria 17 entregue pelo 99, com complemento: R$ 39,54 (antes R$ 39,90)", P17.total, 39.54);
confere("…a loja recebe R$ 50,00 − frete grátis dela 3,49 + frete 3,49 = R$ 50,00 (antes R$ 50,36)", P17.descontos.recebeLoja, 50);

// ── 4. O cupom do 99 que passa dos itens ─────────────────────────────────────
console.log("\n4) Promoção maior que os campos de desconto: vale a soma das promoções");
// NIK, 26/09/2026: items_discount R$ 24,83, promoções do 99 de 20,00 + 5,00.
// O cliente pagou R$ 195,29 = 213,30 + 6,99 − 25,00. Era o único pedido (de
// 828) em que os campos e as promoções discordam — os outros R$ 0,17 da NIK.
const NIK = { real_price: 22029, order_price: 21330, others_fees: { service_price: 699, coupon_discount: 0, total_tip_money: 0, meal_top_up_price: 0, small_order_price: 0 }, refund_price: 0, delivery_price: 0, items_discount: 2483, real_pay_price: 19529, delivery_discount: 0, in_sale_refund_to_c_fee: 0, customer_need_paying_money: 19529, store_charged_delivery_price: 0 };
const PROMO_NIK = [{ promo_type: 11, promo_discount: 2000, shop_subside_price: 0 }, { promo_type: 1000, promo_discount: 500, shop_subside_price: 0 }];
const nik = traduzir({ order_id: "nik", price: NIK, promotions: PROMO_NIK });
const nikSem = traduzir({ order_id: "nik", price: semTotal(NIK), promotions: PROMO_NIK });
confere("total R$ 195,29 com e sem o real_pay_price", [nik.total, nikSem.total], [195.29, 195.29]);
confere("desconto R$ 25,00 (antes R$ 24,83), todo do 99, e loja + 99 = desconto",
  [nik.descontos.total, nik.descontos.loja, nik.descontos.plataforma], [25, 0, 25]);
confere("a nota fecha: 213,30 − 25,00 + 6,99 = 195,29 (com 24,83 sobravam R$ 0,17)", contaDaNota(NIK, nik), 195.29);

// ── 5. Sem preço nenhum, e o pedido antigo do teste do cupom ─────────────────
console.log("\n5) Bordas");
confere("sem order_price nem total: zero, não NaN", totalPagoDoPreco99({}, []), { centavos: 0, calculado: false });
confere("customer_need_paying_money serve quando só ele vem", totalPagoDoPreco99({ customer_need_paying_money: 1234, order_price: 9999 }, []), { centavos: 1234, calculado: false });
confere("desconto maior que os itens não deixa total negativo", totalPagoDoPreco99({ order_price: 1000, items_discount: 5000 }, []).centavos, 0);

// ── 6. A forma de pagamento que o 99 não informou ────────────────────────────
console.log("\n6) pay_type desconhecido: 'Não informado', e não 'Vale'");
// O pedido da NIK de 26/09/2026 veio com um pay_type fora de 1–4 e foi
// gravado "99Food": o "food" do nome punha o pedido no VALE do caixa e do
// relatório Formas de pagamento, e a NFC-e sairia com "99Food" como meio.
const forma = formaDePagamento99(7);
confere("tipo fora de 1–4 grava 'Não informado' (antes: '99Food')", forma, { texto: "Não informado", pagoOnline: false });
// Depois da régua única do caixa (fix/caixa-e-acerto), o "food" saiu do vale:
// até o "99Food" já gravado (o NIK de 26/09) deixa de ser vale.
confere("relatório Formas de pagamento: 'Outros / Não identificado' — inclusive o '99Food' já gravado",
  [formaDoTexto(forma.texto), formaDoTexto("99Food")], ["OUTROS", "OUTROS"]);
const nikNoCaixa = (paymentMethod: string) => apurarVendasDoTurno([{
  id: "n1", status: "ENTREGUE", source: "99FOOD", openDeliveryChannel: "99FOOD", deliveryType: "DELIVERY",
  paymentMethod, totalAmount: 195.29, discountTotal: 25, discountIfood: 25, createdAt: new Date("2026-09-26T00:29:43Z"), items: [],
}], []);
const agora = nikNoCaixa(forma.texto), antes = nikNoCaixa("99Food");
confere("caixa: fora da conferência, em 'não identificada' — nenhum vale cobrado da gaveta",
  [agora.expected.voucher, r2(agora.foraDaConferencia.naoIdentificado)], [0, 195.29]);
confere("…e o '99Food' já gravado também não cobra vale da gaveta (antes: R$ 195,29 no vale)", r2(antes.expected.voucher), 0);
confere("NFC-e: sem forma, a nota pede que a loja defina (antes: '99Food' como meio de pagamento)",
  [formaDaNota(forma.texto, { canal: "99FOOD" }), formaDaNota("99Food", { canal: "99FOOD" })?.descricao], [null, "99Food"]);
confere("as quatro formas conhecidas não mudam", [1, 2, 3, 4].map((t) => formaDePagamento99(t).texto),
  ["Pago Online (99Food)", "Dinheiro (cobrar na entrega)", "Cartão na maquininha (cobrar na entrega)", "Carteira DiDi (99Food Pago Online)"]);

console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
