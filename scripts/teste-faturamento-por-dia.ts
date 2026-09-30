/**
 * Trava o relatório "Faturamento por dia" (lib/relatorios/faturamento-por-dia.ts):
 * o dia operacional, o que é venda, a régua única (a mesa pelo lançado, UMA
 * venda no dia do primeiro lançamento, serviço e desconto no fechamento à
 * parte), a linha que fecha (itens + entrega − descontos + outros = valor) —
 * inclusive na MÉDIA —, a média sem o dia que ainda está aberto, o melhor e o
 * pior dia (nunca o mesmo), o filtro de dias da semana com a comparação pelo
 * mesmo número de cada dia, e a meta do mês (com "25.000" lido como milhar).
 *
 *   npx tsx scripts/teste-faturamento-por-dia.ts
 *
 * Período do teste: quarta 16/09/2026 a segunda 21/09/2026, "hoje" = domingo
 * 20/09 (então 16 a 19 fecharam, 20 está aberto e 21 ainda não chegou).
 * Horários em UTC; a loja está em America/Sao_Paulo (−03).
 */
import {
  VALOR_IMPOSSIVEL, compararPeriodos, consumoDasMesasAbertas, faturamentoPorDia, lerDiasDaSemana, lerMetaDeFaturamento, limiteDaMeta, periodoDeComparacao, progressoDaMeta,
  type PedidoParaFaturamento,
} from "../src/lib/relatorios/faturamento-por-dia";
import type { MesaFechada } from "../src/lib/relatorios/regua-da-venda";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

const TZ = "America/Sao_Paulo";
const HOJE = "2026-09-20";
const item = (quantity: number, price: number) => ({ quantity, price });
let seq = 0;
const p = (x: Omit<PedidoParaFaturamento, "id"> & { id?: string } & Record<string, unknown>): PedidoParaFaturamento => ({ id: `p${++seq}`, ...x });

const PEDIDOS: PedidoParaFaturamento[] = [
  // 17/09, 20h: site com entrega.
  p({ createdAt: "2026-09-17T23:00:00Z", status: "ENTREGUE", totalAmount: 58, deliveryFee: 8, items: [item(1, 50)] }),
  // 17/09, 21h (já é dia 18 em UTC): iFood com cupom e a taxa de serviço do app
  // (R$ 1,99) embutida no total — é o "Outros". Do cupom de R$ 10, R$ 6 o iFood
  // bancou (discountIfood) e repassa à loja; mesmo assim o valor é o totalAmount,
  // a régua da Receita Bruta do Financeiro (DRE).
  p({ createdAt: "2026-09-18T00:00:00Z", status: "ENTREGUE", totalAmount: 51.99, deliveryFee: 8, discountTotal: 10, discountMerchant: 4, discountIfood: 6, items: [item(2, 26)] }),
  // 18/09, 01h30 da madrugada: ainda é o expediente do dia 17.
  p({ createdAt: "2026-09-18T04:30:00Z", status: "ENTREGUE", totalAmount: 40, items: [item(1, 40)] }),
  // 18/09, 05h10: já é o dia 18. Pagamento dividido (Pix + dinheiro) — UMA venda
  // de R$ 100. O item de quantidade 0 (tirado na edição) não conta: a regra do Itens vendidos.
  p({ createdAt: "2026-09-18T08:10:00Z", status: "PRONTO", totalAmount: 100, items: [item(4, 25), item(0, 99)],
    paymentMethods: [{ method: "Pix", amount: 60 }, { method: "Dinheiro", amount: 40 }] }),
  // 18/09: cancelado — fora da venda, dentro da coluna de cancelados.
  p({ createdAt: "2026-09-18T22:00:00Z", status: "CANCELADO", totalAmount: 70, items: [item(1, 70)] }),
  // 18/09: intenções — não são venda nem cancelamento.
  p({ createdAt: "2026-09-18T22:30:00Z", status: "AGUARDANDO_PAGAMENTO", totalAmount: 33, items: [item(1, 33)] }),
  p({ createdAt: "2026-09-18T22:40:00Z", status: "CRIANDO_IA", totalAmount: 44, items: [item(1, 44)] }),
  // Mesa s3: sentou às 04h50 de sábado (expediente de SEXTA 18) e lançou de
  // novo às 05h10 (expediente de sábado 19). É venda na sexta, no 1º
  // lançamento; o valor de cada rodada fica no dia dela.
  p({ id: "s3a", createdAt: "2026-09-19T07:50:00Z", status: "ENTREGUE", totalAmount: 20, tableSessionId: "s3", items: [item(1, 20)] }),
  p({ id: "s3b", createdAt: "2026-09-19T08:10:00Z", status: "ENTREGUE", totalAmount: 25, tableSessionId: "s3", items: [item(1, 25)] }),
  // 19/09: mesa s1 — duas rodadas e uma cancelada.
  p({ id: "s1a", createdAt: "2026-09-19T23:00:00Z", status: "ENTREGUE", totalAmount: 100, tableSessionId: "s1", items: [item(1, 100)] }),
  p({ id: "s1b", createdAt: "2026-09-20T00:00:00Z", status: "ENTREGUE", totalAmount: 50, tableSessionId: "s1", items: [item(2, 25)] }),
  p({ id: "s1c", createdAt: "2026-09-20T00:30:00Z", status: "CANCELADO", totalAmount: 20, tableSessionId: "s1", items: [item(1, 20)] }),
  // 19/09: mesa s2 (paga com troco) e uma mesa que ainda está ABERTA.
  p({ id: "s2a", createdAt: "2026-09-19T22:00:00Z", status: "ENTREGUE", totalAmount: 80, tableSessionId: "s2", items: [item(1, 80)] }),
  p({ id: "ab1", createdAt: "2026-09-19T23:30:00Z", status: "ENTREGUE", totalAmount: 30, tableSessionId: "aberta", items: [item(1, 30)] }),
  // 20/09 (hoje), meio-dia.
  p({ createdAt: "2026-09-20T15:00:00Z", status: "NOVO", totalAmount: 10, items: [item(1, 10)] }),
];

const MESAS: MesaFechada[] = [
  // s1 fechou à 1h do dia 20 (expediente do dia 19). Consumo 150 (a rodada
  // cancelada não conta), R$ 20 de desconto, R$ 13 de serviço e R$ 5 de
  // gorjeta: pagou 148 = 150 − 20 + 13 + 5.
  { id: "s1", fechadaEm: "2026-09-20T04:00:00Z", pago: 148, serviceFee: 13, waiterTip: 5,
    pedidos: [{ status: "ENTREGUE", totalAmount: 100 }, { status: "ENTREGUE", totalAmount: 50 }, { status: "CANCELADO", totalAmount: 20 }] },
  // s2: consumo 80, serviço 8, pagou 100 — os R$ 12 a mais são troco, e troco não é venda nem desconto.
  { id: "s2", fechadaEm: "2026-09-20T01:00:00Z", pago: 100, serviceFee: 8, waiterTip: 0, pedidos: [{ status: "ENTREGUE", totalAmount: 80 }] },
  // s3: fechou no sábado de manhã, pago certinho.
  { id: "s3", fechadaEm: "2026-09-19T10:00:00Z", pago: 45, serviceFee: 0, waiterTip: 0, pedidos: [{ status: "ENTREGUE", totalAmount: 20 }, { status: "ENTREGUE", totalAmount: 25 }] },
  // Mesa liberada sem consumo.
  { id: "s4", fechadaEm: "2026-09-19T20:00:00Z", pago: 0, serviceFee: 0, waiterTip: 0, pedidos: [] },
];

const r = faturamentoPorDia({ de: "2026-09-16", ate: "2026-09-21", tz: TZ, hoje: HOJE, pedidos: PEDIDOS, mesas: MESAS });
const [d16, d17, d18, d19, d20] = r.dias;

console.log("\n1) Um dia por linha, inclusive o sem venda");
confere("seis dias, com o dia da semana (0 = domingo) e o estado",
  r.dias.map((d) => [d.dia.slice(8), d.diaSemana, d.estado]),
  [["16", 3, "fechado"], ["17", 4, "fechado"], ["18", 5, "fechado"], ["19", 6, "fechado"], ["20", 0, "hoje"], ["21", 1, "futuro"]]);
confere("quarta sem venda sai com zero", [d16.vendas, d16.valor, d16.ticketMedio], [0, 0, null]);
confere("dia 17: os dois da noite + o da 1h30 da madrugada", [d17.vendas, d17.lancamentos, d17.valor], [3, 3, 149.99]);
confere("dia 17: a linha fecha — itens 142 + entrega 16 − descontos 10 + outros 1,99 = 149,99",
  [d17.itens, d17.entrega, d17.descontos, d17.outros], [142, 16, 10, 1.99]);
confere("o cupom bancado pelo iFood não volta para o valor (Σ totalAmount, como a Receita Bruta do DRE)", [d17.valor, d17.descontos], [149.99, 10]);
confere("ticket médio do dia", d17.ticketMedio, 50);

console.log("\n2) A régua única: a mesa pelo lançado, uma venda no primeiro lançamento");
confere("dia 18: o dividido é UMA venda; a mesa s3 abriu às 04h50 de sábado — venda da SEXTA; intenção não conta",
  [d18.vendas, d18.mesas, d18.lancamentos, d18.valor], [2, 1, 2, 120]);
confere("dia 18: item de quantidade 0 não entra nos itens (100 + 20)", d18.itens, 120);
confere("dia 18: o cancelado vai para a coluna dele", [d18.canceladosQtd, d18.canceladosValor], [1, 70]);
confere("dia 19: s1, s2 e a mesa aberta são 3 vendas; a 2ª rodada da s3 (05h10) é valor sem venda nova",
  [d19.vendas, d19.mesas, d19.lancamentos, d19.valor], [3, 3, 5, 285]);
confere("dia 19: o valor é o LANÇADO — 150 da s1 (antes: 130, o cobrado) + 80 da s2 + 30 da aberta + 25 da s3",
  d19.valor, 150 + 80 + 30 + 25);
const soAberta = faturamentoPorDia({ de: "2026-09-19", ate: "2026-09-19", tz: TZ, hoje: HOJE, pedidos: PEDIDOS.filter((x) => x.tableSessionId === "aberta"), mesas: [] });
confere("mesa ainda aberta entra pelo lançado, no dia do lançamento — não espera fechar (antes: fora de todo dia)",
  [soAberta.total.valor, soAberta.total.vendas, soAberta.total.mesas], [30, 1, 1]);
confere("rodada de mesa cancelada vai para os cancelados do dia dela", [d19.canceladosQtd, d19.canceladosValor], [1, 20]);
confere("dia 19: o desconto da mesa NÃO entra na coluna Descontos; a linha fecha sem ele",
  [d19.itens, d19.entrega, d19.descontos, d19.outros], [285, 0, 0, 0]);
confere("dia 19: o desconto no fechamento (R$ 20 da s1) fica numa coluna à parte, no dia em que a mesa fechou",
  [d19.descontoNaMesa, d18.descontoNaMesa], [20, 0]);
confere("serviço e gorjeta das mesas fechadas: à parte (13 + 8 + 5)", r.servicoDasMesas, 26);
confere("as mesas fechadas: 4 (inclusive a liberada sem consumo), 1 com desconto; o troco da s2 não é desconto",
  r.mesasFechadas, { taxa: 21, gorjeta: 5, mesas: 4, descontoNaMesa: 20, mesasComDesconto: 1 });

console.log("\n3) Total, média, melhor e pior dia");
confere("acumulado corrido; o dia que não chegou fica sem acumulado",
  r.dias.map((d) => d.acumulado), [0, 149.99, 269.99, 554.99, 564.99, null]);
confere("total: 9 vendas em 11 lançamentos, R$ 564,99, ticket = valor ÷ vendas",
  [r.total.vendas, r.total.lancamentos, r.total.mesas, r.total.valor, r.total.ticketMedio], [9, 11, 4, 564.99, 62.78]);
confere("total também fecha: 557 + 16 − 10 + 1,99", [r.total.itens, r.total.entrega, r.total.descontos, r.total.outros], [557, 16, 10, 1.99]);
confere("total do desconto na mesa, à parte, e dos cancelados", [r.total.descontoNaMesa, r.total.canceladosQtd, r.total.canceladosValor], [20, 2, 90]);
confere("média só dos 4 dias fechados (hoje ainda está vendendo), com o zero da quarta",
  [r.media.base, r.media.dias, r.media.valor, r.media.vendas], ["fechados", 4, 138.75, 2]);
const fecha = (l: { itens: number | null; entrega: number; descontos: number; outros: number | null; valor: number }) =>
  Math.round(((l.itens ?? 0) + l.entrega - l.descontos + (l.outros ?? 0)) * 100) === Math.round(l.valor * 100);
confere("a linha da MÉDIA fecha como as outras", fecha(r.media), true);
confere("média dos dias com venda (sem a quarta)", r.mediaDiasComVenda, 185);
confere("melhor dia: sábado 19", r.melhorDia, { dia: "2026-09-19", diaSemana: 6, valor: 285, vendas: 3 });
confere("pior dia: sexta 18 — não a quarta zerada (loja fechada) nem hoje", r.piorDia?.dia, "2026-09-18");

// A média que NÃO fechava: três dias fechados, dois com R$ 10,01 (itens 10,00 +
// 0,01 de taxa do app). Médias arredondadas uma a uma: valor 6,67, itens 6,67,
// outros 0,01 → 6,68 ≠ 6,67. O Outros sai da conta da linha: 0,00.
const miudo = faturamentoPorDia({
  de: "2026-09-16", ate: "2026-09-18", tz: TZ, hoje: HOJE,
  pedidos: [
    p({ createdAt: "2026-09-16T23:00:00Z", status: "ENTREGUE", totalAmount: 10.01, items: [item(1, 10)] }),
    p({ createdAt: "2026-09-17T23:00:00Z", status: "ENTREGUE", totalAmount: 10.01, items: [item(1, 10)] }),
  ],
});
confere("média com arredondamento: valor 6,67, itens 6,67, outros 0,00 — fecha (antes: outros 0,01, sobrava 1 centavo)",
  [miudo.media.valor, miudo.media.itens, miudo.media.outros, fecha(miudo.media)], [6.67, 6.67, 0, true]);
confere("e cada dia e o total continuam fechando", [fecha(miudo.total), miudo.dias.every(fecha)], [true, true]);

const desdeA17 = faturamentoPorDia({ de: "2026-09-16", ate: "2026-09-21", tz: TZ, hoje: HOJE, primeiroDia: "2026-09-17", pedidos: PEDIDOS, mesas: MESAS });
confere("loja que entrou no dia 17: a quarta 16 fica na tabela, mas fora da média",
  [desdeA17.dias[0].estado, desdeA17.media.dias, desdeA17.media.valor, desdeA17.total.valor], ["antes", 3, 185, 564.99]);
const antesDaLoja = faturamentoPorDia({ de: "2026-09-10", ate: "2026-09-15", tz: TZ, hoje: HOJE, primeiroDia: "2026-09-17", pedidos: [] });
confere("período inteiro antes da loja: média zero, sem base", [antesDaLoja.media.base, antesDaLoja.media.valor], ["nenhum", 0]);

const soHoje = faturamentoPorDia({ de: HOJE, ate: HOJE, tz: TZ, hoje: HOJE, pedidos: PEDIDOS, mesas: MESAS });
confere("período = hoje: a média é o próprio hoje, sem pior dia", [soHoje.media.base, soHoje.media.valor, soHoje.piorDia], ["hoje", 10, null]);

console.log("\n4) Melhor e pior dia nunca são o mesmo");
const doValor = (dia: string, valor: number) => p({ createdAt: `${dia}T23:00:00Z`, status: "ENTREGUE", totalAmount: valor, items: [item(1, valor)] });
const empate = faturamentoPorDia({ de: "2026-09-17", ate: "2026-09-18", tz: TZ, hoje: HOJE, pedidos: [doValor("2026-09-17", 100), doValor("2026-09-18", 100)] });
confere("dois dias empatados: melhor = o primeiro, e NÃO há pior (antes: o mesmo dia nos dois cartões)",
  [empate.melhorDia?.dia, empate.piorDia], ["2026-09-17", null]);
const empateNoTopo = faturamentoPorDia({ de: "2026-09-16", ate: "2026-09-18", tz: TZ, hoje: HOJE,
  pedidos: [doValor("2026-09-16", 100), doValor("2026-09-17", 100), doValor("2026-09-18", 80)] });
confere("empate no topo e um dia abaixo: o pior é o de baixo", [empateNoTopo.melhorDia?.dia, empateNoTopo.piorDia?.dia], ["2026-09-16", "2026-09-18"]);
const umDiaSo = faturamentoPorDia({ de: "2026-09-16", ate: "2026-09-18", tz: TZ, hoje: HOJE, pedidos: [doValor("2026-09-17", 100)] });
confere("com um dia só de venda, não existe pior dia", [umDiaSo.melhorDia?.dia, umDiaSo.piorDia], ["2026-09-17", null]);

console.log("\n5) Acréscimo e valor impossível");
const pai = p({ id: "pai", createdAt: "2026-09-17T23:00:00Z", status: "ENTREGUE", totalAmount: 50, items: [item(1, 50)] });
const acr = p({ id: "acr", parentOrderId: "pai", createdAt: "2026-09-18T09:00:00Z", status: "ENTREGUE", totalAmount: 8, items: [item(1, 8)] });
const comPai = faturamentoPorDia({ de: "2026-09-17", ate: "2026-09-18", tz: TZ, hoje: HOJE, pedidos: [pai, acr] });
confere("acréscimo com o pai no período: valor no dia dele, sem venda nova", [comPai.dias[1].valor, comPai.dias[1].vendas, comPai.dias[1].lancamentos, comPai.total.vendas], [8, 0, 1, 1]);
confere("…e o dia 18 continua sendo dia COM venda (teve lançamento)", comPai.diasComVenda, 2);
const semPai = faturamentoPorDia({ de: "2026-09-18", ate: "2026-09-18", tz: TZ, hoje: HOJE, pedidos: [acr] });
confere("acréscimo com o pai fora do período: é a venda do dia", semPai.total.vendas, 1);

const comAbsurdo = faturamentoPorDia({
  de: "2026-09-18", ate: "2026-09-18", tz: TZ, hoje: HOJE, mesas: [],
  pedidos: [
    ...PEDIDOS,
    // O pedido real da Pastel da Paulista (13/09/2026): cancelado, R$ 1e17.
    p({ createdAt: "2026-09-18T23:00:00Z", status: "CANCELADO", totalAmount: 1e17, items: [item(1, 1e17)] }),
    // Total normal com item absurdo: também fica fora (a linha não fecharia).
    p({ createdAt: "2026-09-18T23:10:00Z", status: "ENTREGUE", totalAmount: 50, items: [item(1, 2e6)] }),
  ],
});
confere("o teto é de um milhão", VALOR_IMPOSSIVEL, 1_000_000);
confere("valor impossível fica fora das somas e é contado",
  [comAbsurdo.total.valor, comAbsurdo.total.canceladosValor, comAbsurdo.valoresImpossiveis], [120, 70, 2]);

console.log("\n6) Dias da semana");
confere("lerDiasDaSemana: limpa, ordena, tira repetido", lerDiasDaSemana("5,0,5,x,9"), [0, 5]);
confere("os sete marcados = todos", lerDiasDaSemana("0,1,2,3,4,5,6"), []);
const sextas = faturamentoPorDia({ de: "2026-09-16", ate: "2026-09-21", tz: TZ, hoje: HOJE, diasDaSemana: [5], pedidos: PEDIDOS, mesas: MESAS });
confere("só as sextas: uma linha, total e média dela", [sextas.dias.map((d) => d.dia), sextas.total.valor, sextas.media.valor], [["2026-09-18"], 120, 120]);
confere("com um dia só não existe pior dia", sextas.piorDia, null);
confere("a mesa fechada no sábado não entra nas sextas (nem serviço, nem desconto)", [sextas.servicoDasMesas, sextas.mesasFechadas.descontoNaMesa], [0, 0]);
const fimDeSemana = faturamentoPorDia({ de: "2026-09-16", ate: "2026-09-21", tz: TZ, hoje: HOJE, diasDaSemana: [6, 0], pedidos: PEDIDOS, mesas: MESAS });
confere("sábado + domingo: acumulado só dos dias mostrados", fimDeSemana.dias.map((d) => d.acumulado), [285, 295]);
// A mesa s3 abriu na sexta (04h50) e lançou de novo no sábado. Sem a sexta no
// recorte, a rodada de sábado é o primeiro lançamento DENTRO dele: é venda lá.
confere("sem a sexta, a 2ª rodada da s3 é a venda do sábado (1º lançamento dentro do recorte)", fimDeSemana.dias[0].vendas, 4);

console.log("\n6b) O aviso de mesa ainda aberta usa o mesmo recorte do valor");
// Revisão de 24/09/2026: a rota somava a janela inteira. Com "só as sextas" e
// uma mesa aberta que lançou na quarta, o aviso dizia "R$ X lançados — já
// estão no valor das vendas", e a tabela (só sextas) não tinha esse valor.
const abertaQuartaESexta = [
  p({ id: "aq", createdAt: "2026-09-16T23:00:00Z", status: "ENTREGUE", totalAmount: 40, tableSessionId: "ab2", items: [item(1, 40)] }),
  p({ id: "as", createdAt: "2026-09-18T23:00:00Z", status: "ENTREGUE", totalAmount: 15, tableSessionId: "ab2", items: [item(1, 15)] }),
  p({ id: "ac", createdAt: "2026-09-18T23:10:00Z", status: "CANCELADO", totalAmount: 99, tableSessionId: "ab2", items: [item(1, 99)] }),
];
const semanaToda = { de: "2026-09-16", ate: "2026-09-21", tz: TZ, pedidos: [...PEDIDOS, ...abertaQuartaESexta], abertas: ["aberta", "ab2"] };
confere("sem filtro: as duas mesas abertas, com tudo o que lançaram (30 + 40 + 15; o cancelado não)",
  consumoDasMesasAbertas(semanaToda), { quantidade: 2, consumo: 85 });
confere("só as sextas: só a rodada de sexta da ab2 (a aberta do sábado e a quarta ficam de fora)",
  consumoDasMesasAbertas({ ...semanaToda, diasDaSemana: [5] }), { quantidade: 1, consumo: 15 });
const soSextas = faturamentoPorDia({ ...semanaToda, hoje: HOJE, diasDaSemana: [5], mesas: MESAS });
confere("…e esses R$ 15 estão mesmo no valor da sexta (120 + 15)", soSextas.total.valor, 135);
confere("só as quartas: o aviso é só da rodada de quarta da ab2", consumoDasMesasAbertas({ ...semanaToda, diasDaSemana: [3] }), { quantidade: 1, consumo: 40 });
confere("nenhuma mesa aberta no recorte: sem aviso", consumoDasMesasAbertas({ ...semanaToda, diasDaSemana: [1] }), null);

console.log("\n7) Com filtro de dia da semana, compara o MESMO número de cada dia");
// Quinta 17 a sábado 26/09 tem duas sextas (18 e 25). Os 10 dias logo antes
// (07 a 16/09) só têm uma (11): "só as sextas" comparava 2 com 1.
confere("sem filtro: os n dias logo antes", periodoDeComparacao("2026-09-17", "2026-09-26"), { de: "2026-09-07", ate: "2026-09-16", recuo: 10, semanas: null });
confere("com filtro: recua em semanas inteiras (03 a 12/09, as sextas 04 e 11)",
  periodoDeComparacao("2026-09-17", "2026-09-26", [5]), { de: "2026-09-03", ate: "2026-09-12", recuo: 14, semanas: 2 });
const sextasEm = (de: string, ate: string) => faturamentoPorDia({ de, ate, tz: TZ, hoje: "2026-12-31", diasDaSemana: [5], pedidos: [] }).dias.length;
const cmp10 = periodoDeComparacao("2026-09-17", "2026-09-26", [5]);
confere("o anterior tem tantas sextas quanto o período", [sextasEm("2026-09-17", "2026-09-26"), sextasEm(cmp10.de, cmp10.ate)], [2, 2]);
confere("7 dias com filtro: recua uma semana", periodoDeComparacao("2026-09-14", "2026-09-20", [6, 0]), { de: "2026-09-07", ate: "2026-09-13", recuo: 7, semanas: 1 });

console.log("\n8) Comparação com o período anterior (10 a 15/09)");
// O período anterior é buscado sem os itens: o total dos itens vira "não sei".
const anterior = faturamentoPorDia({
  de: "2026-09-10", ate: "2026-09-15", tz: TZ, hoje: HOJE, mesas: [],
  pedidos: [
    p({ createdAt: "2026-09-12T23:00:00Z", status: "ENTREGUE", totalAmount: 300 }),
    p({ createdAt: "2026-09-13T23:00:00Z", status: "ENTREGUE", totalAmount: 100 }),
  ],
});
confere("sem itens buscados: itens e outros ficam null, o resto soma", [anterior.total.valor, anterior.total.itens, anterior.total.outros], [400, null, null]);
const cmp = compararPeriodos(r, anterior, { de: "2026-09-10", ate: "2026-09-15" });
confere("total +41,25%", cmp.total, { atual: 564.99, anterior: 400, variacao: 0.4125 });
confere("vendas: 9 contra 2", [cmp.vendas.atual, cmp.vendas.anterior], [9, 2]);
confere("média diária: 138,75 contra 66,67", [cmp.media.atual, cmp.media.anterior], [138.75, 66.67]);
confere("melhor dia: 285 contra 300 = −5%", cmp.melhorDia.variacao, -0.05);
const vazio = faturamentoPorDia({ de: "2026-09-10", ate: "2026-09-15", tz: TZ, hoje: HOJE, pedidos: [] });
confere("período anterior sem venda: sem variação (não é +∞%)", compararPeriodos(r, vazio, { de: "x", ate: "y" }).total.variacao, null);

console.log("\n9) Meta do mês");
confere("meta em número", lerMetaDeFaturamento({ faturamento: 30000, cmvPct: 30 }), 30000);
confere("meta em texto brasileiro", lerMetaDeFaturamento({ faturamento: "25.000,00" }), 25000);
confere("\"25.000\" sem vírgula é milhar — vinte e cinco mil, não 25 (antes: 25)", lerMetaDeFaturamento({ faturamento: "25.000" }), 25000);
confere("\"1.250.000\" e \"R$ 25.000\" também", [lerMetaDeFaturamento({ faturamento: "1.250.000" }), lerMetaDeFaturamento({ faturamento: "R$ 25.000" })], [1250000, 25000]);
confere("ponto decimal só quando não pode ser milhar", [lerMetaDeFaturamento({ faturamento: "25000.5" }), lerMetaDeFaturamento({ faturamento: "25000" })], [25000.5, 25000]);
confere("sem meta, meta zero ou lixo = null",
  [lerMetaDeFaturamento(null), lerMetaDeFaturamento({}), lerMetaDeFaturamento({ faturamento: 0 }), lerMetaDeFaturamento({ faturamento: "abc" }), lerMetaDeFaturamento([1])],
  [null, null, null, null, null]);

const setembro = Array.from({ length: 19 }, (_, i) => ({ dia: `2026-09-${String(i + 1).padStart(2, "0")}`, valor: 100 }));
setembro.push({ dia: "2026-09-20", valor: 50 }); // hoje, pela metade
const pm = progressoDaMeta({ meta: 3000, ate: HOJE, hoje: HOJE, dias: setembro })!;
confere("mês corrente: acumulado com hoje, ritmo só dos 19 dias fechados",
  [pm.acumulado, pm.pct, pm.esperadoAteAgora, pm.projecao, pm.situacao], [1950, 0.65, 1900, 3000, "no-ritmo"]);
confere("faltam 1.050 em 11 dias (hoje incluído) = R$ 95,45 por dia", [pm.faltam, pm.diasRestantes, pm.porDiaParaBater], [1050, 11, 95.45]);
confere("período que passa de hoje: o futuro não entra", progressoDaMeta({ meta: 3000, ate: "2026-09-30", hoje: HOJE, dias: setembro })?.acumulado, 1950);
confere("meta acima do ritmo", progressoDaMeta({ meta: 4000, ate: HOJE, hoje: HOJE, dias: setembro })?.situacao, "abaixo-do-ritmo");
confere("dia 1 do mês: ainda não há ritmo", progressoDaMeta({ meta: 3000, ate: "2026-09-01", hoje: "2026-09-01", dias: [{ dia: "2026-09-01", valor: 50 }] })?.situacao, "inicio-do-mes");

const agosto = Array.from({ length: 31 }, (_, i) => ({ dia: `2026-08-${String(i + 1).padStart(2, "0")}`, valor: 100 }));
const ago = progressoDaMeta({ meta: 3000, ate: "2026-08-31", hoje: HOJE, dias: agosto })!;
confere("mês inteiro que acabou: bateu", [ago.acumulado, ago.situacao, ago.mesEncerrado, ago.diasRestantes, ago.porDiaParaBater], [3100, "batida", true, 0, null]);
confere("mês que acabou abaixo da meta", progressoDaMeta({ meta: 5000, ate: "2026-08-31", hoje: HOJE, dias: agosto })?.situacao, "nao-batida");
confere("período que termina no meio de um mês passado não mede a meta", [limiteDaMeta("2026-08-10", HOJE), progressoDaMeta({ meta: 3000, ate: "2026-08-10", hoje: HOJE, dias: agosto })], [null, null]);
confere("mês que ainda não começou não mede a meta", limiteDaMeta("2026-10-05", HOJE), null);

console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
