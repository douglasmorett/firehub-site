/**
 * scripts/teste-open-delivery-saida.ts — o FireHub entregando pedido à logística (Bem Dito).
 *
 *   JITI_ALIAS='{"@":"<worktree>/src"}' node node_modules/jiti/lib/jiti-cli.mjs scripts/teste-open-delivery-saida.ts
 *
 * Trava, sem banco: a assinatura HMAC do webhook (vetor público), o token,
 * o pedido do /token, a URL do webhook, quem vai para a logística, o Order no
 * formato Open Delivery V1 (contas que fecham), os eventos deduzidos do pedido,
 * o corpo do acknowledgment e o plano das ações readyForPickup/dispatch/delivered.
 */
import crypto from "crypto";
import {
  assinaturaDoWebhook,
  emitirToken,
  tokenConfere,
  lerToken,
  lerPedidoDeToken,
  urlDeWebhookValida,
  gerarClientId,
  gerarClientSecret,
  gerarMerchantId,
} from "../src/lib/open-delivery-saida/credenciais";
import { pedidoNoFormatoOD, vaiParaALogistica, ultimoEventoDoStatus } from "../src/lib/open-delivery-saida/pedido";
import { eventosQueFaltam, eventoOD, lerAck, proximaTentativa } from "../src/lib/open-delivery-saida/eventos";
import { planoDaAcao } from "../src/lib/open-delivery-saida/status";

let falhas = 0;
let total = 0;
function confere(nome: string, obtido: unknown, esperado: unknown) {
  total++;
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${nome}${ok ? "" : `\n   esperado: ${JSON.stringify(esperado)}\n   obtido:   ${JSON.stringify(obtido)}`}`);
}

// ── 1. HMAC do webhook ────────────────────────────────────────────────────────
// Vetor público do HMAC-SHA256 (RFC 4231 não tem este; é o da Wikipédia/HMAC).
confere(
  "HMAC: vetor público (key / quick brown fox)",
  assinaturaDoWebhook("The quick brown fox jumps over the lazy dog", "key"),
  "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8",
);
const corpoDoEvento = JSON.stringify({ eventId: "e1", eventType: "CREATED", orderId: "o1" });
const segredoDaLoja = "a".repeat(64);
const sig = assinaturaDoWebhook(corpoDoEvento, segredoDaLoja);
confere("HMAC: hex minúsculo de 64", /^[0-9a-f]{64}$/.test(sig), true);
confere("HMAC: o parceiro confere do lado dele", crypto.createHmac("sha256", segredoDaLoja).update(corpoDoEvento).digest("hex"), sig);
confere("HMAC: muda com 1 byte do corpo", assinaturaDoWebhook(corpoDoEvento + " ", segredoDaLoja) === sig, false);

// ── 2. Credenciais e token ────────────────────────────────────────────────────
confere("client_id: prefixo fhod_", /^fhod_[0-9a-f]{20}$/.test(gerarClientId()), true);
confere("client_secret: 64 hex", /^[0-9a-f]{64}$/.test(gerarClientSecret()), true);
confere("merchantId: 36 caracteres", gerarMerchantId().length, 36);

const CHAVE = "segredo-do-servidor";
const agora = Date.UTC(2026, 9, 14, 15, 0, 0);
const { token, expiraEmS } = emitirToken(CHAVE, "integ1", "v1.c.cifrado-A", agora);
confere("token: validade 1 h", expiraEmS, 3600);
confere("token: formato od1.<id>.<exp>.<sig>", lerToken(token)?.integracaoId, "integ1");
confere("token: confere", tokenConfere(CHAVE, token, "v1.c.cifrado-A", agora + 60_000), true);
confere("token: vencido", tokenConfere(CHAVE, token, "v1.c.cifrado-A", agora + 3601_000), false);
confere("token: segredo trocado derruba", tokenConfere(CHAVE, token, "v1.c.cifrado-B", agora), false);
confere("token: outra chave do servidor", tokenConfere("outra", token, "v1.c.cifrado-A", agora), false);
const adulterado = token.replace(".integ1.", ".integ2.");
confere("token: id trocado", tokenConfere(CHAVE, adulterado, "v1.c.cifrado-A", agora), false);
confere("token: lixo", tokenConfere(CHAVE, "Bearer abc", "v1.c.cifrado-A", agora), false);

// ── 3. Pedido do /oauth/token ─────────────────────────────────────────────────
confere(
  "token: form-urlencoded",
  lerPedidoDeToken("application/x-www-form-urlencoded", "grant_type=client_credentials&client_id=fhod_1&client_secret=s%2B1", null),
  { grantType: "client_credentials", clientId: "fhod_1", clientSecret: "s+1" },
);
confere(
  "token: JSON",
  lerPedidoDeToken("application/json", JSON.stringify({ grant_type: "client_credentials", client_id: "fhod_2", client_secret: "s2" }), null),
  { grantType: "client_credentials", clientId: "fhod_2", clientSecret: "s2" },
);
confere(
  "token: Basic",
  lerPedidoDeToken("application/x-www-form-urlencoded", "grant_type=client_credentials", `Basic ${Buffer.from("fhod_3:s3").toString("base64")}`),
  { grantType: "client_credentials", clientId: "fhod_3", clientSecret: "s3" },
);

// ── 4. URL do webhook ─────────────────────────────────────────────────────────
confere("webhook: https aceito", urlDeWebhookValida("https://api.bemdito.com/api/opendelivery/webhook").ok, true);
confere("webhook: http recusado", urlDeWebhookValida("http://api.bemdito.com/x").ok, false);
confere("webhook: localhost recusado", urlDeWebhookValida("https://localhost:3000/x").ok, false);
confere("webhook: rede interna recusada", urlDeWebhookValida("https://192.168.0.10/x").ok, false);
confere("webhook: 172.20 recusado", urlDeWebhookValida("https://172.20.1.1/x").ok, false);

// ── 5. Quem vai para a logística ──────────────────────────────────────────────
const base = { id: "p", status: "NOVO", deliveryType: "DELIVERY", source: "ONLINE" };
confere("site + entrega vai", vaiParaALogistica(base), true);
confere("robô + entrega vai", vaiParaALogistica({ ...base, source: "WHATSAPP_IA" }), true);
confere("PDV + entrega vai", vaiParaALogistica({ ...base, source: "PDV" }), true);
confere("retirada não vai", vaiParaALogistica({ ...base, deliveryType: "RETIRADA" }), false);
confere("iFood não vai", vaiParaALogistica({ ...base, source: "IFOOD", ifoodOrderId: "x" }), false);
confere("99Food não vai", vaiParaALogistica({ ...base, source: "99FOOD", openDeliveryOrderId: "y", food99AppShopId: "1" }), false);
confere("Brendi não vai", vaiParaALogistica({ ...base, source: "BRENDI", openDeliveryOrderId: "z", openDeliveryChannel: "BRENDI" }), false);
confere("mesa não vai", vaiParaALogistica({ ...base, tableSessionId: "m1" }), false);
confere("acréscimo não vai", vaiParaALogistica({ ...base, parentOrderId: "pai" }), false);
confere("rascunho do robô não vai", vaiParaALogistica({ ...base, status: "CRIANDO_IA" }), false);
confere("Pix esperando não vai", vaiParaALogistica({ ...base, status: "AGUARDANDO_PAGAMENTO" }), false);
confere("entrega parceira (deliveryBy IFOOD) não vai", vaiParaALogistica({ ...base, deliveryBy: "IFOOD" }), false);

// ── 6. Order no formato Open Delivery V1 ──────────────────────────────────────
const loja = { storeName: "Hakim Centro", city: "Rio das Ostras - RJ", storeAddress: "Rua X, 10 - Centro" };
const integ = { merchantId: "11111111-2222-3333-4444-555555555555" };
const pedido1 = {
  id: "ckpedido1",
  status: "ACEITO",
  source: "ONLINE",
  deliveryType: "DELIVERY",
  dailyOrderNumber: 23,
  createdAt: new Date("2026-10-14T21:00:00Z"),
  acceptedAt: new Date("2026-10-14T21:01:00Z"),
  customerId: "cli1",
  customerName: "Maria",
  customerPhone: "(22) 99999-0000",
  customerAddress: "Rua das Casuarinas, 20 - Âncora (Apartamento 201)",
  customerLatLng: { lat: -22.52, lng: -41.94, origem: "gps" },
  tempoEntregaMin: 40,
  paymentMethod: "Dinheiro",
  changeAmount: 100,
  totalAmount: 61.3, // 2 × 24,90 + 1 × 9,90 − 5,00 + 6,60
  deliveryFee: 6.6,
  discountTotal: 5,
  discountMerchant: 5,
  notes: "Interfone quebrado",
  items: [
    { id: "i1", productName: "Pizza Calabresa", quantity: 2, price: 24.9, menuProductId: "mp1", notes: "sem cebola",
      comboSelections: { g1: { "Borda Catupiry": 1 } } },
    { id: "i2", productName: "Coca 2L", quantity: 1, price: 9.9, menuProductId: "mp2" },
    { id: "i3", productName: "Tirado na edição", quantity: 0, price: 50 },
  ],
};
const od = pedidoNoFormatoOD(pedido1, loja, integ) as any;
confere("OD: id/type/displayId", [od.id, od.type, od.displayId], ["ckpedido1", "DELIVERY", "23"]);
confere("OD: merchant", od.merchant, { id: integ.merchantId, name: "Hakim Centro" });
confere("OD: lastEvent do ACEITO", od.lastEvent, "CONFIRMED");
confere("OD: 2 itens (qtd 0 fica fora)", od.items.length, 2);
confere("OD: item 1 totalPrice", od.items[0].totalPrice, { value: 49.8, currency: "BRL" });
confere("OD: item 1 opção", od.items[0].options?.map((o: any) => [o.name, o.quantity, o.unitPrice.value]), [["Borda Catupiry", 1, 0]]);
confere("OD: item 1 observação", od.items[0].specialInstructions, "sem cebola");
confere("OD: total.itemsPrice", od.total.itemsPrice.value, 59.7);
confere("OD: total.otherFees (entrega)", od.total.otherFees.value, 6.6);
confere("OD: otherFees DELIVERY_FEE", od.otherFees.map((f: any) => [f.type, f.price.value]), [["DELIVERY_FEE", 6.6]]);
confere("OD: total.discount", od.total.discount.value, 5);
confere("OD: orderAmount = totalAmount", od.total.orderAmount.value, 61.3);
confere(
  "OD: itens + taxas − desconto = total",
  Math.round((od.total.itemsPrice.value + od.total.otherFees.value - od.total.discount.value) * 100) / 100,
  od.total.orderAmount.value,
);
confere("OD: dinheiro na porta com troco", od.payments, {
  prepaid: 0, pending: 61.3,
  methods: [{ value: 61.3, currency: "BRL", type: "PENDING", method: "CASH", methodInfo: "Dinheiro", changeFor: 100 }],
});
confere("OD: cliente", od.customer, { id: "cli1", name: "Maria", phone: { number: "22999990000" } });
confere("OD: endereço lido", [od.delivery.deliveryAddress.street, od.delivery.deliveryAddress.number, od.delivery.deliveryAddress.district, od.delivery.deliveryAddress.complement], ["Rua das Casuarinas", "20", "Âncora", "Apartamento 201"]);
confere("OD: cidade/UF da loja", [od.delivery.deliveryAddress.city, od.delivery.deliveryAddress.state], ["Rio das Ostras", "BR-RJ"]);
confere("OD: coordenadas", od.delivery.deliveryAddress.coordinates, { latitude: -22.52, longitude: -41.94 });
confere("OD: deliveredBy MERCHANT", od.delivery.deliveredBy, "MERCHANT");
confere("OD: previsão = criado + 40 min", od.delivery.estimatedDeliveryDateTime, "2026-10-14T21:40:00.000Z");
confere("OD: extraInfo", od.extraInfo, "Interfone quebrado");

// Pago pelo site (Asaas) + pedido dividido
const pedido2 = {
  ...pedido1,
  id: "ckpedido2",
  status: "SAIU_ENTREGA",
  paymentMethod: "PIX",
  gatewayProvider: "asaas",
  paymentPaidAt: new Date("2026-10-14T21:00:30Z"),
  changeAmount: null,
  notes: null,
};
const od2 = pedidoNoFormatoOD(pedido2, loja, integ) as any;
confere("OD: Pix pelo site é PREPAID/PIX", od2.payments, {
  prepaid: 61.3, pending: 0,
  methods: [{ value: 61.3, currency: "BRL", type: "PREPAID", method: "PIX", methodInfo: "PIX" }],
});
confere("OD: lastEvent do SAIU_ENTREGA", od2.lastEvent, "DISPATCHED");

const pedido3 = {
  ...pedido1,
  id: "ckpedido3",
  paymentMethod: "Dividido",
  paymentMethods: [{ method: "Pix", amount: 21.3 }, { method: "Dinheiro", amount: 40 }],
  changeAmount: 50,
};
const od3 = pedidoNoFormatoOD(pedido3, loja, integ) as any;
confere("OD: dividido parte por parte", od3.payments.methods.map((m: any) => [m.method, m.type, m.value, m.changeFor ?? null]), [
  ["PIX", "PENDING", 21.3, null],
  ["CASH", "PENDING", 40, 50],
]);
confere("OD: dividido soma o total", Math.round((od3.payments.prepaid + od3.payments.pending) * 100) / 100, 61.3);

// Taxa de serviço sem campo próprio (total maior que itens + entrega)
const od4 = pedidoNoFormatoOD({ ...pedido1, id: "p4", discountTotal: 0, discountMerchant: 0, totalAmount: 68.3 }, loja, integ) as any;
confere("OD: valor a mais vira SERVICE_FEE e a conta fecha", [od4.otherFees.map((f: any) => f.type), od4.total.discount.value,
  Math.round((od4.total.itemsPrice.value + od4.total.otherFees.value - od4.total.discount.value) * 100) / 100], [["DELIVERY_FEE", "SERVICE_FEE"], 0, 68.3]);

// Sem ponto gravado: coordenadas nulas, sem inventar
const od5 = pedidoNoFormatoOD({ ...pedido1, id: "p5", customerLatLng: null, tempoEntregaMin: null }, loja, integ) as any;
confere("OD: sem ponto → coordenadas nulas", od5.delivery.deliveryAddress.coordinates, { latitude: null, longitude: null });
confere("OD: sem tempo gravado → prazo padrão 45 min", od5.delivery.estimatedDeliveryDateTime, "2026-10-14T21:45:00.000Z");

confere("lastEvent: cancelado", ultimoEventoDoStatus("CANCELADO"), "CANCELLED");
confere("lastEvent: entregue", ultimoEventoDoStatus("ENTREGUE"), "CONCLUDED");
confere("lastEvent: pronto", ultimoEventoDoStatus("PRONTO"), "READY_FOR_PICKUP");

// ── 7. Eventos deduzidos do pedido ────────────────────────────────────────────
const t = (m: number) => new Date(Date.UTC(2026, 9, 14, 21, m));
const tipos = (l: { eventType: string }[]) => l.map((e) => e.eventType);
confere("eventos: NOVO → CREATED", tipos(eventosQueFaltam({ status: "NOVO", createdAt: t(0) }, new Set())), ["CREATED"]);
confere(
  "eventos: aceito",
  tipos(eventosQueFaltam({ status: "ACEITO", createdAt: t(0), acceptedAt: t(1) }, new Set(["CREATED"]))),
  ["CONFIRMED"],
);
confere(
  "eventos: saiu direto (sem carimbo de pronto)",
  tipos(eventosQueFaltam({ status: "SAIU_ENTREGA", createdAt: t(0), acceptedAt: t(1), dispatchedAt: t(20) }, new Set())),
  ["CREATED", "CONFIRMED", "DISPATCHED"],
);
confere(
  "eventos: entregue",
  tipos(eventosQueFaltam({ status: "ENTREGUE", createdAt: t(0), acceptedAt: t(1), readyAt: t(15), dispatchedAt: t(20), deliveredAt: t(40) },
    new Set(["CREATED", "CONFIRMED", "READY_FOR_PICKUP", "DISPATCHED"]))),
  ["DELIVERED", "CONCLUDED"],
);
confere(
  "eventos: cancelado antes de existir para a logística → nada",
  tipos(eventosQueFaltam({ status: "CANCELADO", createdAt: t(0), cancelledAt: t(0) }, new Set())),
  [],
);
confere(
  "eventos: saiu e cancelou",
  tipos(eventosQueFaltam({ status: "CANCELADO", createdAt: t(0), acceptedAt: t(1), dispatchedAt: t(20), cancelledAt: t(25) }, new Set(["CREATED", "CONFIRMED"]))),
  ["DISPATCHED", "CANCELLED"],
);
confere(
  "eventos: tudo já gerado → nada",
  tipos(eventosQueFaltam({ status: "SAIU_ENTREGA", createdAt: t(0), acceptedAt: t(1), dispatchedAt: t(20) }, new Set(["CREATED", "CONFIRMED", "DISPATCHED"]))),
  [],
);
const ordem = eventosQueFaltam({ status: "SAIU_ENTREGA", createdAt: t(5), acceptedAt: t(1), dispatchedAt: t(20) }, new Set());
confere("eventos: hora nunca volta (carimbo fora de ordem)", ordem.map((e) => e.ocorridoEm.getTime() >= t(5).getTime()), [true, true, true]);

confere(
  "evento no formato OD",
  eventoOD({ id: "ev1", orderId: "ckpedido1", eventType: "CREATED", ocorridoEm: t(0) }, "https://firehubfood.com.br/api/opendelivery"),
  {
    eventId: "ev1",
    eventType: "CREATED",
    orderId: "ckpedido1",
    orderURL: "https://firehubfood.com.br/api/opendelivery/v1/orders/ckpedido1",
    createdAt: "2026-10-14T21:00:00.000Z",
    sourceAppId: "firehub",
  },
);

// ── 8. Acknowledgment ─────────────────────────────────────────────────────────
confere("ack: lista válida", lerAck([{ id: "e1", orderId: "o1", eventType: "CREATED" }]), [{ id: "e1", orderId: "o1", eventType: "CREATED" }]);
confere("ack: aceita eventId", lerAck([{ eventId: "e2", orderId: "o1", eventType: "DISPATCHED" }])?.[0].id, "e2");
confere("ack: objeto solto é inválido", lerAck({ id: "e1" }), null);
confere("ack: item sem id é inválido", lerAck([{ orderId: "o1" }]), null);
confere("ack: lista vazia vale", lerAck([]), []);

// ── 9. Retentativa do webhook ─────────────────────────────────────────────────
const t0 = new Date(Date.UTC(2026, 9, 14, 21, 0));
confere("webhook: 1ª falha → 30 s", proximaTentativa(1, t0)?.toISOString(), "2026-10-14T21:00:30.000Z");
confere("webhook: 7ª falha → 30 min", proximaTentativa(7, t0)?.toISOString(), "2026-10-14T21:30:00.000Z");
confere("webhook: 8ª falha → desiste", proximaTentativa(8, t0), null);

// ── 10. Ações da logística ────────────────────────────────────────────────────
confere("readyForPickup do ACEITO → PRONTO", (planoDaAcao("readyForPickup", "ACEITO") as any).para, "PRONTO");
confere("readyForPickup já PRONTO → nada", planoDaAcao("readyForPickup", "PRONTO").tipo, "nada");
confere("readyForPickup com o pedido na rua → nada (não regride)", planoDaAcao("readyForPickup", "SAIU_ENTREGA").tipo, "nada");
confere("dispatch do PRONTO → SAIU_ENTREGA", (planoDaAcao("dispatch", "PRONTO") as any).para, "SAIU_ENTREGA");
confere("dispatch do NOVO → SAIU_ENTREGA", (planoDaAcao("dispatch", "NOVO") as any).para, "SAIU_ENTREGA");
confere("dispatch repetido → nada", planoDaAcao("dispatch", "SAIU_ENTREGA").tipo, "nada");
confere("delivered da rua → ENTREGUE", (planoDaAcao("delivered", "SAIU_ENTREGA") as any).para, "ENTREGUE");
confere("delivered repetido → nada", planoDaAcao("delivered", "ENTREGUE").tipo, "nada");
confere("cancelado → 422", planoDaAcao("dispatch", "CANCELADO").tipo, "cancelado");
confere("Pix esperando pagamento não sai", planoDaAcao("dispatch", "AGUARDANDO_PAGAMENTO").tipo, "nada");

console.log(`\n${total - falhas}/${total} ok`);
if (falhas > 0) process.exit(1);
