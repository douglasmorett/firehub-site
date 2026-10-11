/**
 * O FECHAMENTO DE CAIXA E O RELATÓRIO "FORMAS DE PAGAMENTO" LEEM A FORMA PELA
 * MESMA RÉGUA — e o troco da mesa sai do dinheiro nos dois.
 *
 *   npx tsx scripts/teste-caixa-regua-unica.ts
 *
 * Auditoria de 11/10/2026 (C1 e C2): em 30 dias, 30 pedidos e R$ 2.625,93 numa
 * forma no caixa e noutra no relatório (NIK: 27 "Cartão Deb Master (Cobrar na
 * Entrega)" da Wabiz no CRÉDITO do caixa, R$ 2.412,96; "Cartão Alimentação"
 * no crédito; o "CASH" cru do iFood no pago online; o "99Food" de pay_type
 * desconhecido no vale) e R$ 3.113,52 de troco de mesa cobrados da gaveta em
 * 32 turnos. Aqui o mesmo turno passa pelas duas contas reais
 * (apurarVendasDoTurno e formasDePagamento) e cada forma tem de dar o mesmo
 * valor, no centavo.
 */
import { apurarVendasDoTurno, type MesaDoTurno } from "../src/lib/apuracao-do-turno";
import { formasDePagamento, type MesaParaFormas, type PedidoParaFormas } from "../src/lib/relatorios/formas-de-pagamento";

let falhas = 0;
const confere = (nome: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "ok    " : "FALHOU"} ${nome}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`}`);
};
const r2 = (n: number) => Math.round(n * 100) / 100;

// Sábado 10/10/2026 (UTC−3), entre 18h e 23h.
const h = (hhmm: string) => `2026-10-10T${hhmm}:00-03:00`;
let seq = 0;
const ped = (hora: string, p: Record<string, unknown>) => ({
  id: `p${++seq}`, createdAt: h(hora), status: "ENTREGUE", deliveryType: "DELIVERY", source: "ONLINE", paymentMethod: "Dinheiro",
  totalAmount: 10, deliveryFee: 0, discountIfood: 0, discountTotal: 0, discountMerchant: 0, notes: null, tableSessionId: null,
  paymentMethods: null, paymentPaidAt: null, gatewayProvider: null, openDeliveryChannel: null, ifoodOrderId: null,
  items: [], ...p,
});

const pedidos: any[] = [
  // Wabiz: débito abreviado, alimentação, crédito por extenso.
  ped("18:05", { source: "WABIZ", openDeliveryChannel: "WABIZ", paymentMethod: "Cartão Deb Master (Cobrar na Entrega)", totalAmount: 89.37 }),
  ped("18:10", { source: "WABIZ", openDeliveryChannel: "WABIZ", paymentMethod: "Cartão Alimentação (Cobrar na Entrega)", totalAmount: 45.5 }),
  ped("18:12", { source: "WABIZ", openDeliveryChannel: "WABIZ", paymentMethod: "Cartão Elo Credito (Cobrar na Entrega)", totalAmount: 61 }),
  // iFood: "CASH" cru é dinheiro na porta; "Pix" trocado na entrega; pago no app com cupom.
  ped("18:20", { source: "IFOOD", ifoodOrderId: "if-1", paymentMethod: "CASH", totalAmount: 5.89 }),
  ped("18:25", { source: "IFOOD", ifoodOrderId: "if-2", paymentMethod: "Pix", totalAmount: 46.98 }),
  ped("18:30", { source: "IFOOD", ifoodOrderId: "if-3", paymentMethod: "Crédito (Pago Online)", totalAmount: 70, discountIfood: 12, discountTotal: 12 }),
  // 99Food: pay_type desconhecido ("99Food") e pago online.
  ped("18:40", { source: "99FOOD", openDeliveryChannel: "99FOOD", paymentMethod: "99Food", totalAmount: 195.29 }),
  ped("18:45", { source: "99FOOD", openDeliveryChannel: "99FOOD", paymentMethod: "Pago Online (99Food)", totalAmount: 30, discountIfood: 5, discountTotal: 5 }),
  // Site: Pix pago pelo cardápio (Asaas) é online; Pix na entrega é Pix.
  ped("19:00", { source: "ONLINE", paymentMethod: "PIX", gatewayProvider: "asaas", paymentPaidAt: h("19:01"), totalAmount: 33 }),
  ped("19:05", { source: "ONLINE", paymentMethod: "PIX_ENTREGA", totalAmount: 27 }),
  // Balcão: dividido com uma parte FIADO (era "não identificada" no caixa).
  ped("19:20", { source: "PRESENCIAL", deliveryType: "RETIRADA", paymentMethod: "Dividido: Dinheiro R$ 20,00 + Fiado R$ 15,00",
    paymentMethods: [{ method: "Dinheiro", amount: 20 }, { method: "Fiado", amount: 15 }], totalAmount: 35 }),
  ped("19:25", { source: "PRESENCIAL", deliveryType: "RETIRADA", paymentMethod: "Voucher/Vale", totalAmount: 21 }),
  // Totem pago na Point sem o tipo do cartão: crédito, não online.
  ped("19:30", { source: "TOTEM", deliveryType: "RETIRADA", paymentMethod: "Cartão (Maquininha)", paymentPaidAt: h("19:31"), totalAmount: 27.5 }),
  // "A combinar" ninguém sabe o que é.
  ped("19:40", { source: "ONLINE", paymentMethod: "A combinar (Cobrar na Entrega)", totalAmount: 40 }),
  // Pedidos de mesa (a forma está na conta).
  ped("20:00", { source: "PRESENCIAL", deliveryType: "MESA", tableSessionId: "m3", paymentMethod: "N/A", totalAmount: 7 }),
  ped("20:10", { source: "PRESENCIAL", deliveryType: "MESA", tableSessionId: "m5", paymentMethod: "N/A", totalAmount: 63.59 }),
];

// Mesa 3 (o caso de 10/10 da Delícias da Maria): consumiu R$ 7, baixa "Dinheiro 100".
// Mesa 5: R$ 63,59 + 10% de serviço (6,36) = R$ 69,95, paga com R$ 50 no crédito + nota de R$ 50 + R$ 2 de
// fiado = R$ 102: o troco de R$ 32,05 sai da nota de 50.
const mesas = [
  { id: "m3", closedAt: h("20:30"), serviceFee: 0, waiterTip: 0, totalPaid: 100, paymentMethods: [{ method: "Dinheiro", amount: 100 }],
    orders: [{ id: "p15", status: "ENTREGUE", totalAmount: 7, discountTotal: 0 }] },
  { id: "m5", closedAt: h("21:00"), serviceFee: 6.359, waiterTip: 0, totalPaid: 102, paymentMethods: [{ method: "Crédito", amount: 50 }, { method: "Dinheiro", amount: 50 }, { method: "Fiado", amount: 2 }],
    orders: [{ id: "p16", status: "ENTREGUE", totalAmount: 63.59, discountTotal: 0 }] },
];

const caixa = apurarVendasDoTurno(pedidos, mesas as MesaDoTurno[]);
const rel = formasDePagamento(
  pedidos as PedidoParaFormas[],
  mesas.map((m): MesaParaFormas => ({ id: m.id, fechadaEm: m.closedAt, totalPago: m.totalPaid, taxaDeServico: m.serviceFee, gorjeta: m.waiterTip, pagamentos: m.paymentMethods, pedidos: m.orders })),
  { de: "2026-10-10", ate: "2026-10-10", tz: "America/Sao_Paulo" },
);
const doRelatorio = (chave: string) => rel.formas.find((f) => f.chave === chave)!.valor;
const doRetrato = (nome: string) => r2(caixa.retrato.porForma.filter((f) => f.nome === nome || (nome === "Pago online" && f.nome.startsWith("Pago online"))).reduce((s, f) => s + f.valor, 0));
const e = caixa.expected;

console.log("\n— Conferência do caixa × relatório, forma a forma —");
confere("Dinheiro: a conferência = o relatório", r2(e.cash), doRelatorio("DINHEIRO"));
confere("Débito: a conferência = o relatório (Deb Master é débito)", r2(e.debit), doRelatorio("DEBITO"));
confere("Crédito: a conferência = o relatório", r2(e.credit), doRelatorio("CREDITO"));
confere("Pix: a conferência = o relatório", r2(e.pix), doRelatorio("PIX"));
confere("Vale: a conferência = o relatório (alimentação é vale; 99Food não)", r2(e.voucher), doRelatorio("VALE"));
confere("Fiado: fora da conferência = o relatório (parte do dividido e baixa da mesa)", r2(caixa.foraDaConferencia.fiado), doRelatorio("FIADO"));
confere("Não identificado: fora da conferência = o relatório", r2(caixa.foraDaConferencia.naoIdentificado), doRelatorio("OUTROS"));
confere("Pago online sem o cupom (retrato) = o relatório", doRetrato("Pago online"), doRelatorio("ONLINE"));
confere("o online da conferência é o do relatório + o cupom que a plataforma repassa", r2(e.ifoodOnline + e.food99Online), r2(doRelatorio("ONLINE") + 12 + 5));
for (const [nome, chave] of [["Dinheiro", "DINHEIRO"], ["Debito", "DEBITO"], ["Credito", "CREDITO"], ["Pix", "PIX"], ["Vale-refeicao", "VALE"], ["Fiado", "FIADO"], ["Forma nao identificada", "OUTROS"]]) {
  confere(`retrato ${nome} = relatório`, doRetrato(nome), doRelatorio(chave));
}

console.log("\n— Os casos, um a um —");
confere("Débito = 89,37 (Wabiz Deb Master)", r2(e.debit), 89.37);
confere("Vale = 45,50 (Alimentação) + 21 (Voucher/Vale)", r2(e.voucher), 66.5);
confere("Crédito = 61 + 27,50 (totem) + 50 (mesa 5)", r2(e.credit), 138.5);
confere("Pix = 46,98 (trocado na entrega) + 27 (Pix na entrega)", r2(e.pix), 73.98);
// Dinheiro: CASH 5,89 + 20 (dividido) + 7 (mesa 3, sem o troco de 93) + 17,95 (mesa 5, sem o troco de 32,05).
confere("Dinheiro = 5,89 (CASH) + 20 + 7 (mesa 3 sem troco) + 17,95 (mesa 5 sem troco)", r2(e.cash), 50.84);
confere("Troco das mesas: 93 + 32,05", [caixa.retrato.mesas.troco, caixa.retrato.mesas.trocoQtd], [125.05, 2]);
confere("Fiado = 15 (parte do dividido) + 2 (baixa da mesa)", r2(caixa.foraDaConferencia.fiado), 17);
confere("Não identificado = 195,29 (99Food) + 40 (A combinar)", r2(caixa.foraDaConferencia.naoIdentificado), 235.29);
confere("o '99Food' não caiu no vale", r2(e.voucher) < 195, true);
confere("o total é a soma das linhas", r2(e.total), r2(e.cash + e.debit + e.credit + e.pix + e.voucher + e.ifoodOnline + e.food99Online));
confere("99Food online em linha própria (30 + 5 de cupom)", r2(e.food99Online), 35);
confere("iFood + site online (70 + 12 de cupom; 33 do site)", r2(e.ifoodOnline), 115);

console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
