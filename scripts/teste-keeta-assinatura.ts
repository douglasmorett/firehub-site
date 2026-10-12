/**
 * scripts/teste-keeta-assinatura.ts — trava o X-App-Signature da Keeta.
 *
 *   npx tsx scripts/teste-keeta-assinatura.ts
 *
 * As strings são as três da doc ("Signature Calculation") mais as das chamadas
 * que o FireHub faz. As assinaturas esperadas foram calculadas com a
 * implementação Python de referência da própria doc (a doc só mostra a string,
 * não a assinatura). `168d0c50…` é o secret fixo do script da coleção Postman
 * oficial da Keeta.
 */
import { textoParaAssinar, assinarChamada, webhookAssinadoPelaKeeta, hmacBase64 } from "../src/lib/keeta/assinatura";

let falhas = 0;
function confere(nome: string, obtido: unknown, esperado: unknown) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${nome}${ok ? "" : `\n   esperado: ${JSON.stringify(esperado)}\n   obtido:   ${JSON.stringify(obtido)}`}`);
}

const S1 = "168d0c50a27e429796086289ff0d9ad3";
const S2 = "test_secret";
const BASE = "https://open.mykeeta.com/api/open/opendelivery";

// doc #1 — GET com query, sem corpo
confere("doc #1: string", textoParaAssinar("https://api.example.com/v1/users", { page: "2", limit: "10", sort: "name" }), "https://api.example.com/v1/users&limit=10&page=2&sort=name");
confere("doc #1: secret Postman", assinarChamada(S1, "https://api.example.com/v1/users", { page: "2", limit: "10", sort: "name" }), "akKcW4VcCLcZI3BTxgfSAqe6+IHSubMTH71wuUbE5gw=");
confere("doc #1: test_secret", assinarChamada(S2, "https://api.example.com/v1/users", { page: "2", limit: "10", sort: "name" }), "rUsQsZ2eLT5RIDvNjeAG+plK4fCtxNeSjr5MdpeBNMc=");

// doc #2 — POST sem query, com corpo (ordem das chaves preservada)
const corpo2 = JSON.stringify({ userId: 123, productId: 456, quantity: 2 });
confere("doc #2: string", textoParaAssinar("https://api.example.com/v1/orders", null, corpo2), 'https://api.example.com/v1/orders&{"userId":123,"productId":456,"quantity":2}');
confere("doc #2: secret Postman", assinarChamada(S1, "https://api.example.com/v1/orders", null, corpo2), "9dnaiBZelWbMQ8xmV+gOzmWC0p+6IGmXqcxrkfWwHJM=");
confere("doc #2: test_secret", assinarChamada(S2, "https://api.example.com/v1/orders", null, corpo2), "I4O9ch61bZs/OUzhLV6/C8QCCAjxnq0BTabomONcr1g=");

// doc #3 — PUT com query e corpo
const corpo3 = JSON.stringify({ name: "Product A", price: 99.99 });
confere("doc #3: secret Postman", assinarChamada(S1, "https://api.example.com/v1/products", { version: "v2", format: "json" }, corpo3), "8yyLs40EZptqDiuc9UdwAGs7p6UiSTtDnPRaro7QSnQ=");
confere("doc #3: test_secret", assinarChamada(S2, "https://api.example.com/v1/products", { version: "v2", format: "json" }, corpo3), "a1d7gtnpP4Rd+hPbRHXhKXNNY0FHodeuGleAWL2fOKw=");

// chamadas do FireHub
confere("polling", assinarChamada(S1, `${BASE}/v1/events:polling`, { eventType: "CREATED" }), "3gLsYVkmb4HelINcOWkEFl+wUxIUVG2OhHayRyIo2vk=");
const ack = JSON.stringify([{ id: "eventId", orderId: "orderId", eventType: "CREATED" }]);
confere("ack", assinarChamada(S1, `${BASE}/v1/events/acknowledgment`, null, ack), "zthqPu8/240CwrltLpJKxsnf/uNK3UOTZxETDe9S3EI=");
const onb = JSON.stringify({ getMerchantURL: { baseURL: "http://example.com", apiKey: "string" }, ordersWebhookURL: "http://example.com", keetaMerchantId: 159387603 });
confere("onboarding", assinarChamada(S1, `${BASE}/v1/merchantOnboarding?merchantId=your_merchant_id`, { merchantId: "your_merchant_id" }, onb), "RvQi97m14MlTHHm91jLtmx62EBGMFZSz6baTIkqngs4=");

// corpo vazio / {} não entra
confere("corpo {} é pulado", textoParaAssinar("https://x/y", null, "{}"), "https://x/y");
confere("corpo vazio é pulado", textoParaAssinar("https://x/y", null, "  "), "https://x/y");
confere("query null vira vazio", textoParaAssinar("https://x/y", { a: null }), "https://x/y&a=");

// webhook
const corpoCru = '{"eventId":"e1","eventType":"CREATED","orderId":"o1"}';
const assinatura = hmacBase64(S2, corpoCru);
confere("webhook: assinatura certa passa", webhookAssinadoPelaKeeta(S2, corpoCru, assinatura), true);
confere("webhook: corpo mexido não passa", webhookAssinadoPelaKeeta(S2, corpoCru + " ", assinatura), false);
confere("webhook: sem assinatura não passa", webhookAssinadoPelaKeeta(S2, corpoCru, ""), false);
confere("webhook: sem segredo não passa", webhookAssinadoPelaKeeta("", corpoCru, assinatura), false);

console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
