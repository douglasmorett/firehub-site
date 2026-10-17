/**
 * Trava a forma de pagamento da mesa no pedido (lib/pagamento-da-mesa-no-pedido.ts)
 * e o Histórico de mesas (lib/relatorios/historico-de-mesas.ts) — pedido do
 * Allan, Delicias de Casa, 17/10/2026.
 *
 *   npx tsx scripts/teste-historico-de-mesas.ts
 *
 * (Fora da pasta com .env: DATABASE_URL e NEXTAUTH_SECRET de mentira bastam —
 * a janela do dia vem de lib/relatorios/servidor.ts, que importa o prisma e a
 * autenticação, mas o teste não conecta em nada.)
 *
 *  1. A rodada de mesa já paga mostra a forma da CONTA (não "N/A" nem "cobrar
 *     na entrega"), no card e no papel; a de conta aberta, "na conta da mesa";
 *     a "Mesa 20" do PDV, sem conta, segue com a forma dela.
 *  2. O histórico: a soma das linhas fecha com o resumo, e o resumo é o MESMO
 *     do Relatório de Mesas (mesasFechadasDoRelatorio) — mesa conta uma vez,
 *     troco fora do consumo, desconto à parte.
 *  3. A forma de cada mesa sem o troco é a mesma do Formas de pagamento
 *     (baixasDaConta, a função que os dois usam).
 *  4. O dia vira às 5h no fuso da loja: a mesa fechada à 1h30 é de ontem.
 *  5. O detalhe: rodadas na ordem, a cancelada fora da conta, cada baixa.
 */
import { camposDoPagamentoDaMesaParaImpressao, formasDasBaixas, pagamentoDaMesaNoPedido } from "../src/lib/pagamento-da-mesa-no-pedido";
import { detalheDaMesa, historicoDeMesas, horaNaLoja, type SessaoDoHistorico } from "../src/lib/relatorios/historico-de-mesas";
import { mesasFechadasDoRelatorio } from "../src/lib/relatorios/relatorio-de-mesas";
import { formasDePagamento } from "../src/lib/relatorios/formas-de-pagamento";
import { janelaDoPeriodo } from "../src/lib/relatorios/servidor";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};
const SP = "America/Sao_Paulo";
const cent = (v: number) => Math.round(v * 100);

// ── 1) A forma da mesa no pedido ────────────────────────────────────────────
console.log("\n1) A forma de pagamento da rodada de mesa (card, Ver pedido, papel)");

confere("pedido de delivery: não é com esta régua (null)", pagamentoDaMesaNoPedido({ tableSessionId: null }), null);
confere("\"Mesa 20\" do PDV sem conta: segue com a forma dele (null)", pagamentoDaMesaNoPedido({ tableSessionId: undefined, tableSession: null }), null);

const aberta = pagamentoDaMesaNoPedido({ tableSessionId: "s1", tableSession: { status: "OPEN", paymentMethods: [{ uid: "a", method: "Pix", amount: 10 }] } });
confere("conta aberta (mesmo com baixa parcial): na conta da mesa", aberta && [aberta.situacao, aberta.resumo], ["naConta", "Na conta da mesa"]);
const semSessao = pagamentoDaMesaNoPedido({ tableSessionId: "s1" });
confere("feed sem a sessão: na conta da mesa — nunca \"cobrar na entrega\"", semSessao?.situacao, "naConta");

// A conta da mesa 5 da Delicias de Casa: duas pessoas pagaram em dinheiro, uma em Pix.
const baixas5 = [
  { uid: "1", method: "Dinheiro", amount: 50, guestId: "g1", guestName: "Ana", at: "2026-10-17T22:10:00.000Z", por: "Allan" },
  { uid: "2", method: "Pix", amount: 32.9, guestId: "g2", guestName: "Bia", at: "2026-10-17T22:11:00.000Z", por: "Allan" },
  { uid: "3", method: "dinheiro", amount: 20, guestId: null, guestName: null, at: "2026-10-17T22:12:00.000Z", por: "Garçom Rafa" },
];
const paga = pagamentoDaMesaNoPedido({ tableSessionId: "s5", tableSession: { status: "CLOSED", paymentMethods: baixas5, totalPaid: 102.9 } });
confere("conta fechada: situação paga", paga?.situacao, "paga");
confere("…resumo do card: as formas da conta, Dinheiro agrupado", paga?.resumo, "Mesa paga: Dinheiro + Pix");
confere("…texto com os valores (o que vai na linha da forma do papel)", paga?.texto, "Dinheiro R$ 70,00 + Pix R$ 32,90");
confere("…recebido = soma das baixas, no centavo", paga && paga.situacao === "paga" ? paga.recebido : null, 102.9);
confere("formato antigo da coluna [{method, amount}] também lê", formasDasBaixas([{ method: "Crédito", amount: 40 }, { metodo: "Pix", valor: 5 }]), [{ forma: "Crédito", valor: 40 }, { forma: "Pix", valor: 5 }]);

const antiga = pagamentoDaMesaNoPedido({ tableSessionId: "s0", tableSession: { status: "CLOSED", paymentMethods: null, totalPaid: 48 } });
confere("conta antiga paga sem as baixas: forma não registrada (não \"N/A\")", antiga && [antiga.situacao, antiga.resumo], ["semForma", "Mesa paga (forma não registrada)"]);
const liberada = pagamentoDaMesaNoPedido({ tableSessionId: "sl", tableSession: { status: "CLOSED", paymentMethods: [], totalPaid: 0 } });
confere("mesa liberada sem pagamento", liberada?.situacao, "liberada");

console.log("\n   O papel do botão Imprimir");
confere("rodada de conta aberta: o papel não muda ({}) — sai \"na conta da mesa\"", camposDoPagamentoDaMesaParaImpressao({ tableSessionId: "s1", tableSession: { status: "OPEN" }, notes: "sem cebola" }), {});
confere("pedido fora da mesa: o papel não muda ({})", camposDoPagamentoDaMesaParaImpressao({ tableSessionId: null, notes: "x" }), {});
const papel = camposDoPagamentoDaMesaParaImpressao({ tableSessionId: "s5", tableSession: { status: "CLOSED", paymentMethods: baixas5 }, notes: "📝 Sem cebola" });
confere("rodada paga: a forma na linha da forma (Assistente antigo)", papel.paymentMethod, "Dinheiro R$ 70,00 + Pix R$ 32,90");
confere("…e na observação, marcada com 📝, antes do recado do cliente (que continua lá)", papel.notes, "📝 Mesa paga: Dinheiro R$ 70,00 + Pix R$ 32,90\n📝 Sem cebola");
confere("…sem recado: só a linha da mesa", camposDoPagamentoDaMesaParaImpressao({ tableSessionId: "s5", tableSession: { status: "CLOSED", paymentMethods: baixas5 } }).notes, "📝 Mesa paga: Dinheiro R$ 70,00 + Pix R$ 32,90");
confere("…nenhuma linha do papel diz \"cobrar na entrega\"", /cobrar/i.test(`${papel.paymentMethod} ${papel.notes}`), false);

// ── 2) O histórico do dia ───────────────────────────────────────────────────
console.log("\n2) O histórico: a soma das linhas = o resumo = o Relatório de Mesas");

const item = (productName: string, quantity: number, price: number, extra: Record<string, unknown> = {}) => ({ productName, quantity, price, ...extra });
const sessoes: SessaoDoHistorico[] = [
  // Mesa 2: consumo R$ 7, paga com nota de R$ 100 (troco R$ 93) — o caso do Relatório de Mesas.
  {
    id: "m2", mesa: { numero: 2, nome: null }, garcom: "Rafa", waiterId: "w1",
    abertaEm: "2026-10-17T15:00:00.000Z", fechadaEm: "2026-10-17T15:40:00.000Z",
    serviceFee: 0, waiterTip: 0, totalPaid: 100, paymentMethods: [{ uid: "a", method: "Dinheiro", amount: 100 }],
    pedidos: [{ id: "p21", status: "ENTREGUE", totalAmount: 7, createdAt: "2026-10-17T15:05:00.000Z", items: [item("Café", 2, 3.5)] }],
  },
  // Mesa 5: duas rodadas + uma cancelada, 10% de taxa, paga em Dinheiro + Pix + Dinheiro.
  {
    id: "m5", mesa: { numero: 5, nome: "Varanda" }, garcom: "Rafa", waiterId: "w1", cliente: "Família Souza",
    abertaEm: "2026-10-17T21:30:00.000Z", fechadaEm: "2026-10-17T22:12:00.000Z", fechadaPor: "Allan",
    serviceFee: 9.354, waiterTip: 0, totalPaid: 102.9, paymentMethods: baixas5,
    pedidos: [
      { id: "p51", status: "ENTREGUE", totalAmount: 63.6, dailyOrderNumber: 41, createdAt: "2026-10-17T21:35:00.000Z", items: [item("X-Burguer", 2, 25.9, { tableGuestId: "g1" }), item("Coca 2L", 1, 11.8)] },
      { id: "p52", status: "CANCELADO", totalAmount: 15, dailyOrderNumber: 43, createdAt: "2026-10-17T21:50:00.000Z", items: [item("Batata", 1, 15)] },
      { id: "p53", status: "ENTREGUE", totalAmount: 29.94, dailyOrderNumber: 44, createdAt: "2026-10-17T21:55:00.000Z", items: [item("Coca 2L", 1, 11.8), item("Pudim", 2, 9.07, { tableGuestId: "g2", notes: "sem calda" })] },
    ],
  },
  // Mesa 7: aberta ontem à noite, fechada à 1h30 de hoje (17/10, SP) — é do dia 16 (o dia vira às 5h).
  {
    id: "m7", mesa: { numero: 7, nome: null }, garcom: null, waiterId: null,
    abertaEm: "2026-10-17T02:10:00.000Z", fechadaEm: "2026-10-17T04:30:00.000Z",
    serviceFee: 0, waiterTip: 5, totalPaid: 85, paymentMethods: [{ uid: "a", method: "Crédito", amount: 85 }],
    pedidos: [{ id: "p71", status: "ENTREGUE", totalAmount: 80, createdAt: "2026-10-17T02:15:00.000Z", items: [item("Pizza G", 1, 80)] }],
  },
  // Mesa 9: fechada com desconto de R$ 10 (consumo 50, pago 40).
  {
    id: "m9", mesa: { numero: 9, nome: null }, garcom: "Léo", waiterId: "w2",
    abertaEm: "2026-10-17T19:00:00.000Z", fechadaEm: "2026-10-17T19:50:00.000Z",
    serviceFee: 0, waiterTip: 0, totalPaid: 40, paymentMethods: [{ uid: "a", method: "Débito", amount: 40 }],
    pedidos: [{ id: "p91", status: "ENTREGUE", totalAmount: 50, createdAt: "2026-10-17T19:05:00.000Z", items: [item("Café", 4, 3.5), item("Bolo", 3, 12)] }],
  },
  // Mesa 1: liberada sem consumo.
  {
    id: "m1", mesa: { numero: 1, nome: null }, garcom: "Léo", waiterId: "w2",
    abertaEm: "2026-10-17T18:00:00.000Z", fechadaEm: "2026-10-17T18:05:00.000Z",
    serviceFee: 0, waiterTip: 0, totalPaid: 0, paymentMethods: null, pedidos: [],
  },
];

const h = historicoDeMesas(sessoes, SP);
const relatorio = mesasFechadasDoRelatorio(sessoes.map((s) => ({ id: s.id, waiterId: s.waiterId, garcom: s.garcom, serviceFee: s.serviceFee, waiterTip: s.waiterTip, fechadaEm: s.fechadaEm, pago: s.totalPaid, pedidos: s.pedidos })));
const soma = (f: (m: (typeof h.mesas)[number]) => number) => h.mesas.reduce((s, m) => s + cent(f(m)), 0) / 100;

confere("mesas fechadas: 5, cada mesa UMA vez (a de 3 rodadas também)", h.resumo.fechadas, 5);
confere("consumo do resumo = Relatório de Mesas (\"Consumo nas mesas\")", h.resumo.consumo, relatorio.consumo);
confere("…e = soma das linhas", soma((m) => m.consumo), h.resumo.consumo);
confere("…no valor: 7 + 93,54 + 80 + 50 + 0 (o troco de R$ 93 e a rodada cancelada fora)", h.resumo.consumo, 230.54);
confere("taxa de serviço do resumo = Relatório de Mesas (soma crua, 9,354 → 9,35)", [h.resumo.taxaServico, relatorio.taxaServico], [9.35, 9.35]);
confere("gorjeta = Relatório de Mesas", [h.resumo.gorjetas, relatorio.gorjetas], [5, 5]);
confere("desconto no fechamento à parte = Relatório de Mesas", [h.resumo.descontoNoFechamento, relatorio.descontoNoFechamento, h.resumo.mesasComDesconto], [10, 10, 1]);
confere("total das contas = soma das linhas (consumo − desconto + taxa + gorjeta, sem troco)", h.resumo.totalDasContas, soma((m) => m.totalDaConta));
confere("…no valor: 7 + 102,89 + 85 + 40 + 0", h.resumo.totalDasContas, 234.89);
confere("ticket médio = consumo ÷ mesas", h.resumo.ticketMedio, Math.round((230.54 / 5) * 100) / 100);

const m2 = h.mesas.find((m) => m.id === "m2")!;
confere("mesa de R$ 7 paga com R$ 100: Dinheiro R$ 7,00 e troco R$ 93,00", [m2.pagamentos, m2.troco], [[{ chave: "DINHEIRO", forma: "Dinheiro", valor: 7 }], 93]);
const m5 = h.mesas.find((m) => m.id === "m5")!;
confere("mesa 5: as formas agrupadas, sem troco (102,90 − 102,89 = 1 centavo sai do dinheiro)", m5.pagamentos, [{ chave: "DINHEIRO", forma: "Dinheiro", valor: 69.99 }, { chave: "PIX", forma: "Pix", valor: 32.9 }]);
confere("…2 rodadas (a cancelada não conta), cliente e quem fechou", [m5.rodadas, m5.cliente, m5.fechadaPor], [2, "Família Souza", "Allan"]);
confere("…abertura e fechamento no relógio da loja", [m5.abertura, m5.fechamento, m5.permanenciaMin], ["18:30", "19:12", 42]);
const m1 = h.mesas.find((m) => m.id === "m1")!;
confere("mesa liberada: situação liberada, sem forma", [m1.situacao, m1.pagamentos.length], ["liberada", 0]);
confere("mesa sem garçom: \"Sem garçom\", nunca some", h.mesas.find((m) => m.id === "m7")!.garcom, "Sem garçom");
confere("lista da mais recente para a mais antiga", h.mesas.map((m) => m.id), ["m5", "m9", "m1", "m2", "m7"]);

// ── 3) A forma da mesa = a do Formas de pagamento ──────────────────────────
console.log("\n3) Por forma: a soma das mesas sem o troco = o Formas de pagamento");
const formas = formasDePagamento(
  [],
  sessoes.map((s) => ({ id: s.id, fechadaEm: s.fechadaEm, totalPago: s.totalPaid ?? null, taxaDeServico: s.serviceFee ?? null, gorjeta: s.waiterTip ?? null, pagamentos: s.paymentMethods, pedidos: s.pedidos })),
  { de: "2026-10-16", ate: "2026-10-17", tz: SP },
);
const doFormas = Object.fromEntries(formas.formas.filter((f) => f.valor > 0).map((f) => [f.chave, f.valor]));
const doHistorico = Object.fromEntries(h.resumo.porForma.map((f) => [f.chave, f.valor]));
confere("cada forma do histórico = a mesma forma no Formas de pagamento", doHistorico, doFormas);
confere("troco do histórico = troco das mesas no Formas de pagamento", [h.resumo.troco, formas.mesas.troco.valor], [93.01, 93.01]);
confere("por forma, os valores: Dinheiro 76,99 · Pix 32,90 · Crédito 85 · Débito 40", h.resumo.porForma.map((f) => [f.chave, f.valor, f.mesas]), [["DINHEIRO", 76.99, 2], ["PIX", 32.9, 1], ["CREDITO", 85, 1], ["DEBITO", 40, 1]]);

console.log("\n   O que foi vendido");
confere("itens: só as rodadas que são venda, somados por nome (Batata cancelada fica fora)", h.itens.map((i) => [i.nome, i.quantidade, i.valor]), [
  ["Café", 6, 21], ["Bolo", 3, 36], ["X-Burguer", 2, 51.8], ["Coca 2L", 2, 23.6], ["Pudim", 2, 18.14], ["Pizza G", 1, 80],
]);

// ── 4) O dia operacional ────────────────────────────────────────────────────
console.log("\n4) O dia vira às 5h no fuso da loja");
const m7 = h.mesas.find((m) => m.id === "m7")!;
confere("mesa fechada à 1h30 de 17/10 (SP) é do dia 16", m7.dia, "2026-10-16");
confere("…a abertura de outro dia do calendário mostra o dia", [m7.abertura, m7.fechamento], ["16/10 23:10", "01:30"]);
const j16 = janelaDoPeriodo("2026-10-16", "2026-10-16", SP);
const j17 = janelaDoPeriodo("2026-10-17", "2026-10-17", SP);
const dentro = (j: { inicio: Date; fim: Date }, iso: string) => new Date(iso) >= j.inicio && new Date(iso) < j.fim;
confere("…e a janela do dia 16 (a que a rota usa) a pega; a do 17 não", [dentro(j16, m7.fechadaEm), dentro(j17, m7.fechadaEm)], [true, false]);
confere("mesa 5 (19:12 do dia 17) é do 17", [m5.dia, dentro(j17, m5.fechadaEm)], ["2026-10-17", true]);
confere("hora na loja em outro fuso (Manaus = SP − 1h)", horaNaLoja("2026-10-17T22:12:00.000Z", "America/Manaus"), "18:12");

// ── 5) O detalhe ────────────────────────────────────────────────────────────
console.log("\n5) O detalhe de uma mesa (o clique)");
const d = detalheDaMesa({ ...sessoes[1], pessoas: [{ id: "g1", name: "Ana" }, { id: "g2", name: "Bia" }], observacao: " aniversário " }, SP);
confere("rodadas na ordem do lançamento, com número e hora", d.pedidos.map((p) => [p.numero, p.hora, p.cancelado]), [[41, "18:35", false], [43, "18:50", true], [44, "18:55", false]]);
confere("itens com a pessoa e a observação", d.pedidos[2].itens.map((i) => [i.nome, i.quantidade, i.valor, i.pessoa, i.obs]), [["Coca 2L", 1, 11.8, null, null], ["Pudim", 2, 18.14, "Bia", "sem calda"]]);
confere("cada baixa como foi registrada (antes do troco), com quem lançou", d.baixas.map((b) => [b.forma, b.valor, b.hora, b.por, b.pessoa]), [
  ["Dinheiro", 50, "19:10", "Allan", "Ana"], ["Pix", 32.9, "19:11", "Allan", "Bia"], ["dinheiro", 20, "19:12", "Garçom Rafa", null],
]);
confere("consumo por pessoa (o rateio da conta da mesa)", d.pessoas.map((p) => [p.nome, p.consumo]), [["Ana", 51.8], ["Bia", 18.14]]);
confere("a conta do detalhe = a linha do histórico", [d.consumo, d.taxa, d.totalDaConta], [m5.consumo, m5.taxa, m5.totalDaConta]);
confere("observação da mesa sem espaços", d.observacao, "aniversário");

console.log(`\n${falhas === 0 ? "✅ Tudo certo" : `❌ ${falhas} falha(s)`}`);
process.exit(falhas === 0 ? 0 : 1);
