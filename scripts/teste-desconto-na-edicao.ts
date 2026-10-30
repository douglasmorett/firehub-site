// Desconto dado na aba Editar itens (lib/edicao-de-pedido.ts): a conta e quem pode.
//   npx tsx scripts/teste-desconto-na-edicao.ts
import { avaliarEdicao, contaDoDescontoDaEdicao, descontoNaEdicao, PORCENTAGEM_VALE_SOBRE_A_ENTREGA } from "../src/lib/edicao-de-pedido";
import { notaDoDesconto } from "../src/lib/desconto-manual";
import { ganhoDoPedido, lerAcerto, taxaDaCorrida } from "../src/lib/ganho-do-entregador";

let falhas = 0;
const ok = (cond: boolean, nome: string, detalhe?: unknown) => {
  if (!cond) falhas++;
  console.log(`${cond ? "✓" : "✗"} ${nome}${cond ? "" : ` → ${JSON.stringify(detalhe)}`}`);
};
const dono = { role: "FRANCHISEE" };

// A tela do print: iFood, cobrar na entrega, 1x Monte seu Combo R$ 59,90, total R$ 48,89.
const ifoodNaEntrega = {
  status: "ACEITO", source: "IFOOD", ifoodOrderId: "x", deliveryType: "DELIVERY",
  paymentMethod: "Crédito (Cobrar na Entrega)",
};
const av1 = avaliarEdicao(ifoodNaEntrega, dono);
ok(descontoNaEdicao(ifoodNaEntrega, av1).pode === true, "iFood cobrado na entrega: pode dar desconto", av1);

const c1 = contaDoDescontoDaEdicao({
  itens: [{ price: 59.9, quantity: 1 }], discountTotal: 11.01, deliveryFee: 0,
  desconto: { tipo: "percent", valor: 10, motivo: "Pedido atrasado" },
});
// base = 59,90 − 11,01 = 48,89; 10% = 4,89; total 44,00
ok(c1.base === 48.89 && c1.valor === 4.89 && c1.discountTotal === 15.9 && c1.total === 44, "10% sobre o que o cliente ia pagar pelos itens", c1);

const c2 = contaDoDescontoDaEdicao({
  itens: [{ price: 30, quantity: 2 }], discountTotal: 0, deliveryFee: 7,
  desconto: { tipo: "valor", valor: 5, motivo: "" },
});
ok(c2.valor === 5 && c2.total === 62 && c2.naEntrega === 0, "R$ 5 fora; a taxa de entrega fica de pé", c2);

// ── Desde 30/10/2026 o desconto vai até itens + entrega (cortesia da Annalu) ──
ok(PORCENTAGEM_VALE_SOBRE_A_ENTREGA === true, "a % vale sobre itens + entrega (decisão de 30/10/2026)");

const c3 = contaDoDescontoDaEdicao({
  itens: [{ price: 20, quantity: 1 }], discountTotal: 0, deliveryFee: 5,
  desconto: { tipo: "valor", valor: 25.01, motivo: "" },
});
ok(!!c3.problema && c3.valor === 0 && c3.total === 25, "R$ acima de itens + entrega é recusado", c3);

const c3b = contaDoDescontoDaEdicao({
  itens: [{ price: 20, quantity: 1 }], discountTotal: 0, deliveryFee: 5,
  desconto: { tipo: "valor", valor: 25, motivo: "" },
});
ok(!c3b.problema && c3b.valor === 25 && c3b.total === 0 && c3b.naEntrega === 5, "R$ até itens + entrega passa: total 0, R$ 5 na entrega", c3b);

const c3c = contaDoDescontoDaEdicao({
  itens: [{ price: 20, quantity: 1 }], discountTotal: 0, deliveryFee: 5,
  desconto: { tipo: "valor", valor: 22, motivo: "" },
});
ok(c3c.valor === 22 && c3c.total === 3 && c3c.naEntrega === 2, "R$ 22 sobre itens de 20: R$ 2 caem na entrega, cliente paga 3", c3c);

// A Karen (Annalu): pizza de 50 + entrega de 8, cortesia completa.
const karen = contaDoDescontoDaEdicao({
  itens: [{ price: 50, quantity: 1 }], discountTotal: 0, deliveryFee: 8,
  desconto: { tipo: "percent", valor: 100, motivo: "Cortesia da casa" },
});
ok(
  karen.base === 58 && karen.baseComEntrega && karen.valor === 58 && karen.discountTotal === 58 && karen.naEntrega === 8 && karen.total === 0,
  "100% zera itens + entrega: total R$ 0,00",
  karen,
);
ok(notaDoDesconto({ tipo: "percent", valor: 100, motivo: "Cortesia da casa" }, karen.base) === "[Desconto: 100% (R$ 58,00) — Cortesia da casa]",
  "a observação/comanda diz os R$ 58,00 que a rota grava", notaDoDesconto({ tipo: "percent", valor: 100, motivo: "Cortesia da casa" }, karen.base));

// 100% com cupom antigo: zera o que o cliente ainda pagaria.
const comCupom = contaDoDescontoDaEdicao({
  itens: [{ price: 59.9, quantity: 1 }], discountTotal: 10, deliveryFee: 5,
  desconto: { tipo: "percent", valor: 100, motivo: "" },
});
ok(comCupom.base === 54.9 && comCupom.valor === 54.9 && comCupom.discountTotal === 64.9 && comCupom.total === 0, "100% com cupom de 10: abate os 54,90 que faltavam", comCupom);

// A % agora é sobre itens + entrega: 10% de 60 + 7 = 6,70.
const dez = contaDoDescontoDaEdicao({
  itens: [{ price: 30, quantity: 2 }], discountTotal: 0, deliveryFee: 7,
  desconto: { tipo: "percent", valor: 10, motivo: "" },
});
ok(dez.base === 67 && dez.valor === 6.7 && dez.total === 60.3 && dez.naEntrega === 0, "10% sobre itens + entrega (67 → 6,70)", dez);

// O acréscimo no crédito fica fora do teto e de pé.
const comAcrescimo = contaDoDescontoDaEdicao({
  itens: [{ price: 74.9, quantity: 1 }], discountTotal: 0, deliveryFee: 5.1, acrescimo: 3.09,
  desconto: { tipo: "percent", valor: 100, motivo: "" },
});
ok(comAcrescimo.valor === 80 && comAcrescimo.total === 3.09, "100% no crédito: sobra só o acréscimo, como hoje", comAcrescimo);

// Pedido já de graça: nada mais a descontar.
const jaZerado = contaDoDescontoDaEdicao({
  itens: [{ price: 50, quantity: 1 }], discountTotal: 58, deliveryFee: 8,
  desconto: { tipo: "percent", valor: 10, motivo: "" },
});
ok(jaZerado.valor === 0 && jaZerado.total === 0, "pedido já com 100%: não desconta mais nada", jaZerado);

// O motoboy não perde nada: a taxa do pedido continua a mesma, e o ganho sai dela.
const pedidoDaKaren = { deliveryFee: 8, motoboyFee: null, deliveryDistance: null, totalAmount: 58, discountTotal: 0 };
const depoisDaCortesia = { ...pedidoDaKaren, totalAmount: karen.total, discountTotal: karen.discountTotal };
const acerto = lerAcerto({ paymentType: "DAILY_PLUS_FEE", dailyRate: 50 });
ok(
  taxaDaCorrida(depoisDaCortesia) === 8 && ganhoDoPedido({ acerto, pedido: depoisDaCortesia }).valor === ganhoDoPedido({ acerto, pedido: pedidoDaKaren }).valor,
  "o repasse do motoboy não muda com a cortesia (taxa cheia, R$ 8)",
  ganhoDoPedido({ acerto, pedido: depoisDaCortesia }),
);
const comRepasseGravado = { ...depoisDaCortesia, motoboyFee: 6 };
ok(ganhoDoPedido({ acerto: lerAcerto({ paymentType: "PER_DELIVERY", perDeliveryRate: 5 }), pedido: comRepasseGravado }).valor === 6, "repasse gravado no pedido continua valendo");

const c4 = contaDoDescontoDaEdicao({
  itens: [{ price: 20, quantity: 1 }], discountTotal: 0, deliveryFee: 0,
  desconto: { tipo: "percent", valor: 150, motivo: "" },
});
ok(!!c4.problema, "mais de 100% é recusado", c4);

const ifoodPago = { ...ifoodNaEntrega, paymentMethod: "iFood (Pago Online)" };
const r2 = descontoNaEdicao(ifoodPago, avaliarEdicao(ifoodPago, dono));
ok(r2.pode === false && /já pagou no iFood/.test((r2 as any).motivo), "iFood pago no app: sem desconto, com o motivo", r2);

const sitePix = { status: "ACEITO", source: "SITE", deliveryType: "DELIVERY", paymentMethod: "Pix", gatewayPaymentId: "pay_1" };
const r3 = descontoNaEdicao(sitePix, avaliarEdicao(sitePix, dono));
ok(r3.pode === false && /pagou online/.test((r3 as any).motivo), "site pago no Pix online: sem desconto", r3);

const siteDinheiro = { status: "ACEITO", source: "SITE", deliveryType: "DELIVERY", paymentMethod: "Dinheiro" };
ok(descontoNaEdicao(siteDinheiro, avaliarEdicao(siteDinheiro, dono)).pode === true, "site em dinheiro: pode");

const dividido = { ...siteDinheiro, paymentMethods: [{ method: "Pix", amount: 20 }, { method: "Dinheiro", amount: 30 }] };
const r5 = descontoNaEdicao(dividido, avaliarEdicao(dividido, dono));
ok(r5.pode === false && /dividido/.test((r5 as any).motivo), "pagamento dividido: refaz a divisão depois", r5);

const funcionario = { role: "STAFF", permissions: "" };
ok(descontoNaEdicao(siteDinheiro, avaliarEdicao(siteDinheiro, funcionario)).pode === false, "funcionário sem permissão de editar: sem desconto");

console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo");
process.exit(falhas ? 1 : 0);
