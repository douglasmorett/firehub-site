// npx tsx scripts/teste-forma-para-o-entregador.ts — o texto de pagamento que o app do motoboy mostra.
import { formaParaOEntregador } from "../src/lib/pagamento-na-entrega";

let falhas = 0;
const caso = (nome: string, obtido: unknown, esperado: unknown) => {
  const ok = obtido === esperado;
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHA"} ${nome}: ${JSON.stringify(obtido)}${ok ? "" : ` (esperado ${JSON.stringify(esperado)})`}`);
};

caso("Pix pago pelo site (Garagem nº 34)", formaParaOEntregador({ paymentMethod: "PIX", gatewayPaymentId: "pay_1" }), "PIX (Pago Online)");
caso("Cartão online do site", formaParaOEntregador({ paymentMethod: "CREDITO_ONLINE", gatewayPaymentId: "pay_2" }), "CREDITO_ONLINE");
caso("iFood já diz pago online", formaParaOEntregador({ paymentMethod: "Pix (Pago Online)" }), "Pix (Pago Online)");
caso("Pix na entrega", formaParaOEntregador({ paymentMethod: "PIX" }), "PIX");
caso("Dinheiro", formaParaOEntregador({ paymentMethod: "Dinheiro" }), "Dinheiro");
caso("Sem forma", formaParaOEntregador({ paymentMethod: null }), null);
caso("Sem forma com gateway", formaParaOEntregador({ paymentMethod: null, gatewayPaymentId: "x" }), "Pago Online");

if (falhas) { console.log(`\n${falhas} falha(s)`); process.exit(1); }
console.log("\ntudo ok");
