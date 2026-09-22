/**
 * Prova da regra de troca de forma de pagamento (lib/pagamento-na-entrega.ts).
 *
 *   node scripts/teste-troca-de-pagamento.mjs
 *
 * O cliente diz "dinheiro" ao pedir e paga no débito na porta. O app do
 * motoboy e o painel passam a trocar a forma — em qualquer canal e em qualquer
 * status que não seja cancelado — MENOS quando o pagamento é online, que já
 * entrou por outro caminho. Os textos são os que chegam de verdade de cada
 * origem (iFood, 99Food, site, robô, balcão).
 */
import { readFileSync } from "fs";
import ts from "typescript";

const js = ts.transpileModule(readFileSync("src/lib/pagamento-na-entrega.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { cobrancaNaEntrega, ehPagoOnline, formaCanonica, podeTrocarPagamento, FORMAS_DE_PAGAMENTO_NA_ENTREGA } =
  await import("data:text/javascript," + encodeURIComponent(js));

let falhas = 0;
const conferir = (nome, ok, detalhe) => {
  if (ok) { console.log("  ok    " + nome); return; }
  falhas++;
  console.log("  FALHA " + nome + (detalhe ? " — " + detalhe : ""));
};
const igual = (nome, obtido, esperado) => conferir(nome, obtido === esperado, `obtido ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`);

console.log("\n1) Forma canônica — o que cada origem escreve");
igual("iFood 'Crédito (Cobrar na Entrega)'", formaCanonica("Crédito (Cobrar na Entrega)"), "Cartão Crédito");
igual("iFood 'Dinheiro (Cobrar na Entrega)'", formaCanonica("Dinheiro (Cobrar na Entrega)"), "Dinheiro");
igual("'Cartão Débito' fica Débito, não Crédito", formaCanonica("Cartão Débito"), "Cartão Débito");
igual("'Débito na entrega'", formaCanonica("Débito na entrega"), "Cartão Débito");
igual("'Cartão (Maquininha)' é cartão de crédito", formaCanonica("Cartão (Maquininha)"), "Cartão Crédito");
igual("'PIX' e 'Pix na entrega'", formaCanonica("PIX"), "Pix");
igual("'Vale Refeição'", formaCanonica("Vale Refeição"), "Vale-refeição");
igual("'Voucher/Vale'", formaCanonica("Voucher/Vale"), "Vale-refeição");
igual("texto vazio → null", formaCanonica(""), null);
igual("'Fiado' → null (não é forma de porta)", formaCanonica("Fiado"), null);
conferir("toda forma da lista volta para si mesma", FORMAS_DE_PAGAMENTO_NA_ENTREGA.every((f) => formaCanonica(f) === f));

console.log("\n2) Pago online — o que trava a troca");
igual("'Crédito (Pago Online)' (iFood)", ehPagoOnline({ paymentMethod: "Crédito (Pago Online)" }), true);
igual("'Pix (Pago Online)'", ehPagoOnline({ paymentMethod: "Pix (Pago Online)" }), true);
// "Pago via iFood" NÃO casa com a regra ("na dúvida, cobra"): documenta o
// comportamento atual, que é o mesmo do gêmeo no Assistente. Mudar isto exige
// mudar lá também (firehub-print-assistant/server.js, isOnlinePayment).
igual("'Pago via iFood' fica na dúvida → cobra (regra atual)", ehPagoOnline({ paymentMethod: "Pago via iFood" }), false);
igual("gatewayPaymentId preenchido, texto qualquer", ehPagoOnline({ paymentMethod: "Cartão", gatewayPaymentId: "mp_123" }), true);
igual("isPrepaid true", ehPagoOnline({ paymentMethod: "Cartão", isPrepaid: true }), true);
igual("'Dinheiro' não é online", ehPagoOnline({ paymentMethod: "Dinheiro" }), false);
igual("'Crédito (Cobrar na Entrega)' não é online", ehPagoOnline({ paymentMethod: "Crédito (Cobrar na Entrega)" }), false);
igual("'Cartão' sem nada (na dúvida, cobra)", ehPagoOnline({ paymentMethod: "Cartão" }), false);
igual("isPrepaid false vence o texto 'online'", ehPagoOnline({ paymentMethod: "Pix Online", isPrepaid: false }), false);

console.log("\n3) Pode trocar?");
igual("entregue em dinheiro: pode", podeTrocarPagamento({ status: "ENTREGUE", paymentMethod: "Dinheiro", deliveryType: "DELIVERY" }).pode, true);
igual("saiu para entrega, iFood cobrar na entrega: pode", podeTrocarPagamento({ status: "SAIU_ENTREGA", paymentMethod: "Crédito (Cobrar na Entrega)", deliveryType: "DELIVERY" }).pode, true);
igual("retirada em dinheiro: pode", podeTrocarPagamento({ status: "PRONTO", paymentMethod: "Dinheiro", deliveryType: "RETIRADA" }).pode, true);
igual("pago online: NÃO", podeTrocarPagamento({ status: "ENTREGUE", paymentMethod: "Crédito (Pago Online)", deliveryType: "DELIVERY" }).pode, false);
igual("gateway: NÃO", podeTrocarPagamento({ status: "ENTREGUE", paymentMethod: "Pix", gatewayPaymentId: "x", deliveryType: "DELIVERY" }).pode, false);
igual("cancelado: NÃO", podeTrocarPagamento({ status: "CANCELADO", paymentMethod: "Dinheiro", deliveryType: "DELIVERY" }).pode, false);
igual("CANCELLED (grafia do parceiro): NÃO", podeTrocarPagamento({ status: "CANCELLED", paymentMethod: "Dinheiro", deliveryType: "DELIVERY" }).pode, false);
// Mesa SEM conta de mesa é pedido de balcão com o número da mesa junto: o
// pagamento está no próprio pedido e vai direto para o caixa, então troca como
// qualquer outro. Quem bloqueia é a CONTA (o caso logo abaixo), não o rótulo.
igual("mesa sem conta aberta: pode", podeTrocarPagamento({ status: "ACEITO", paymentMethod: "Cartão Crédito", deliveryType: "MESA" }).pode, true);
igual("conta da mesa: NÃO", podeTrocarPagamento({ status: "ACEITO", paymentMethod: "N/A", deliveryType: "MESA", kind: "CONTA_DA_MESA" }).pode, false);
igual("pedido preso a uma conta de mesa: NÃO", podeTrocarPagamento({ status: "ACEITO", paymentMethod: "Dinheiro", deliveryType: "DELIVERY", tableSessionId: "t1" }).pode, false);
igual("sem pedido: NÃO", podeTrocarPagamento(null).pode, false);

console.log("\n4) cobrancaNaEntrega continua a mesma depois da refatoração");
igual("online não cobra", cobrancaNaEntrega({ paymentMethod: "Crédito (Pago Online)", totalAmount: 50 }).cobrar, false);
igual("fiado não cobra", cobrancaNaEntrega({ paymentMethod: "Fiado", totalAmount: 50 }).cobrar, false);
igual("mesa não cobra", cobrancaNaEntrega({ paymentMethod: "Dinheiro", totalAmount: 50, deliveryType: "MESA" }).cobrar, false);
const dinheiro = cobrancaNaEntrega({ paymentMethod: "Dinheiro", totalAmount: 38, changeAmount: 100 });
igual("dinheiro cobra", dinheiro.cobrar, true);
igual("troco: nota de 100 em pedido de 38 → levar 62", dinheiro.levarDeTroco, 62);
igual("'Crédito (Cobrar na Entrega)' → metodo 'Crédito'", cobrancaNaEntrega({ paymentMethod: "Crédito (Cobrar na Entrega)", totalAmount: 10 }).metodo, "Crédito");
igual("'OTHER' vira 'Cartão'", cobrancaNaEntrega({ paymentMethod: "OTHER", totalAmount: 10 }).metodo, "Cartão");

console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ tudo certo");
process.exit(falhas ? 1 : 0);
