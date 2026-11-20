/**
 * Teste da regra do plano anual na fatura (lib/plano-anual.ts).
 *   npx tsx scripts/teste-plano-anual.ts
 */
import { aplicarPagamentoDoAnual, anualAte, anualCobreOMes, ofertaDoAnual, valorDoAnualNaFatura, type EstadoDoPlanoAnual } from "../src/lib/plano-anual";

let falhas = 0, ok = 0;
function igual(nome: string, veio: unknown, esperado: unknown) {
  if (JSON.stringify(veio) === JSON.stringify(esperado)) { ok++; return; }
  falhas++;
  console.log(`✗ ${nome}\n  veio:     ${JSON.stringify(veio)}\n  esperado: ${JSON.stringify(esperado)}`);
}
const fatura = { yearMonth: "2026-11", mensalidade: 400, valorDaFatura: 400, isenta: false, onboardingData: {} };

// Quem vê
igual("mensalidade 400: oferece 12x de 333,33", ofertaDoAnual(fatura), { valor: 4000, parcela: 333.33, parcelas: 12, economia: 800, de: "2026-11", ate: "2027-10" });
igual("mensalidade 285: não oferece", ofertaDoAnual({ ...fatura, mensalidade: 285, valorDaFatura: 285 }), null);
igual("pré-pago R$ 200: não oferece", ofertaDoAnual({ ...fatura, mensalidade: 200, valorDaFatura: 200 }), null);
igual("ativação do pré-pago: não oferece", ofertaDoAnual({ ...fatura, ativacao: true }), null);
igual("isenta: não oferece", ofertaDoAnual({ ...fatura, isenta: true }), null);

// A conta: fatura + 3.600
igual("fatura 400 → 4.000", valorDoAnualNaFatura(400), 4000);
igual("fatura com Bill e loja extra (400 + 49,90 + 100) → 4.149,90", valorDoAnualNaFatura(549.9), 4149.9);
igual("fatura com crédito de indicação (300) → 3.900", valorDoAnualNaFatura(300), 3900);

// Pagamento
const pendente: EstadoDoPlanoAnual = { cobrancas: [{ cicloId: "c1", yearMonth: "2026-11", forma: "pix", asaasPaymentId: "pay_a", invoiceUrl: "u", valor: 4000, criadaEm: "2026-12-02T12:00:00Z", status: "PENDENTE" }] };
const agora = new Date("2026-12-03T15:00:00Z");
const pago = aplicarPagamentoDoAnual(pendente, { id: "pay_a", status: "RECEIVED" }, "PAYMENT_RECEIVED", { agora });
igual("pagou: resultado", pago.resultado, "PAGO");
igual("pagou: cobre nov/2026 a out/2027", [pago.estado?.anual?.de, pago.estado?.anual?.ate], ["2026-11", "2027-10"]);
const od = { planoAnual: pago.estado };
igual("cobre novembro (a fatura que pagou)", anualCobreOMes(od, "2026-11"), true);
igual("cobre outubro/2027", anualCobreOMes(od, "2027-10"), true);
igual("não cobre novembro/2027", anualCobreOMes(od, "2027-11"), false);
igual("não cobre outubro/2026", anualCobreOMes(od, "2026-10"), false);
igual("tela: pago até out/2027", anualAte(od, "2027-03"), "2027-10");
igual("com anual valendo, não oferece de novo", ofertaDoAnual({ ...fatura, yearMonth: "2027-05", onboardingData: od }), null);
igual("anual acabou: oferece de novo", ofertaDoAnual({ ...fatura, yearMonth: "2027-11", onboardingData: od })?.de, "2027-11");
igual("webhook repetido não muda nada", aplicarPagamentoDoAnual(pago.estado!, { id: "pay_a", status: "RECEIVED" }, "PAYMENT_RECEIVED", { agora }).resultado, "SEM_MUDANCA");

// Pagou a mensal antes e o anual depois: começa no mês seguinte
const tarde = aplicarPagamentoDoAnual(pendente, { id: "pay_a", status: "CONFIRMED" }, null, { agora, cicloJaPagoPorOutra: true });
igual("fatura já paga pela mensal: anual de dez/2026 a nov/2027", [tarde.estado?.anual?.de, tarde.estado?.anual?.ate], ["2026-12", "2027-11"]);

// Estorno
const estorno = aplicarPagamentoDoAnual(pago.estado!, { id: "pay_a", status: "REFUNDED" }, "PAYMENT_REFUNDED", { agora });
igual("estorno: resultado", estorno.resultado, "ESTORNADO");
igual("estornado não cobre mais", anualCobreOMes({ planoAnual: estorno.estado }, "2027-01"), false);
igual("cobrança de outro pagamento: ignora", aplicarPagamentoDoAnual(pendente, { id: "pay_x", status: "RECEIVED" }, null, { agora }).resultado, "SEM_COBRANCA");

// O anual da Black November conta junto
const bn = { blackNovember2026: { anual: { de: "2026-12", ate: "2027-11", pagoEm: "x", forma: "pix", asaasPaymentId: "p", valor: 4000 } } };
igual("Black November cobre", anualCobreOMes(bn, "2027-02"), true);
igual("com a Black November paga, não oferece", ofertaDoAnual({ ...fatura, onboardingData: bn }), null);

console.log(`\n${ok} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
