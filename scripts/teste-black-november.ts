/**
 * scripts/teste-black-november.ts — quem vê a janela da Black November, qual
 * copy, e o que o webhook grava quando paga (lib/black-november.ts).
 *
 *   npx tsx scripts/teste-black-november.ts
 *
 * Regra do Douglas (19/11/2026): todas as lojas, uma vez, só o dono; fora
 * isentas, embaixadores, loja em onboarding, anual já pago e depois de 30/11.
 * "Economize R$ 800" só para quem vende no ritmo do teto (R$ 20 mil/mês).
 */
import {
  aplicarPagamento, anualCobreOMes, CHAVE_DA_BLACK_NOVEMBER, corpoDaCobranca, ECONOMIA_NO_TETO, lojaDaReferencia, mesesDoAnual,
  quemVe, temAnualPago, VALOR_DA_PARCELA, varianteDaLoja, vencimentoDaCobranca,
  type EstadoDaBlackNovember, type QuemVe,
} from "../src/lib/black-november";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : `\n   esperado: ${JSON.stringify(esperado)}\n   obtido:   ${JSON.stringify(obtido)}`}`);
};

const agora = new Date("2026-11-19T15:00:00-03:00");
const base = (mudar: Partial<QuemVe> = {}, loja: Partial<QuemVe["loja"]> = {}): QuemVe => ({
  agora,
  usuario: { role: "FRANCHISEE", ownerId: null },
  acessoDoSuporte: false,
  loja: { email: "loja@x.com", planPercent: 2, isFranqueadoHakim: false, createdAt: new Date("2026-10-01T12:00:00-03:00"), onboardingData: {}, ...loja },
  isenta: false,
  embaixador: false,
  produtosNoCardapio: 40,
  ...mudar,
});
const motivo = (r: ReturnType<typeof quemVe>) => (r.mostrar ? "mostra" : r.motivo);

console.log("— Quem vê");
confere("dono de loja comum vê", motivo(quemVe(base())), "mostra");
confere("loja em teste grátis também vê", motivo(quemVe(base({}, { createdAt: new Date("2026-11-10T10:00:00-03:00") }))), "mostra");
confere("funcionário (STAFF com ownerId) não vê", motivo(quemVe(base({ usuario: { role: "STAFF", ownerId: "dono1" } }))), "nao-e-o-dono");
confere("conta com ownerId não vê, mesmo FRANCHISEE", motivo(quemVe(base({ usuario: { role: "FRANCHISEE", ownerId: "dono1" } }))), "nao-e-o-dono");
confere("ADMIN não vê", motivo(quemVe(base({ usuario: { role: "ADMIN", ownerId: null } }))), "nao-e-o-dono");
confere("suporte pelo Acessar do admin não vê (não gasta a janela do dono)", motivo(quemVe(base({ acessoDoSuporte: true }))), "suporte");
confere("isenta (planPercent 0) não vê", motivo(quemVe(base({ isenta: true }))), "isenta");
confere("embaixador não vê", motivo(quemVe(base({ embaixador: true }))), "embaixador");
confere("loja criada há 3 h (onboarding) não vê", motivo(quemVe(base({}, { createdAt: new Date(agora.getTime() - 3 * 3600_000) }))), "loja-nova");
confere("loja com 25 h vê", motivo(quemVe(base({}, { createdAt: new Date(agora.getTime() - 25 * 3600_000) }))), "mostra");
confere("loja sem nenhum produto no cardápio não vê", motivo(quemVe(base({ produtosNoCardapio: 0 }))), "sem-cardapio");
confere("já viu (fechou em outro aparelho) não vê",
  motivo(quemVe(base({}, { onboardingData: { [CHAVE_DA_BLACK_NOVEMBER]: { vistoEm: "2026-11-18T20:00:00Z", saida: "fechou" } } }))), "ja-viu");
confere("outras chaves do onboardingData não atrapalham",
  motivo(quemVe(base({}, { onboardingData: { comoConheceu: "Instagram", tutoriaisOcultos: true } }))), "mostra");
const comAnual = { [CHAVE_DA_BLACK_NOVEMBER]: { anual: { de: "2026-11", ate: "2027-10", pagoEm: "2026-11-05T12:00:00Z", forma: "pix", asaasPaymentId: "pay_1", valor: 4000 } } };
confere("anual já pago não vê", motivo(quemVe(base({}, { onboardingData: comAnual }))), "anual-pago");
confere("30/11 às 23:59 ainda vê", motivo(quemVe(base({ agora: new Date("2026-11-30T23:59:00-03:00") }))), "mostra");
confere("01/12 à meia-noite já não vê", motivo(quemVe(base({ agora: new Date("2026-12-01T00:00:00-03:00") }))), "acabou");

console.log("— Qual copy (teto × fixo)");
confere("R$ 20 mil no mês passado = teto", varianteDaLoja({ mesPassado: 20000, ultimos30Dias: 0 }), "teto");
confere("R$ 25 mil nos últimos 30 dias (entrou no ritmo agora) = teto", varianteDaLoja({ mesPassado: 8000, ultimos30Dias: 25000 }), "teto");
confere("R$ 19.999 = fixo (não economiza: sem 'economize R$ 800')", varianteDaLoja({ mesPassado: 19999, ultimos30Dias: 15000 }), "fixo");
confere("loja em teste sem venda = fixo", varianteDaLoja({ mesPassado: 0, ultimos30Dias: 0 }), "fixo");
confere("a economia do teto é R$ 800", ECONOMIA_NO_TETO, 800);
confere("a parcela anunciada é R$ 333,33", VALOR_DA_PARCELA, 333.33);

console.log("— Cobrança");
const cartao = corpoDaCobranca("cartao", "cus_1", "loja1", agora);
confere("cartão: 12x, R$ 4.000 no total, referência da loja", [cartao.billingType, (cartao as any).installmentCount, (cartao as any).totalValue, cartao.externalReference],
  ["CREDIT_CARD", 12, 4000, "black-november:loja1"]);
const pix = corpoDaCobranca("pix", "cus_1", "loja1", agora);
confere("Pix: R$ 4.000 à vista", [pix.billingType, (pix as any).value], ["PIX", 4000]);
confere("descrição para conciliar", cartao.description, "Black November FireHub — plano anual (loja loja1)");
confere("vence em 3 dias", vencimentoDaCobranca(agora), "2026-11-22");
confere("perto do fim, vence em 30/11", vencimentoDaCobranca(new Date("2026-11-29T10:00:00-03:00")), "2026-11-30");
confere("lê a loja da referência", [lojaDaReferencia("black-november:abc"), lojaDaReferencia("billing:abc"), lojaDaReferencia(null)], ["abc", null, null]);

console.log("— Webhook: pagou");
const estado: EstadoDaBlackNovember = {
  vistoEm: "2026-11-19T18:00:00Z", saida: "cartao", variante: "teto",
  cobrancas: [
    { forma: "cartao", asaasPaymentId: "pay_c1", asaasInstallmentId: "ins_1", invoiceUrl: "https://asaas/i/c1", valor: 4000, criadaEm: "2026-11-19T18:00:00Z", status: "PENDENTE" },
    { forma: "pix", asaasPaymentId: "pay_p1", invoiceUrl: "https://asaas/i/p1", valor: 4000, criadaEm: "2026-11-19T18:01:00Z", status: "PENDENTE" },
  ],
};
const pagouEm = new Date("2026-11-20T10:00:00-03:00");
const r1 = aplicarPagamento(estado, { id: "pay_p1", status: "RECEIVED" }, "PAYMENT_RECEIVED", { agora: pagouEm });
confere("Pix pago grava o anual de nov/2026 a out/2027", [r1.resultado, r1.estado?.anual?.de, r1.estado?.anual?.ate, r1.estado?.anual?.forma], ["PAGO", "2026-11", "2027-10", "pix"]);
confere("e manda apagar o cartão pendente", r1.apagar.map((c) => c.asaasPaymentId), ["pay_c1"]);
confere("as cobranças ficam PAGA e CANCELADA", r1.estado?.cobrancas?.map((c) => c.status), ["CANCELADA", "PAGA"]);
const r2 = aplicarPagamento(r1.estado!, { id: "pay_p1", status: "RECEIVED" }, "PAYMENT_RECEIVED", { agora: pagouEm });
confere("webhook repetido não muda nada", [r2.resultado, r2.estado], ["SEM_MUDANCA", null]);

const c1 = aplicarPagamento(estado, { id: "pay_c1", installment: "ins_1", status: "CONFIRMED" }, "PAYMENT_CONFIRMED", { agora: pagouEm });
const c7 = aplicarPagamento(c1.estado!, { id: "pay_c7", installment: "ins_1", status: "CONFIRMED" }, "PAYMENT_CONFIRMED", { agora: pagouEm });
confere("cartão: a 1ª parcela confirmada grava; a 7ª (outro payment, mesmo parcelamento) não regrava", [c1.resultado, c7.resultado], ["PAGO", "SEM_MUDANCA"]);
confere("pagamento de outra coisa é ignorado", aplicarPagamento(estado, { id: "pay_x" }, "PAYMENT_RECEIVED", { agora: pagouEm }).resultado, "SEM_COBRANCA");

console.log("— Webhook: teste grátis e estorno");
const noTeste = aplicarPagamento(estado, { id: "pay_p1", status: "RECEIVED" }, "PAYMENT_RECEIVED", { agora: pagouEm, fimDoTeste: new Date("2026-12-03T10:00:00-03:00") });
confere("pagou no meio do teste: o ano começa no mês em que o teste acaba", [noTeste.estado?.anual?.de, noTeste.estado?.anual?.ate], ["2026-12", "2027-11"]);
confere("mesesDoAnual de janeiro", mesesDoAnual(new Date("2027-01-10T12:00:00-03:00"), null), { de: "2027-01", ate: "2027-12" });
const estorno = aplicarPagamento(r1.estado!, { id: "pay_p1", status: "REFUNDED" }, "PAYMENT_REFUNDED", { agora: new Date("2026-12-02T10:00:00-03:00") });
confere("estorno da cobrança que pagou tira a cobertura", [estorno.resultado, !!estorno.estado?.anual?.estornadoEm], ["ESTORNADO", true]);
const apagada = aplicarPagamento(estado, { id: "pay_c1", status: "DELETED" }, "PAYMENT_DELETED", { agora: pagouEm });
confere("cobrança pendente apagada no Asaas sai do reuso", apagada.estado?.cobrancas?.map((c) => c.status), ["CANCELADA", "PENDENTE"]);

console.log("— Fechamento do mês (closeBillingCycle lê anualCobreOMes)");
const od = { [CHAVE_DA_BLACK_NOVEMBER]: r1.estado };
confere("nov/2026 coberto (não sai boleto de mensalidade em 01/12)", anualCobreOMes(od, "2026-11"), true);
confere("out/2027 coberto", anualCobreOMes(od, "2027-10"), true);
confere("nov/2027 volta a cobrar", anualCobreOMes(od, "2027-11"), false);
confere("out/2026 (antes do pagamento) cobra normal", anualCobreOMes(od, "2026-10"), false);
confere("estornado não cobre", anualCobreOMes({ [CHAVE_DA_BLACK_NOVEMBER]: estorno.estado }, "2026-12"), false);
confere("loja sem nada não cobre", anualCobreOMes(null, "2026-11"), false);
confere("anual vencido não conta como 'já tem anual'", temAnualPago(od, "2027-11"), false);

console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
