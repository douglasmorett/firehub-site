/**
 * Trava o relatório "Vendas por forma de pagamento"
 * (lib/relatorios/formas-de-pagamento.ts): a cascata do fechamento de caixa,
 * o pagamento dividido, a mesa pela conta (não pelo pedido) e sem o troco, a
 * madrugada no dia de ontem, o ticket médio por venda e a ponte entre o total
 * dos pagamentos e o total das vendas (com o motivo de cada pedido de mesa
 * cuja conta não entrou no recorte). O total das vendas segue a régua única
 * (lib/relatorios/regua-da-venda.ts): vendas = atendimentos, a mesa uma vez.
 *
 *   npx tsx scripts/teste-formas-de-pagamento.ts
 *
 * Os textos de pagamento são os que a NIK recebeu de verdade em 17–23/09/2026.
 */
import {
  COLUNAS_DO_PEDIDO, cupomDaPlataforma, formaDoPedido, formaDoTexto, formasDePagamento, precisaDoDetalheDoCupom,
  type MesaParaFormas, type PedidoParaFormas,
} from "../src/lib/relatorios/formas-de-pagamento";
import { resumoDeVendas, type PedidoParaVendas } from "../src/lib/relatorios/vendas";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

// ── 1. A cascata: o texto real → a forma ────────────────────────────────────
console.log("\n— A cascata do caixa com os textos reais —");
const casos: [string, Parameters<typeof formaDoPedido>[0], string][] = [
  ["iFood pago no app no crédito", { source: "IFOOD", paymentMethod: "Crédito (Pago Online)" }, "ONLINE"],
  ["iFood pago no app no Pix", { source: "IFOOD", paymentMethod: "Pix (Pago Online)" }, "ONLINE"],
  ["iFood App", { source: "IFOOD", paymentMethod: "iFood App (Pago Online)" }, "ONLINE"],
  ["iFood sem texto nenhum (o caixa trata como online)", { source: "IFOOD", paymentMethod: "" }, "ONLINE"],
  ["iFood crédito na porta é crédito", { source: "IFOOD", paymentMethod: "Crédito (Cobrar na Entrega)" }, "CREDITO"],
  ["iFood débito na porta é débito", { source: "IFOOD", paymentMethod: "Débito (Cobrar na Entrega)" }, "DEBITO"],
  // Código cru do iFood para dinheiro na porta (1 pedido, R$ 5,89, em 90 dias
  // de produção). O caixa o leva para "pago online" e ele some da gaveta.
  ["iFood 'CASH' é dinheiro na porta, não pago online", { source: "IFOOD", paymentMethod: "CASH" }, "DINHEIRO"],
  ["iFood 'Dinheiro' continua dinheiro", { source: "IFOOD", paymentMethod: "Dinheiro" }, "DINHEIRO"],
  // Frangoso #27 (29/09/2026): "Dinheiro (Cobrar na Entrega)" trocado para
  // "Pix" na entrega. Ia para pago online e sumia do Pix do fechamento.
  ["iFood trocado para 'Pix' na entrega é Pix", { source: "IFOOD", paymentMethod: "Pix" }, "PIX"],
  ["iFood trocado para 'Vale-refeição' na entrega é vale", { source: "IFOOD", paymentMethod: "Vale-refeição" }, "VALE"],
  // O código cru do iFood para Pix pago no app continua online (118 pedidos em 90 dias).
  ["iFood 'PIX' cru continua pago online", { source: "IFOOD", paymentMethod: "PIX" }, "ONLINE"],
  ["iFood 'DIGITAL_WALLET' continua pago online", { source: "IFOOD", paymentMethod: "DIGITAL_WALLET" }, "ONLINE"],
  ["Wabiz pago online", { source: "WABIZ", paymentMethod: "Pagamento Online (Wabiz) (Pago Online)" }, "ONLINE"],
  ["Wabiz 'Cartão Deb Master' é DÉBITO (o caixa diria crédito)", { source: "WABIZ", paymentMethod: "Cartão Deb Master (Cobrar na Entrega)" }, "DEBITO"],
  ["Wabiz 'Cartão Elo Credito'", { source: "WABIZ", paymentMethod: "Cartão Elo Credito (Cobrar na Entrega)" }, "CREDITO"],
  ["Wabiz 'Cartão Visa Debito'", { source: "WABIZ", paymentMethod: "Cartão Visa Debito (Cobrar na Entrega)" }, "DEBITO"],
  ["Wabiz 'A combinar' não é dinheiro", { source: "WABIZ", paymentMethod: "A combinar (Cobrar na Entrega)" }, "OUTROS"],
  ["99Food pago online", { source: "99FOOD", paymentMethod: "Pago Online (99Food)" }, "ONLINE"],
  ["99Food carteira DiDi", { source: "99FOOD", paymentMethod: "Carteira DiDi (99Food Pago Online)" }, "ONLINE"],
  ["Balcão PIX", { source: "PRESENCIAL", paymentMethod: "PIX" }, "PIX"],
  ["Balcão cartão débito", { source: "PRESENCIAL", paymentMethod: "Cartão Débito" }, "DEBITO"],
  ["Balcão dinheiro", { source: "PRESENCIAL", paymentMethod: "Dinheiro" }, "DINHEIRO"],
  ["Conta Funcionário é fiado", { source: "PRESENCIAL", paymentMethod: "Conta Funcionário" }, "FIADO"],
  ["Mesa 'N/A' não identificado (nunca dinheiro)", { source: "PRESENCIAL", paymentMethod: "N/A" }, "OUTROS"],
  ["Totem pago na maquininha é crédito, não online", { source: "TOTEM", paymentMethod: "Cartão (Maquininha)", paymentPaidAt: new Date() }, "CREDITO"],
  ["Totem 'pagar no caixa' confirmado em dinheiro", { source: "TOTEM", paymentMethod: "Dinheiro (recebido por Ana)", paymentPaidAt: new Date() }, "DINHEIRO"],
  ["Site pago no Pix do gateway é online", { source: "SITE", paymentMethod: "Pix", paymentPaidAt: new Date(), gatewayProvider: "mercadopago" }, "ONLINE"],
  ["Site dinheiro na entrega", { source: "SITE", paymentMethod: "Dinheiro (Cobrar na Entrega)" }, "DINHEIRO"],
  ["Vale refeição", { source: "SITE", paymentMethod: "Vale Refeição (Cobrar na Entrega)" }, "VALE"],
  ["'Ticket Alimentação' é vale (o caixa não reconhecia)", { source: "SITE", paymentMethod: "Ticket Alimentação" }, "VALE"],
  ["'Espécie' é dinheiro (o caixa não reconhecia)", { source: "PRESENCIAL", paymentMethod: "Espécie" }, "DINHEIRO"],
];
for (const [oQue, pedido, esperado] of casos) confere(oQue, formaDoPedido(pedido), esperado);

confere("parte do dividido 'Cartão Crédito'", formaDoTexto("Cartão Crédito"), "CREDITO");
confere("baixa de mesa 'Fiado' vira fiado (o caixa diria não identificado)", formaDoTexto("Fiado"), "FIADO");
confere("texto vazio é não identificado", formaDoTexto(""), "OUTROS");

// ── 2. O cupom da plataforma ────────────────────────────────────────────────
console.log("\n— Cupom da plataforma —");
confere("iFood pelo discountIfood", cupomDaPlataforma({ source: "IFOOD", discountIfood: 13.02, discountTotal: 18.02, discountMerchant: 5 }), 13.02);
confere("sem discountIfood: total − loja", cupomDaPlataforma({ source: "IFOOD", discountTotal: 20, discountMerchant: 12 }), 8);
confere("Wabiz com desconto só da loja não é cupom da plataforma", cupomDaPlataforma({ source: "WABIZ", discountTotal: 7.48, discountMerchant: 7.48 }), 0);
confere("iFood antigo pelas observações", cupomDaPlataforma({ source: "IFOOD", notes: "Cupom iFood: R$ 5,00" }), 5);
confere("99Food antigo pelas promoções", cupomDaPlataforma({
  source: "99FOOD", discountDetails: { promocoes: [{ promo_discount: 900, shop_subside_price: 900 }, { promo_discount: 500, shop_subside_price: 0 }, { promo_discount: 100, shop_subside_price: 0 }] },
}), 6);
confere("marketplace sem cupom nos campos precisa do detalhe", precisaDoDetalheDoCupom({ source: "IFOOD", status: "ENTREGUE", discountIfood: 0 }), true);
confere("iFood com discountIfood não precisa", precisaDoDetalheDoCupom({ source: "IFOOD", status: "ENTREGUE", discountIfood: 5 }), false);
confere("balcão não precisa", precisaDoDetalheDoCupom({ source: "PRESENCIAL", status: "ENTREGUE" }), false);
confere("cancelado não precisa", precisaDoDetalheDoCupom({ source: "IFOOD", status: "CANCELADO" }), false);

// ── 3. A conta inteira ──────────────────────────────────────────────────────
console.log("\n— Dois dias, com mesa, dividido, cancelado e madrugada —");
const base = { deliveryType: "RETIRADA", tableSessionId: null } as const;
const ped = (id: string, createdAt: string, x: Partial<PedidoParaFormas>): PedidoParaFormas =>
  ({ id, createdAt, status: "ENTREGUE", totalAmount: 0, ...base, ...x });

const PEDIDOS: PedidoParaFormas[] = [
  // 17/09 20:00 em São Paulo (23:00Z)
  ped("p1", "2026-09-17T23:00:00Z", { source: "PDV", paymentMethod: "Dinheiro", totalAmount: 50 }),
  // Dividido de verdade da NIK: 2 no crédito e 1 no débito.
  ped("p2", "2026-09-17T23:10:00Z", {
    source: "PRESENCIAL", totalAmount: 163.8, paymentMethod: "Dividido: Cartão Crédito R$ 63,80 + Cartão Crédito R$ 60,00 + Cartão Débito R$ 40,00",
    paymentMethods: [{ method: "Cartão Crédito", amount: 63.8 }, { method: "Cartão Crédito", amount: 60 }, { method: "Cartão Débito", amount: 40 }],
  }),
  ped("p3", "2026-09-17T23:20:00Z", { source: "IFOOD", ifoodOrderId: "if-3", deliveryType: "DELIVERY", paymentMethod: "Crédito (Pago Online)", totalAmount: 80, discountIfood: 10 }),
  // Cancelado: não entra, mas é contado.
  ped("p4", "2026-09-17T23:30:00Z", { source: "IFOOD", ifoodOrderId: "if-4", status: "CANCELADO", paymentMethod: "Pix (Pago Online)", totalAmount: 100 }),
  // 19/09 01:30 em São Paulo: é do expediente de 18/09.
  ped("p5", "2026-09-19T04:30:00Z", { source: "PDV", paymentMethod: "PIX", totalAmount: 30 }),
  // Totem esperando pagamento: intenção, não venda.
  ped("p6", "2026-09-18T15:00:00Z", { source: "TOTEM", status: "AGUARDANDO_PAGAMENTO", paymentMethod: "Cartão (Maquininha)", totalAmount: 25 }),
  // Pedido da conta S1 (fecha no período): venda, mas o pagamento é da conta.
  ped("p7", "2026-09-18T22:00:00Z", { source: "PRESENCIAL", tableSessionId: "S1", deliveryType: "MESA", paymentMethod: "N/A", totalAmount: 100 }),
  // Pedido da conta S2, fechada com desconto.
  ped("pm2", "2026-09-17T22:00:00Z", { source: "PRESENCIAL", tableSessionId: "S2", deliveryType: "MESA", paymentMethod: "N/A", totalAmount: 80 }),
  // Pedido da conta S3, que ainda está aberta.
  ped("p9", "2026-09-18T23:00:00Z", { source: "PRESENCIAL", tableSessionId: "S3", deliveryType: "MESA", paymentMethod: "N/A", totalAmount: 45 }),
  ped("p10", "2026-09-17T18:00:00Z", { source: "PRESENCIAL", paymentMethod: "Conta Funcionário", totalAmount: 7.2 }),
  ped("p11", "2026-09-17T19:00:00Z", { source: "WABIZ", paymentMethod: "A combinar (Cobrar na Entrega)", totalAmount: 38.3 }),
  // Cortesia de R$ 0: é venda, não é pagamento.
  ped("p12", "2026-09-18T19:00:00Z", { source: "PDV", paymentMethod: "Dinheiro", totalAmount: 0 }),
];

const MESAS: MesaParaFormas[] = [
  // Consumo 120 (p7 + um pedido de 16/09), serviço 12, gorjeta 5: a conta é
  // 137. Entregou Pix 100 + nota de 50: R$ 13 de troco saem da gaveta, e o
  // dinheiro que ficou foi 37.
  {
    id: "S1", fechadaEm: "2026-09-19T01:00:00Z", totalPago: 150, taxaDeServico: 12, gorjeta: 5,
    pagamentos: [{ method: "Pix", amount: 100 }, { method: "Dinheiro", amount: 50 }],
    pedidos: [{ id: "p7", totalAmount: 100, status: "ENTREGUE" }, { id: "antigo", totalAmount: 20, status: "ENTREGUE" }, { id: "cancelado", totalAmount: 99, status: "CANCELADO" }],
  },
  // Consumo 80, pagou 72: R$ 8 de desconto no fechamento. Fechou à 0h30 de 18/09 (03:30Z).
  {
    id: "S2", fechadaEm: "2026-09-18T03:30:00Z", totalPago: 72, taxaDeServico: 0, gorjeta: null,
    pagamentos: [{ method: "Cartão Crédito", amount: 72 }],
    pedidos: [{ id: "pm2", totalAmount: 80, status: "ENTREGUE" }],
  },
];

const periodo = { de: "2026-09-17", ate: "2026-09-18", tz: "America/Sao_Paulo" };
// A conta S3 ainda está aberta (a rota diz a situação das contas dos pedidos de mesa que não fecharam no recorte).
const r = formasDePagamento(PEDIDOS, MESAS, periodo, [{ id: "S3", status: "OPEN", fechadaEm: null }]);
const forma = (k: string) => r.formas.find((f) => f.chave === k)!;
const resumo = (k: string) => { const f = forma(k); return { pagamentos: f.pagamentos, contas: f.contas, valor: f.valor }; };

confere("dias do período", r.dias, ["2026-09-17", "2026-09-18"]);
confere("as 8 formas, na ordem do caixa", r.formas.map((f) => f.chave), ["DINHEIRO", "PIX", "CREDITO", "DEBITO", "VALE", "ONLINE", "FIADO", "OUTROS"]);
confere("Dinheiro: balcão + baixa da mesa SEM o troco (50 − 13)", resumo("DINHEIRO"), { pagamentos: 2, contas: 2, valor: 87 });
confere("Pix: madrugada + baixa da mesa", resumo("PIX"), { pagamentos: 2, contas: 2, valor: 130 });
confere("Crédito: 2 partes do dividido (1 venda) + a mesa com desconto", resumo("CREDITO"), { pagamentos: 3, contas: 2, valor: 195.8 });
confere("Débito: a parte do dividido", resumo("DEBITO"), { pagamentos: 1, contas: 1, valor: 40 });
confere("Vale: nada", resumo("VALE"), { pagamentos: 0, contas: 0, valor: 0 });
confere("Pago online: só o iFood não cancelado", resumo("ONLINE"), { pagamentos: 1, contas: 1, valor: 80 });
confere("Pago online aberto por canal", forma("ONLINE").porCanal.map((c) => [c.rotulo, c.valor]), [["iFood", 80]]);
confere("Fiado", resumo("FIADO"), { pagamentos: 1, contas: 1, valor: 7.2 });
confere("Não identificado mostra o texto", forma("OUTROS").textos.map((t) => [t.rotulo, t.valor]), [["A combinar (Cobrar na Entrega)", 38.3]]);
confere("Crédito aberto por canal (a mesa separada do balcão)", forma("CREDITO").porCanal.map((c) => [c.rotulo, c.valor]), [["PDV", 123.8], ["Mesa", 72]]);
confere("total dos pagamentos (contas = pedidos e contas de mesa distintos; o dividido conta uma vez)", r.total, { pagamentos: 11, contas: 8, valor: 578.3, mediaPorConta: 72.29, porDia: [411.3, 167] });
confere("% do crédito", forma("CREDITO").pct, 33.86);
confere("média do crédito é POR CONTA (195,80 ÷ 2), não por pagamento", forma("CREDITO").mediaPorConta, 97.9);
confere("madrugada de 19/09 cai no dia 18/09", forma("PIX").porDia, [0, 130]);
confere("mesa fechada à 0h30 de 18/09 é do dia 17/09", forma("CREDITO").porDia, [195.8, 0]);
confere("grupos: loja / online / sem dinheiro (valor e contas distintas)", r.grupos.map((g) => [g.chave, g.valor, g.contas]), [["LOJA", 452.8, 5], ["ONLINE", 80, 1], ["SEM_DINHEIRO", 45.5, 2]]);
confere("total das vendas: a régua única (mesa pelo pedido, sem cancelado e sem totem pendente); 3 mesas de um lançamento cada",
  r.vendas, { atendimentos: 10, mesas: 3, pedidos: 10, valor: 594.3, ticketMedio: 59.43 });
confere("mesas fechadas, com o troco devolvido à parte", r.mesas, { fechadas: 2, valor: 209, taxaDeServico: 12, gorjeta: 5, troco: { contas: 1, valor: 13 } });
confere("cancelados e pendentes contados à parte", r.foraDaVenda, { cancelados: { pedidos: 1, valor: 100 }, aguardandoPagamento: { pedidos: 1, valor: 25 }, valoresImpossiveis: 0 });

console.log("\n— Total das vendas pela régua única —");
// A 2ª rodada da mesa S1 é lançamento, não venda: o cartão "Total das vendas"
// diz o mesmo número de vendas do Vendas por período e do Faturamento por dia
// (antes dizia "N pedidos", contando cada rodada — Pastel da Paulista,
// 09–16/09/2026: 635 aqui contra 495 no Faturamento).
const comRodada = formasDePagamento([...PEDIDOS, ped("p7b", "2026-09-18T23:30:00Z", { source: "PRESENCIAL", tableSessionId: "S1", deliveryType: "MESA", paymentMethod: "N/A", totalAmount: 20 })], [], periodo);
confere("mesa com duas rodadas: 11 lançamentos, 10 vendas; o valor soma as duas", [comRodada.vendas.pedidos, comRodada.vendas.atendimentos, comRodada.vendas.valor], [11, 10, 614.3]);
// O #112 da Pastel da Paulista: cancelado de R$ 1e17. Somado aos cancelados,
// o "Cancelados (não entram)" daqui saía com 18 dígitos.
const comAbsurdo = formasDePagamento([...PEDIDOS, ped("p112", "2026-09-17T23:40:00Z", { source: "SITE", status: "CANCELADO", paymentMethod: "Pix", totalAmount: 1e17 })], MESAS, periodo, [{ id: "S3", status: "OPEN", fechadaEm: null }]);
confere("valor impossível fica fora até dos cancelados, contado à parte",
  [comAbsurdo.foraDaVenda.cancelados, comAbsurdo.foraDaVenda.valoresImpossiveis, comAbsurdo.vendas.valor], [{ pedidos: 1, valor: 100 }, 1, 594.3]);
confere("cupom do iFood", { pedidos: r.cupomDaPlataforma.pedidos, valor: r.cupomDaPlataforma.valor }, { pedidos: 1, valor: 10 });
confere("a diferença: pagamentos − vendas", r.diferenca.valor, -16);
confere("a ponte explica a diferença inteira, linha a linha (o troco não é diferença: não entrou)", r.diferenca.linhas.map((l) => [l.chave, l.valor, l.quantidade]), [
  ["SERVICO", 12, 1], ["GORJETA", 5, 1], ["DESCONTO_MESA", -8, 1], ["MESA_ABERTA", -45, 1], ["MESA_DE_ANTES", 20, 1],
]);

// ── 3b. Troco na mesa ───────────────────────────────────────────────────────
// A baixa da mesa grava o que o cliente ENTREGOU ("Informe quanto foi
// recebido"), e a tela manda devolver o troco (MesasApp: troco = recebido −
// conta). Casos da Pastel da Paulista, 01–23/09/2026.
console.log("\n— Troco devolvido na mesa —");
const mesaSimples = (id: string, consumo: number, servico: number, pagamentos: { method: string; amount: number }[]) => ({
  pedido: ped(`o-${id}`, "2026-09-17T20:00:00Z", { source: "PRESENCIAL", tableSessionId: id, deliveryType: "MESA", paymentMethod: "N/A", totalAmount: consumo }),
  mesa: { id, fechadaEm: "2026-09-17T21:00:00Z", totalPago: pagamentos.reduce((s, p) => s + p.amount, 0), taxaDeServico: servico, gorjeta: null,
    pagamentos, pedidos: [{ id: `o-${id}`, totalAmount: consumo, status: "ENTREGUE" }] } as MesaParaFormas,
});
const comTroco = [
  mesaSimples("T1", 13.9, 0, [{ method: "Dinheiro", amount: 50 }]),                                  // nota de 50: troco 36,10
  mesaSimples("T2", 35.3, 3.53, [{ method: "Dinheiro", amount: 100 }]),                              // nota de 100: troco 61,17
  mesaSimples("T3", 86, 0, [{ method: "Cartão Crédito", amount: 100 }]),                             // a mais no cartão: não há troco em dinheiro
  mesaSimples("T4", 60, 0, [{ method: "Pix", amount: 50 }, { method: "Dinheiro", amount: 20 }]),     // troco 10 sai da nota de 20
  mesaSimples("T5", 80, 0, [{ method: "Cartão Crédito", amount: 90 }, { method: "Dinheiro", amount: 5 }]), // sobra 15, só 5 em dinheiro
];
const t = formasDePagamento(comTroco.map((x) => x.pedido), comTroco.map((x) => x.mesa), { de: "2026-09-17", ate: "2026-09-17", tz: "America/Sao_Paulo" });
const formaT = (k: string) => { const f = t.formas.find((x) => x.chave === k)!; return { pagamentos: f.pagamentos, valor: f.valor }; };
confere("Dinheiro é o que ficou na gaveta: 13,90 + 38,83 + 10 (a nota de 5 da T5 virou troco inteira)", formaT("DINHEIRO"), { pagamentos: 3, valor: 62.73 });
confere("o que passou no cartão e no Pix não muda", [formaT("CREDITO"), formaT("PIX")], [{ pagamentos: 2, valor: 190 }, { pagamentos: 1, valor: 50 }]);
confere("troco devolvido: 36,10 + 61,17 + 10 + 5 em 4 contas", t.mesas.troco, { contas: 4, valor: 112.27 });
confere("a ponte só mostra a taxa e o que foi pago A MAIS fora do dinheiro (T3 14 + T5 10)", t.diferenca.linhas.map((l) => [l.chave, l.valor, l.quantidade]), [["SERVICO", 3.53, 1], ["SOBRA", 24, 2]]);
confere("pagamentos − vendas = 302,73 − 275,20", [t.total.valor, t.vendas.valor, t.diferenca.valor], [302.73, 275.2, 27.53]);

// ── 3c. Pedido de mesa sem pagamento no recorte ─────────────────────────────
// Com faixa de horário, a conta que FECHOU no período fora da faixa não entra
// (a rota filtra a conta pelo fechamento), mas o pedido dela, lançado dentro
// da faixa, entra. Na Pastel (01–15/09, 12h–19h) isso aparecia como "mesa ainda
// sem pagamento" de R$ 3.495,65 — e a loja não tinha mesa aberta nenhuma.
console.log("\n— Pedido de mesa cujo pagamento não entra no recorte —");
const semConta = formasDePagamento([
  ped("a1", "2026-09-17T16:00:00Z", { source: "PRESENCIAL", tableSessionId: "A", deliveryType: "MESA", paymentMethod: "N/A", totalAmount: 10 }),
  ped("a2", "2026-09-17T16:10:00Z", { source: "PRESENCIAL", tableSessionId: "A2", deliveryType: "MESA", paymentMethod: "N/A", totalAmount: 1 }),
  ped("b1", "2026-09-18T23:00:00Z", { source: "PRESENCIAL", tableSessionId: "B", deliveryType: "MESA", paymentMethod: "N/A", totalAmount: 20 }),
  ped("c1", "2026-09-17T17:00:00Z", { source: "PRESENCIAL", tableSessionId: "C", deliveryType: "MESA", paymentMethod: "N/A", totalAmount: 30 }),
  ped("c2", "2026-09-17T17:30:00Z", { source: "PRESENCIAL", tableSessionId: "C", deliveryType: "MESA", paymentMethod: "N/A", totalAmount: 5 }),
  ped("d1", "2026-09-17T18:00:00Z", { source: "PRESENCIAL", tableSessionId: "D", deliveryType: "MESA", paymentMethod: "N/A", totalAmount: 40 }),
], [], periodo, [
  { id: "A", status: "OPEN", fechadaEm: null },
  { id: "A2", status: "CLOSING", fechadaEm: null },
  // Fechou às 2h de 20/09 (05:00Z): depois do fim do período (18/09).
  { id: "B", status: "CLOSED", fechadaEm: "2026-09-20T05:00:00Z" },
  // Fechou em 17/09 às 23h, fora da faixa do filtro — por isso a conta não veio.
  { id: "C", status: "CLOSED", fechadaEm: "2026-09-18T02:00:00Z" },
  // D: a rota não achou a conta (não deveria acontecer): linha genérica.
]);
confere("cada motivo na sua linha — só a mesa aberta de verdade diz 'aberta'", semConta.diferenca.linhas.map((l) => [l.chave, l.valor, l.quantidade]), [
  ["MESA_ABERTA", -11, 2], ["MESA_FECHOU_DEPOIS", -20, 1], ["MESA_FORA_DO_FILTRO", -35, 2], ["MESA_SEM_PAGAMENTO", -40, 1],
]);
confere("sem a situação das contas, tudo cai na linha genérica (nunca 'aberta' por palpite)",
  formasDePagamento([ped("x", "2026-09-17T16:00:00Z", { source: "PRESENCIAL", tableSessionId: "X", deliveryType: "MESA", paymentMethod: "N/A", totalAmount: 9 })], [], periodo)
    .diferenca.linhas.map((l) => [l.chave, l.valor]), [["MESA_SEM_PAGAMENTO", -9]]);

// ── 3d. Média por conta (não é o ticket médio da régua) ──────────────────────────────────────────────
console.log("\n— Média por conta —");
const quatroBaixas = formasDePagamento(
  [ped("q", "2026-09-17T20:00:00Z", { source: "PRESENCIAL", tableSessionId: "Q", deliveryType: "MESA", paymentMethod: "N/A", totalAmount: 100 })],
  [{ id: "Q", fechadaEm: "2026-09-17T21:00:00Z", totalPago: 100, taxaDeServico: 0, gorjeta: null,
    pagamentos: [25, 25, 25, 25].map((amount) => ({ method: "Cartão Débito", amount })), pedidos: [{ id: "q", totalAmount: 100, status: "ENTREGUE" }] }],
  { de: "2026-09-17", ate: "2026-09-17", tz: "America/Sao_Paulo" });
const debitoQ = quatroBaixas.formas.find((f) => f.chave === "DEBITO")!;
confere("mesa de R$ 100 em 4 baixas de 25 no débito: 4 pagamentos, 1 conta, média R$ 100", [debitoQ.pagamentos, debitoQ.contas, debitoQ.mediaPorConta], [4, 1, 100]);

// ── 4. Centavos ─────────────────────────────────────────────────────────────
console.log("\n— Centavos —");
const d = formasDePagamento([
  // Gravado assim no banco (NIK, 17–23/09): 95.69999999999999. Não pode virar diferença.
  ped("f1", "2026-09-17T20:00:00Z", { source: "PRESENCIAL", totalAmount: 95.69999999999999, paymentMethods: [{ method: "Cartão Crédito", amount: 31.9 }, { method: "Cartão Crédito", amount: 63.8 }] }),
  ped("f2", "2026-09-17T20:00:00Z", { source: "PRESENCIAL", totalAmount: 99.99, paymentMethods: [{ method: "Pix", amount: 33.33 }, { method: "Pix", amount: 33.33 }, { method: "Pix", amount: 33.33 }] }),
  // 2 centavos de tolerância do balcão.
  ped("f3", "2026-09-17T20:00:00Z", { source: "PRESENCIAL", totalAmount: 100, paymentMethods: [{ method: "Dinheiro", amount: 50.01 }, { method: "Dinheiro", amount: 50.01 }] }),
], [], { de: "2026-09-17", ate: "2026-09-17", tz: "America/Sao_Paulo" });
confere("float gravado não vira diferença; os 2 centavos do dividido aparecem", d.diferenca.linhas.map((l) => [l.chave, l.valor, l.quantidade]), [["DIVIDIDO", 0.02, 1]]);
confere("total em centavos exatos", d.total.valor, 295.71);

// ── 5. Mesa antiga sem as baixas ────────────────────────────────────────────
console.log("\n— Mesa sem baixas gravadas —");
const m = formasDePagamento([], [{ id: "V", fechadaEm: "2026-09-17T23:00:00Z", totalPago: 90, taxaDeServico: 0, gorjeta: 0, pagamentos: null, pedidos: [] }],
  { de: "2026-09-17", ate: "2026-09-17", tz: "America/Sao_Paulo" });
const outrosDaMesa = m.formas.find((f) => f.chave === "OUTROS")!;
confere("o dinheiro não some: vai para não identificado", [outrosDaMesa.valor, outrosDaMesa.textos[0]?.rotulo], [90, "Mesa sem a forma registrada"]);

// Pastel da Paulista, conta de 05/09/2026: taxa NEGATIVA era o desconto antigo.
const neg = formasDePagamento(
  [ped("pn", "2026-09-17T22:00:00Z", { source: "PRESENCIAL", tableSessionId: "N", deliveryType: "MESA", paymentMethod: "N/A", totalAmount: 125.4 })],
  [{ id: "N", fechadaEm: "2026-09-17T23:45:00Z", totalPago: 76.49, taxaDeServico: -48.90600000000001, gorjeta: null,
    pagamentos: [{ method: "Pix", amount: 76.49 }],
    pedidos: [{ id: "pn", totalAmount: 125.4, status: "ENTREGUE" }, { id: "c1", totalAmount: 61.6, status: "CANCELADO" }] }],
  { de: "2026-09-17", ate: "2026-09-17", tz: "America/Sao_Paulo" });
confere("taxa de serviço negativa vira desconto, não encolhe a taxa", [neg.mesas.taxaDeServico, neg.diferenca.linhas.map((l) => [l.chave, l.valor])], [0, [["DESCONTO_MESA", -48.91]]]);

// ── 5b. Revisão de 24/09/2026: a ponte na régua única ───────────────────────
console.log("\n— A ponte usa a régua única (serviço, gorjeta e desconto do Vendas por período) —");
const MESMO_DIA = { de: "2026-09-17", ate: "2026-09-17", tz: "America/Sao_Paulo" };
const mesaDe = (id: string, fechadaEm: string, consumo: number, pago: number, taxa: number, extra: Partial<MesaParaFormas> = {}) => ({
  pedido: ped(`o-${id}`, "2026-09-17T20:00:00Z", { source: "PRESENCIAL", tableSessionId: id, deliveryType: "MESA", paymentMethod: "N/A", totalAmount: consumo }),
  mesa: { id, fechadaEm, totalPago: pago, taxaDeServico: taxa, gorjeta: null, pagamentos: [{ method: pago ? "Pix" : "Misto", amount: pago }],
    pedidos: [{ id: `o-${id}`, totalAmount: consumo, status: "ENTREGUE" }], ...extra } as MesaParaFormas,
});
// Ruíco Burger: a conta de 20/08/2026 fechou com R$ 12 de consumo e nada pago
// ([{ amount: 0, method: "Misto" }]). Antes de 13/09 o fechamento não tinha
// desconto: o Vendas e o Faturamento diziam R$ 0 de desconto na mesa, e a
// ponte daqui dizia "Desconto dado no fechamento" −R$ 12,00.
const ruico = mesaDe("RU", "2026-08-20T01:57:00Z", 12, 0, 0);
const pRuico = formasDePagamento([ruico.pedido], [ruico.mesa], MESMO_DIA);
confere("conta mal fechada antes de 13/09 NÃO é desconto: vai para 'recebendo menos que a conta'",
  pRuico.diferenca.linhas.map((l) => [l.chave, l.valor, l.quantidade]), [["MESA_A_MENOS", -12, 1]]);
// A cortesia da Pastel da Paulista (fechada em 13/09/2026, R$ 125,40, nada pago): é desconto.
const cortesia = mesaDe("CO", "2026-09-13T21:43:50Z", 125.4, 0, 0);
const pCortesia = formasDePagamento([cortesia.pedido], [cortesia.mesa], MESMO_DIA);
confere("desde 13/09 o pago a menos é desconto no fechamento", pCortesia.diferenca.linhas.map((l) => [l.chave, l.valor, l.quantidade]), [["DESCONTO_MESA", -125.4, 1]]);
const comDescontoNoPedido = mesaDe("DP", "2026-09-17T21:00:00Z", 100, 90, 0, { pedidos: [{ id: "o-DP", totalAmount: 100, status: "ENTREGUE", discountTotal: 10 }] });
confere("pedido da conta que já traz desconto: a régua não soma o da conta por cima, e a ponte também não (antes: −10 de 'desconto')",
  formasDePagamento([comDescontoNoPedido.pedido], [comDescontoNoPedido.mesa], MESMO_DIA).diferenca.linhas.map((l) => l.chave), ["MESA_A_MENOS"]);
// O mesmo desconto e a mesma taxa do Vendas por período, no mesmo recorte.
const variasMesas = [ruico, cortesia, comDescontoNoPedido,
  mesaDe("A", "2026-09-17T21:00:00Z", 63.59, 69.95, 6.359), mesaDe("B", "2026-09-17T21:00:00Z", 63.55, 69.91, 6.355), mesaDe("C", "2026-09-17T21:00:00Z", 63.55, 69.91, 6.355)];
const pVarias = formasDePagamento(variasMesas.map((x) => x.pedido), variasMesas.map((x) => x.mesa), MESMO_DIA);
const vVarias = resumoDeVendas(variasMesas.map((x) => ({ ...x.pedido, franchiseeId: "l" }) as PedidoParaVendas), variasMesas.map((x) => ({
  id: x.mesa.id, serviceFee: x.mesa.taxaDeServico, waiterTip: x.mesa.gorjeta, fechadaEm: x.mesa.fechadaEm, pago: x.mesa.totalPago, pedidos: x.mesa.pedidos })));
const linhaDe = (res: typeof pVarias, k: string) => res.diferenca.linhas.find((l) => l.chave === k)?.valor ?? 0;
confere("desconto na mesa da ponte = o do Vendas por período (R$ 125,40, só a cortesia)",
  [-linhaDe(pVarias, "DESCONTO_MESA"), vVarias.servico.descontoNaMesa], [125.4, 125.4]);
// Taxa gravada crua: 6,359 + 6,355 + 6,355 = 19,069 → R$ 19,07 na soma crua (a
// do Vendas e do relatório de mesas); conta a conta, 6,36 + 6,36 + 6,36 = 19,08.
// Pastel da Paulista, 01–24/09/2026 só Mesa: 2.457,44 lá × 2.457,48 aqui.
confere("taxa de serviço = a do Vendas por período (soma crua), na ponte e no resumo das mesas",
  [linhaDe(pVarias, "SERVICO"), pVarias.mesas.taxaDeServico, vVarias.servico.taxa], [19.07, 19.07, 19.07]);
confere("o centavo das contas arredondadas fica numa linha própria, e a ponte continua fechando sem 'Outras diferenças'",
  [linhaDe(pVarias, "SERVICO_CENTAVOS"), pVarias.diferenca.linhas.some((l) => l.chave === "OUTROS")], [0.01, false]);

console.log("\n— Vendas e ticket da régua × contas pagas da tabela —");
// Pastel da Paulista, 11/09/2026: "97 pagamentos em 92 vendas" e ticket R$ 68,70
// na tabela contra 93 vendas e ticket R$ 66,17 no cartão e nos outros relatórios.
// A tabela agora conta CONTAS (outra coisa), e "vendas" e "ticket" são só da régua.
confere("a tabela conta contas pagas; vendas e ticket vêm da régua",
  [r.total.contas, r.vendas.atendimentos, r.vendas.ticketMedio, "vendas" in r.total, "ticketMedio" in r.total], [8, 10, 59.43, false, false]);
const vR = resumoDeVendas(PEDIDOS.map((p) => ({ ...p, franchiseeId: "l" }) as PedidoParaVendas));
confere("…e o ticket do cartão é o do Vendas por período no mesmo recorte", [r.vendas.atendimentos, r.vendas.ticketMedio], [vR.atendimentos, vR.ticketMedio]);

console.log("\n— Valor impossível pelo item (a rota busca os itens) —");
// Total gravado R$ 50, item de R$ 2 milhões: saía do Vendas, do Faturamento e
// do Dia e hora e ficava aqui, porque a rota não buscava os itens.
const comItemAbsurdo = formasDePagamento([
  ped("i1", "2026-09-17T20:00:00Z", { source: "PDV", paymentMethod: "Dinheiro", totalAmount: 30, items: [{ quantity: 1, price: 30 }] }),
  ped("i2", "2026-09-17T20:10:00Z", { source: "PDV", paymentMethod: "Dinheiro", totalAmount: 50, items: [{ quantity: 1, price: 2_000_000 }] }),
], [], MESMO_DIA);
confere("fica fora do valor e das vendas, contado à parte", [comItemAbsurdo.vendas.valor, comItemAbsurdo.vendas.atendimentos, comItemAbsurdo.foraDaVenda.valoresImpossiveis], [30, 1, 1]);
confere("a rota busca preço e quantidade dos itens", COLUNAS_DO_PEDIDO.items, { select: { quantity: true, price: true } });

// ── 6. Nada no período ──────────────────────────────────────────────────────
const vazio = formasDePagamento([], [], { de: "2026-09-17", ate: "2026-09-23", tz: "America/Sao_Paulo" });
confere("período vazio: 7 dias zerados, % zero, sem diferença", [vazio.dias.length, vazio.total.valor, vazio.formas.every((f) => f.pct === 0), vazio.diferenca.linhas.length], [7, 0, true, 0]);

console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
