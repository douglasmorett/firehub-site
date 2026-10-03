// Desconto dado na aba Editar itens (lib/edicao-de-pedido.ts): a conta e quem pode.
//   npx tsx scripts/teste-desconto-na-edicao.ts
import { avaliarEdicao, contaDoDescontoDaEdicao, descontoNaEdicao } from "../src/lib/edicao-de-pedido";

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
ok(c2.valor === 5 && c2.total === 62, "R$ 5 fora; a taxa de entrega fica de pé", c2);

const c3 = contaDoDescontoDaEdicao({
  itens: [{ price: 20, quantity: 1 }], discountTotal: 0, deliveryFee: 5,
  desconto: { tipo: "valor", valor: 25, motivo: "" },
});
ok(!!c3.problema && c3.valor === 0, "desconto maior que os itens é recusado (não come a taxa)", c3);

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
