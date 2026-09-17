/**
 * A conta do pedido do 99Food TEM que fechar: itens + entrega − desconto +
 * taxa de serviço = total que o cliente pagou.
 *
 * Os três casos são os PEDIDOS REAIS do Frangoso em que o lojista disse que o
 * "cupom não deduz" (17/09/2026). O `price` é o que o 99Food mandou, copiado do
 * `discountDetails.precoCru` gravado no banco. Antes da correção a nota fechava
 * R$ 4,00 / R$ 10,15 / R$ 10,99 acima do "itens − desconto", e a diferença era
 * exatamente serviço + entrega que o 99 cobrou e o FireHub não carregava.
 *
 * Função pura, sem banco.
 */
const path = require('path');
const createJiti = require('jiti');
const jiti = createJiti(__filename, { alias: { '@': path.resolve(__dirname, '..', 'src') }, interopDefault: true, esmResolve: true });
const { traduzirPedido99Food } = jiti(path.resolve(__dirname, '..', 'src', 'lib', 'food99-pedido.ts'));

let ok = 0, falhou = 0;
function conferir(nome, real, esperado, tol = 0.011) {
  const bate = typeof esperado === 'number' ? Math.abs(real - esperado) < tol : JSON.stringify(real) === JSON.stringify(esperado);
  if (bate) { ok++; console.log(`  ok   ${nome}`); }
  else { falhou++; console.log(`  FALHOU ${nome}\n         esperado: ${JSON.stringify(esperado)}\n         veio:     ${JSON.stringify(real)}`); }
}

// Item do 99: amount + total_price (linha, em centavos).
const item = (nome, qtd, unitCentavos) => ({ sku_name: nome, amount: qtd, total_price: qtd * unitCentavos, sku_price: unitCentavos });

const CASOS = [
  {
    ref: '#680001 — 1x Combo Casal 133,00; promoção de item 60,40; serviço 4,00; sem entrega',
    order: {
      order_id: '680001', order_index: 680001,
      order_items: [item('Combo Casal', 1, 13300)],
      price: { real_price: 8660, order_price: 13300, others_fees: { service_price: 400, coupon_discount: 5040 }, delivery_price: 0, items_discount: 6040, real_pay_price: 7660, delivery_discount: 0, customer_need_paying_money: 7660, store_charged_delivery_price: 0 },
    },
    total: 76.60, taxaEntrega: 0, taxaServico: 4.00, desconto: 60.40,
  },
  {
    ref: '#253001 — 3 itens 256,98; promoção 148,25 + frete 5,00; serviço 5,99; entrega 5,00',
    order: {
      order_id: '253001', order_index: 253001,
      order_items: [item('Chicken Bites Pp', 1, 1699), item('3 Cheese Bacon', 1, 18000), item('Cheeseburguer 100g', 1, 5999)],
      price: { real_price: 11972, order_price: 25698, others_fees: { service_price: 599, coupon_discount: 14825 }, delivery_price: 0, items_discount: 14825, real_pay_price: 11472, delivery_discount: 500, customer_need_paying_money: 11472, store_charged_delivery_price: 500 },
    },
    total: 114.72, taxaEntrega: 5.00, taxaServico: 5.99, desconto: 153.25,
  },
  {
    ref: '#266002 — 1x Burger+Batata+Coca 44,99; promoção 6,00 + frete 8,00; serviço 2,15; entrega 8,00',
    order: {
      order_id: '266002', order_index: 266002,
      order_items: [item('Burger + Batata Frita 150g + Coca Cola 350ml', 1, 4499)],
      price: { real_price: 4114, order_price: 4499, others_fees: { service_price: 215, coupon_discount: 1400 }, delivery_price: 0, items_discount: 600, real_pay_price: 4114, delivery_discount: 800, customer_need_paying_money: 4114, store_charged_delivery_price: 800 },
    },
    total: 41.14, taxaEntrega: 8.00, taxaServico: 2.15, desconto: 14.00,
  },
];

for (const c of CASOS) {
  console.log(`\n== ${c.ref} ==`);
  const p = traduzirPedido99Food(c.order);
  const somaItens = p.itens.reduce((s, i) => s + i.precoUnitario * i.quantidade, 0);

  conferir('total = o que o cliente pagou (real_pay_price)', p.total, c.total);
  conferir('taxa de entrega = o que a LOJA cobrou (store_charged_delivery_price)', p.taxaEntrega, c.taxaEntrega);
  conferir('taxa de serviço carregada em descontos.taxaServico', p.descontos.taxaServico, c.taxaServico);
  conferir('desconto total (promoção + frete grátis)', p.descontos.total, c.desconto);

  // A identidade que a nota do painel imprime: Subtotal − Desconto + Entrega + Serviço = Total.
  const notaFecha = somaItens - p.descontos.total + p.taxaEntrega + p.descontos.taxaServico;
  conferir(`A NOTA FECHA: ${somaItens.toFixed(2)} − ${p.descontos.total.toFixed(2)} + ${p.taxaEntrega.toFixed(2)} + ${p.descontos.taxaServico.toFixed(2)} = ${p.total.toFixed(2)}`, notaFecha, p.total);

  // E o que acontecia ANTES: sem serviço e com entrega lida do campo errado.
  const antes = somaItens - p.descontos.total + 0;
  console.log(`       (antes: ${somaItens.toFixed(2)} − ${p.descontos.total.toFixed(2)} + 0 = ${antes.toFixed(2)}, e o total dizia ${p.total.toFixed(2)} → sobrava R$ ${(p.total - antes).toFixed(2)} sem explicação)`);
}

console.log('\n== Sem taxa nenhuma, nada muda ==');
const simples = traduzirPedido99Food({ order_id: 'x', order_items: [item('Pastel', 2, 1200)], price: { real_pay_price: 2400, order_price: 2400, delivery_price: 0 } });
conferir('taxaServico = 0 quando o 99 não manda', simples.descontos.taxaServico, 0);
conferir('taxaEntrega = 0 quando não há store_charged nem delivery_price', simples.taxaEntrega, 0);
conferir('cai em delivery_price quando store_charged não vem', traduzirPedido99Food({ order_id: 'y', order_items: [item('Pastel', 1, 1200)], price: { real_pay_price: 1500, delivery_price: 300 } }).taxaEntrega, 3.00);

console.log(`\n${ok} ok, ${falhou} falharam\n`);
process.exit(falhou > 0 ? 1 : 0);
