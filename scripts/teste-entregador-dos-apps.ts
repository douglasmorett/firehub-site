/**
 * Regras puras do "Chamar entregador" (lib/entregador-ifood-no-pedido.ts +
 * montarPedido de lib/ifood-shipping.ts). Sem banco nem rede.
 *
 *   node node_modules/jiti/lib/jiti-cli.mjs scripts/teste-entregador-dos-apps.ts
 */
import assert from "node:assert/strict";
import {
  motivoParaNaoChamar, ehDa99ComEntregaDaLoja, telefoneParaIfood, pagamentoParaIfood, entradaDoPedido,
} from "../src/lib/entregador-ifood-no-pedido";
import { montarPedido } from "../src/lib/ifood-shipping";

let ok = 0;
const caso = (nome: string, f: () => void) => { f(); ok++; console.log("✓", nome); };

const site = { deliveryType: "DELIVERY", source: "ONLINE", status: "PREPARANDO" };

caso("pedido do site em preparo pode chamar", () => assert.equal(motivoParaNaoChamar(site), null));
caso("retirada não chama", () => assert.ok(motivoParaNaoChamar({ ...site, deliveryType: "RETIRADA" })));
caso("já saiu não chama", () => assert.ok(motivoParaNaoChamar({ ...site, status: "SAIU_ENTREGA" })));
caso("cancelado não chama", () => assert.ok(motivoParaNaoChamar({ ...site, status: "CANCELADO" })));
caso("com motoboy da loja não chama", () => assert.ok(motivoParaNaoChamar({ ...site, motoboyId: "m1" })));
caso("já chamado (iFood) não chama de novo", () => assert.ok(motivoParaNaoChamar({ ...site, deliveryBy: "IFOOD", ifoodDriverStatus: "REQUESTED" })));
caso("pedido do iFood não chama", () => assert.ok(motivoParaNaoChamar({ ...site, source: "IFOOD", ifoodOrderId: "x" })));
caso("pedido da Keeta não chama", () => assert.ok(motivoParaNaoChamar({ ...site, source: "KEETA" })));
caso("pedido da 99 entregue pela 99 não chama", () => assert.ok(motivoParaNaoChamar({ ...site, source: "99FOOD", deliveryBy: "99FOOD" })));
caso("pedido da 99 com entrega da loja chama", () => {
  const p = { ...site, source: "99FOOD", openDeliveryChannel: "99FOOD", deliveryBy: "MERCHANT" };
  assert.equal(motivoParaNaoChamar(p), null);
  assert.equal(ehDa99ComEntregaDaLoja(p), true);
});
caso("pedido da 99 com corrida chamada não chama de novo", () =>
  assert.ok(motivoParaNaoChamar({ ...site, source: "99FOOD", deliveryBy: "99FOOD", ifoodDriverStatus: "REQUESTED" })));

caso("telefone com 55 e 9 dígitos", () => assert.deepEqual(telefoneParaIfood("+55 (22) 99885-1680"), { ddd: "22", numero: "998851680" }));
caso("telefone fixo com DDD", () => assert.deepEqual(telefoneParaIfood("2226431234"), { ddd: "22", numero: "26431234" }));
caso("telefone sem DDD é recusado", () => assert.equal(telefoneParaIfood("998851680"), null));

const cot = { paymentMethods: [{ method: "CREDIT", brand: "MASTERCARD" }, { method: "DEBIT", brand: "ELO" }] };
caso("dinheiro com troco", () => assert.deepEqual(pagamentoParaIfood({ paymentMethod: "Dinheiro", totalAmount: 71.9, changeAmount: 100, deliveryType: "DELIVERY" }, cot), { metodo: "CASH", trocoPara: 100 }));
caso("débito na entrega usa a bandeira aceita", () => assert.deepEqual(pagamentoParaIfood({ paymentMethod: "Cartão Débito", totalAmount: 50, deliveryType: "DELIVERY" }, cot), { metodo: "DEBIT", bandeira: "ELO" }));
caso("crédito na entrega", () => assert.deepEqual(pagamentoParaIfood({ paymentMethod: "Cartão Crédito", totalAmount: 50, deliveryType: "DELIVERY" }, cot), { metodo: "CREDIT", bandeira: "MASTERCARD" }));
caso("Pix pago online não cobra na porta", () => assert.equal((pagamentoParaIfood({ paymentMethod: "Pix (Pago Online)", totalAmount: 50, deliveryType: "DELIVERY" }, cot) as any).metodo, "ONLINE"));

const endereco = {
  postalCode: "01304-001", streetName: "Rua Augusta", streetNumber: "1500", neighborhood: "Consolação",
  city: "São Paulo", state: "SP", latitude: -23.5567, longitude: -46.6607,
};
caso("o iFood recebe exatamente o total do pedido (itens + taxa)", () => {
  const e = entradaDoPedido({ id: "abc123", totalAmount: 71.9, deliveryFee: 7, customerName: "Juliana", customerPhone: "11987654321", dailyOrderNumber: 31 },
    endereco, { metodo: "CASH", trocoPara: 100 }, "q1");
  const corpo = montarPedido(e);
  assert.equal(corpo.total, 71.9);
  assert.equal(corpo.delivery.merchantFee, 7);
  assert.equal(corpo.items[0].totalPrice, 64.9);
  assert.equal(corpo.payments.methods[0].value, 71.9);
  assert.equal(corpo.payments.methods[0].cash.changeFor, 100);
});
caso("centavos não estouram (0,1 + 0,2)", () => {
  const corpo = montarPedido(entradaDoPedido({ id: "x", totalAmount: 30.3, deliveryFee: 0.1, customerPhone: "11987654321" },
    endereco, { metodo: "CREDIT", bandeira: "VISA" }, "q"));
  assert.equal(corpo.total, 30.3);
});
caso("troco menor que o total é recusado", () => assert.throws(() =>
  montarPedido(entradaDoPedido({ id: "x", totalAmount: 80, deliveryFee: 5, customerPhone: "11987654321" }, endereco, { metodo: "CASH", trocoPara: 50 }, "q"))));
caso("sem CEP é recusado antes de ir ao iFood", () => assert.throws(() =>
  montarPedido(entradaDoPedido({ id: "x", totalAmount: 40, customerPhone: "11987654321" }, { ...endereco, postalCode: "" }, { metodo: "CASH" }, "q"))));
caso("pago online vai como ONLINE com o valor total", () => {
  const corpo = montarPedido(entradaDoPedido({ id: "x", totalAmount: 97.9, deliveryFee: 8, customerPhone: "11965432109" },
    endereco, { metodo: "ONLINE", bandeira: "VISA" }, "q"));
  assert.equal(corpo.payments.methods[0].type, "ONLINE");
  assert.equal(corpo.payments.methods[0].value, 97.9);
});

console.log(`\n${ok} casos ok`);
