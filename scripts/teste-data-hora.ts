/**
 * Trava o relatório "Vendas por dia e hora" (lib/relatorios/data-hora.ts).
 *
 *   npx tsx scripts/teste-data-hora.ts
 *
 * Os horários são de São Paulo (−03:00), como os da NIK. Agosto de 2026:
 * sábado 01, sexta 07, sábado 08 — o período de 01 a 22/08 tem 3 sextas e 4
 * sábados, o caso que a soma entregaria errado.
 *
 * Pagamento dividido não tem caso: a conta não lê forma de pagamento — o
 * pedido pago em Pix + cartão é uma venda, com o `totalAmount` dele.
 *
 * A métrica de chave "pedidos" é VENDAS (atendimentos), pela régua única de
 * lib/relatorios/regua-da-venda.ts — a mesa conta uma vez; o valor é o
 * lançado, sem fator de desconto da mesa (seção 4).
 */
import {
  FAIXA_TEXTO_CLARO, ORDEM_DAS_HORAS, RAMPA_DO_MAPA, ROTULO_DA_METRICA, arredondarMedia, avisoAntesDasVendas, avisoDoDiaEmAndamento,
  corDoAnelDoPico, corDoTexto, faixaDe, frasesDasRespostas, numeroCurto, numeroDaMetrica, rotuloDaHora,
  tetoDaFaixa, textoDaMetrica, vendasPorDiaEHora,
  type PedidoParaDataHora,
} from "../src/lib/relatorios/data-hora";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

const TZ = "America/Sao_Paulo";
let seq = 0;
/** Um pedido no relógio de São Paulo. */
const pedido = (dia: string, hora: number, minuto = 10, x: Partial<PedidoParaDataHora> = {}): PedidoParaDataHora => ({
  id: `p${++seq}`,
  createdAt: new Date(`${dia}T${String(hora).padStart(2, "0")}:${String(minuto).padStart(2, "0")}:00-03:00`),
  status: "ENTREGUE",
  totalAmount: 50,
  itens: 2,
  ...x,
});
const varios = (n: number, dia: string, hora: number, x: Partial<PedidoParaDataHora> = {}) =>
  Array.from({ length: n }, (_, i) => pedido(dia, hora, i % 60, x));

const SEX = 5, SAB = 6, QUI = 4;

console.log("\n1) Média por dia da semana, não soma: 3 sextas × 4 sábados");
const sextas = ["2026-08-07", "2026-08-14", "2026-08-21"];
const sabados = ["2026-08-01", "2026-08-08", "2026-08-15", "2026-08-22"];
const A = vendasPorDiaEHora([
  ...sextas.flatMap((d) => varios(10, d, 20)),
  ...sabados.flatMap((d) => varios(9, d, 20)),
], { tz: TZ, de: "2026-08-01", ate: "2026-08-22" });
const pA = A.metricas.pedidos;
confere("o período tem 3 sextas e 4 sábados", [A.diasPorSemana[SEX], A.diasPorSemana[SAB], A.dias], [3, 4, 22]);
confere("somando, o sábado vende mais (36 × 30)", [pA.porDia.total[SAB], pA.porDia.total[SEX]], [36, 30]);
confere("pela média, a sexta vende mais (10 × 9)", [pA.porDia.media[SEX], pA.porDia.media[SAB]], [10, 9]);
confere("melhor dia = sexta", pA.respostas.melhorDia?.dia, SEX);
confere("a casa sexta 20h: média 10, total 30", [pA.mapa.media[SEX][20], pA.mapa.total[SEX][20]], [10, 30]);
confere("dia da semana que não vendeu tem média 0, não some", pA.porDia.media[2], 0);
confere("valor: R$ 500 por sexta, R$ 3.300 no total", [A.metricas.valor.porDia.media[SEX], A.metricas.valor.total], [500, 3300]);
confere("itens: 2 por pedido", A.metricas.itens.total, 132);
confere("um dia médio = total ÷ dias (66 ÷ 22 = 3)", pA.mediaPorDia, 3);
confere("barras por hora: seg–qui zerado; sex–dom = 66 ÷ (3 sex + 4 sáb + 3 dom) = 6,6",
  [pA.porHora.semana[20], pA.porHora.fimDeSemana[20]], [0, 6.6]);
confere("frases prontas", frasesDasRespostas(pA, "pedidos").map((f) => `${f.pergunta}: ${f.resposta}`),
  ["Melhor horário: 20h–21h", "Melhor dia: Sexta", "Pico da semana: Sexta, 20h–21h"]);

console.log("\n2) Madrugada: o pedido da 1h30 de sábado é da sexta");
const B = vendasPorDiaEHora([
  pedido("2026-08-08", 1, 30),
  pedido("2026-08-08", 4, 59),
  pedido("2026-08-08", 5, 0),
], { tz: TZ, de: "2026-08-07", ate: "2026-08-08" });
confere("sábado 01h30 e 04h59 → linha da SEXTA, colunas 1h e 4h", [B.metricas.pedidos.mapa.total[SEX][1], B.metricas.pedidos.mapa.total[SEX][4]], [1, 1]);
confere("sábado 05h00 → já é sábado", B.metricas.pedidos.mapa.total[SAB][5], 1);
confere("as colunas começam às 5h e a madrugada fica no fim", [ORDEM_DAS_HORAS[0], ORDEM_DAS_HORAS[18], ORDEM_DAS_HORAS[19], ORDEM_DAS_HORAS[23]], [5, 23, 0, 4]);
confere("rótulo da hora que vira o dia", rotuloDaHora(23), "23h–0h");
const foraDaJanela = vendasPorDiaEHora([pedido("2026-08-07", 3, 0)], { tz: TZ, de: "2026-08-07", ate: "2026-08-08" });
confere("sexta 03h00 é da QUINTA — fora do período de sexta a sábado", foraDaJanela.metricas.pedidos.total, 0);

console.log("\n3) Cancelado e intenção não entram");
const C = vendasPorDiaEHora([
  pedido("2026-08-07", 20),
  pedido("2026-08-07", 20, 15, { status: "CANCELADO" }),
  pedido("2026-08-07", 20, 20, { status: "cancelado" }),
  pedido("2026-08-07", 20, 25, { status: "AGUARDANDO_PAGAMENTO" }),
  pedido("2026-08-07", 20, 30, { status: "CRIANDO_IA" }),
], { tz: TZ, de: "2026-08-07", ate: "2026-08-07" });
confere("só o entregue conta: 1 venda, R$ 50", [C.metricas.pedidos.total, C.metricas.valor.total], [1, 50]);
const comAbsurdo = vendasPorDiaEHora([
  pedido("2026-08-07", 20),
  pedido("2026-08-07", 20, 30, { totalAmount: 50, items: [{ quantity: 1, price: 2e6 }] }),
], { tz: TZ, de: "2026-08-07", ate: "2026-08-07" });
confere("valor impossível (item de R$ 2 milhões) fica fora, como nos outros relatórios", [comAbsurdo.metricas.pedidos.total, comAbsurdo.metricas.valor.total], [1, 50]);

console.log("\n4) Mesa: uma venda por mesa, no primeiro lançamento; o valor é o lançado");
confere("a métrica se chama Vendas — o mesmo número do cartão Vendas dos outros relatórios", ROTULO_DA_METRICA.pedidos, "Vendas");
const D = vendasPorDiaEHora([
  pedido("2026-08-07", 21, 30, { tableSessionId: "m1", totalAmount: 60, itens: 3 }),
  pedido("2026-08-07", 20, 10, { tableSessionId: "m1", totalAmount: 60, itens: 4 }),
  pedido("2026-08-07", 22, 0, { tableSessionId: "m1", totalAmount: 25, itens: 1, status: "CANCELADO" }),
  pedido("2026-08-07", 21, 0, { deliveryType: "MESA" } as any),
], { tz: TZ, de: "2026-08-07", ate: "2026-08-07" });
const dP = D.metricas.pedidos.mapa.total[SEX], dV = D.metricas.valor.mapa.total[SEX], dI = D.metricas.itens.mapa.total[SEX];
confere("a mesa m1 é 1 venda às 20h (o 1º lançamento), não 2; o lançamento antigo sem sessão é outra, às 21h", [dP[20], dP[21], D.metricas.pedidos.total], [1, 1, 2]);
// Até 24/09/2026 o valor da mesa saía multiplicado por (pago − serviço −
// gorjeta) ÷ lançado e todo na hora do 1º lançamento: R$ 110 às 20h. Pastel
// da Paulista, 09–16/09: R$ 34.535,14 aqui contra R$ 34.660,54 no Vendas por período.
confere("valor da mesa = o LANÇADO, cada rodada na hora dela: 60 às 20h, 60 + 50 às 21h (sem fator de desconto)",
  [dV[20], dV[21], D.metricas.valor.total], [60, 110, 170]);
confere("itens também na hora de cada rodada; o cancelado fora", [dI[20], dI[21]], [4, 5]);
confere("contagem de mesas: 1 sessão, 2 lançamentos válidos; 3 lançamentos ao todo", [D.mesas, D.lancamentos], [{ sessoes: 1, lancamentos: 2 }, 3]);
const antesDoPeriodo = vendasPorDiaEHora([
  pedido("2026-08-06", 22, 0, { tableSessionId: "m9", totalAmount: 40 }),
  pedido("2026-08-07", 20, 0, { tableSessionId: "m9", totalAmount: 30 }),
], { tz: TZ, de: "2026-08-07", ate: "2026-08-07" });
confere("mesa que começou antes do período: a 1ª rodada de DENTRO é a venda (e só ela conta no valor)",
  [antesDoPeriodo.metricas.pedidos.total, antesDoPeriodo.metricas.valor.total, antesDoPeriodo.metricas.pedidos.mapa.total[SEX][20]], [1, 30, 1]);

console.log("\n5) Acréscimo: soma valor e itens, não é venda nova");
const E = vendasPorDiaEHora([
  pedido("2026-08-07", 20, 0, { id: "pai" }),
  pedido("2026-08-07", 20, 40, { parentOrderId: "pai", totalAmount: 12, itens: 1 }),
], { tz: TZ, de: "2026-08-07", ate: "2026-08-07" });
confere("1 venda, R$ 62, 3 itens", [E.metricas.pedidos.total, E.metricas.valor.total, E.metricas.itens.total], [1, 62, 3]);
const soAcrescimo = vendasPorDiaEHora([pedido("2026-08-07", 20, 40, { parentOrderId: "pai-de-ontem", totalAmount: 12, itens: 1 })], { tz: TZ, de: "2026-08-07", ate: "2026-08-07" });
confere("acréscimo com o pai fora do período: é a venda (antes: valor sem venda nenhuma)", soAcrescimo.metricas.pedidos.total, 1);

console.log("\n6) Hoje em andamento: a hora que ainda não chegou não entra no divisor");
const F = vendasPorDiaEHora([
  ...varios(10, "2026-09-17", 20), ...varios(2, "2026-09-17", 12),
  ...varios(2, "2026-09-24", 12),
], { tz: TZ, de: "2026-09-17", ate: "2026-09-24", agora: { dia: "2026-09-24", hora: 15 } });
const pF = F.metricas.pedidos;
confere("2 quintas no período, 8 dias, hoje em andamento", [F.diasPorSemana[QUI], F.dias, F.hojeEmAndamento], [2, 8, true]);
confere("quinta 12h: 4 pedidos em 2 quintas = 2", pF.mapa.media[QUI][12], 2);
confere("quinta 20h: a de hoje ainda não chegou lá — 10 em 1 quinta = 10", pF.mapa.media[QUI][20], 10);
confere("média da quinta = 12 (dia típico), não 14 ÷ 2 = 7", pF.porDia.media[QUI], 12);
confere("o total continua o total: 14", pF.porDia.total[QUI], 14);
confere("com outra quinta no período, nenhum dia fica sem média", F.diaEmAndamento, null);
const futuro = vendasPorDiaEHora([], { tz: TZ, de: "2026-09-24", ate: "2026-09-30", agora: { dia: "2026-09-24", hora: 15 } });
confere("dias do futuro não contam", [futuro.dias, futuro.diasPorSemana[5]], [1, 0]);
confere("sem venda: nenhuma resposta inventada", frasesDasRespostas(futuro.metricas.pedidos, "pedidos"), []);

console.log("\n6a) Hoje é a ÚNICA quinta do período: a quinta fica sem média, não zerada");
// O "7 dias" (18 a 24/09/2026) consultado na quinta 24/09 ao meio-dia: na NIK
// saía quinta = 0 contra 60 a 109 nos outros dias — o pior dia, sem motivo.
const seisDias = ["2026-09-18", "2026-09-19", "2026-09-20", "2026-09-21", "2026-09-22", "2026-09-23"];
const I = vendasPorDiaEHora([
  ...seisDias.flatMap((d) => varios(10, d, 20)),
  ...varios(3, "2026-09-24", 11),
], { tz: TZ, de: "2026-09-18", ate: "2026-09-24", agora: { dia: "2026-09-24", hora: 12 } });
const pI = I.metricas.pedidos;
confere("a quinta de hoje é o dia em andamento (1 quinta no período)", [I.diaEmAndamento, I.diasPorSemana[QUI]], [QUI, 1]);
confere("média por dia: quinta null (não 0), os outros 10", pI.porDia.media, [10, 10, 10, 10, null, 10, 10]);
confere("o total da quinta é o que já vendeu: 3", pI.porDia.total[QUI], 3);
confere("quinta 11h já tem média (3); quinta 20h ainda não (null)", [pI.mapa.media[QUI][11], pI.mapa.media[QUI][20]], [3, null]);
confere("melhor dia entre os completos (empate → segunda); a quinta nem entra", pI.respostas.melhorDia?.dia, 1);
confere("o dia médio existe (as 20h já aconteceram em 6 dias): 10 + 3/7", pI.mediaPorDia, 10.43);
confere("o aviso fala do dia, no gênero certo",
  [avisoDoDiaEmAndamento(QUI), avisoDoDiaEmAndamento(SAB).split(":")[0]],
  ["Hoje é a única quinta do período e ainda está em andamento: a quinta fica sem média do dia até ele fechar (as horas que ainda não chegaram não contam como zero).",
    "Hoje é o único sábado do período e ainda está em andamento"]);
const soHoje = vendasPorDiaEHora(varios(4, "2026-09-24", 11), { tz: TZ, de: "2026-09-24", ate: "2026-09-24", agora: { dia: "2026-09-24", hora: 12 } });
const pSH = soHoje.metricas.pedidos;
confere("período só de hoje: sem dia médio e sem melhor dia (null); o total é o total",
  [pSH.mediaPorDia, pSH.respostas.melhorDia, pSH.porDia.media[QUI], pSH.total], [null, null, null, 4]);
confere("…e o melhor horário não inventa \"% do dia\"", frasesDasRespostas(pSH, "pedidos")[0]?.detalhe, "4 vendas por dia nessa hora");

console.log("\n6b) Loja que começou no meio do período: os dias antes não diluem a média");
// Como a NIK: primeiro pedido num sábado (05/09); o período começa 10 dias antes.
const H = vendasPorDiaEHora([
  ...["2026-09-05", "2026-09-12", "2026-09-19"].flatMap((d) => varios(6, d, 20)),
  ...["2026-09-09", "2026-09-16", "2026-09-23"].flatMap((d) => varios(8, d, 20)),
], { tz: TZ, de: "2026-08-26", ate: "2026-09-24", inicioDasVendas: "2026-09-05" });
confere("sem a loja no ar, quarta e sábado caem no divisor em 3 vezes cada, não 5 e 4",
  [H.diasPorSemana[3], H.diasPorSemana[SAB], H.dias, H.inicioDasVendas], [3, 3, 20, "2026-09-05"]);
confere("quarta 8 e sábado 6 por dia — sem a diluição (seria 4,8 e 4,5)", [H.metricas.pedidos.porDia.media[3], H.metricas.pedidos.porDia.media[SAB]], [8, 6]);
const antiga = vendasPorDiaEHora([], { tz: TZ, de: "2026-09-10", ate: "2026-09-12", inicioDasVendas: "2025-01-01" });
confere("loja que já vendia antes do período: todos os dias contam", [antiga.dias, antiga.inicioDasVendas, antiga.vendasComecaramDepois], [3, null, null]);
confere("loja que começou DENTRO do período não é \"depois\"", H.vendasComecaramDepois, null);
// A NIK (primeiro pedido em 05/09/2026) consultada em janeiro/2025: a planilha
// dizia "01/01/2025 a 31/01/2025 (0 dias)" sem dizer por quê.
const antesDasVendas = vendasPorDiaEHora([], { tz: TZ, de: "2025-01-01", ate: "2025-01-31", inicioDasVendas: "2026-09-05" });
confere("período inteiro antes do primeiro pedido: 0 dias, e o motivo sai (vendasComecaramDepois)",
  [antesDasVendas.dias, antesDasVendas.inicioDasVendas, antesDasVendas.vendasComecaramDepois], [0, null, "2026-09-05"]);
confere("o aviso", avisoAntesDasVendas("2026-09-05"),
  "A loja só começou a vender pelo FireHub em 05/09/2026, depois deste período: não há venda nem média para mostrar.");

console.log("\n7) Horário mais parado dentro do expediente");
// Uma semana de 07 a 13/09/2026: almoço 11h–13h e jantar 18h–22h todo dia;
// às 16h só um pedido na semana inteira (a loja está fechada).
const semana = ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13"];
const POR_HORA: Record<number, number> = { 11: 2, 12: 3, 13: 2, 18: 2, 19: 4, 20: 5, 21: 3, 22: 1 };
const G = vendasPorDiaEHora([
  ...semana.flatMap((d) => Object.entries(POR_HORA).flatMap(([h, n]) => varios(n, d, Number(h)))),
  pedido("2026-09-09", 16),
], { tz: TZ, de: "2026-09-07", ate: "2026-09-13" });
const rG = G.metricas.pedidos.respostas;
confere("o expediente são as horas de todo dia; as 16h (1 em 7 dias) ficam fora", G.expediente, [11, 12, 13, 18, 19, 20, 21, 22]);
confere("mais parado = 22h (1 por dia), não as 16h (0,14 por dia, loja fechada)", [rG.horaMaisParada?.hora, rG.horaMaisParada?.media], [22, 1]);
confere("melhor horário = 20h, 5 de 22 pedidos do dia", [rG.melhorHora?.hora, rG.melhorHora?.media, G.metricas.pedidos.mediaPorDia], [20, 5, 22.14]);
confere("empate entre dias: o pico fica na segunda (a primeira linha)", [rG.pico?.dia, rG.pico?.hora], [1, 20]);

console.log("\n8) Fuso da loja, não do servidor");
const instante = new Date("2026-08-07T23:30:00Z"); // 20h30 em SP, 19h30 em Manaus
const emSP = vendasPorDiaEHora([{ id: "x", createdAt: instante, status: "ENTREGUE", totalAmount: 10, itens: 1 }], { tz: "America/Sao_Paulo", de: "2026-08-07", ate: "2026-08-07" });
const emManaus = vendasPorDiaEHora([{ id: "x", createdAt: instante, status: "ENTREGUE", totalAmount: 10, itens: 1 }], { tz: "America/Manaus", de: "2026-08-07", ate: "2026-08-07" });
confere("São Paulo: 20h; Manaus: 19h", [emSP.metricas.pedidos.mapa.total[SEX][20], emManaus.metricas.pedidos.mapa.total[SEX][19]], [1, 1]);

console.log("\n9) Números curtos das casas do mapa");
confere("valor", [numeroCurto("valor", 847.4), numeroCurto("valor", 1234), numeroCurto("valor", 0)], ["847", "1,2 mil", ""]);
confere("pedidos", [numeroCurto("pedidos", 3.25), numeroCurto("pedidos", 12.4)], ["3,3", "12"]);
confere("positivo pequeno não vira \"0\" numa casa que vendeu",
  [numeroCurto("pedidos", 0.04), numeroCurto("pedidos", 0.0333), numeroCurto("valor", 0.4), numeroCurto("itens", 0.02)],
  ["<0,1", "<0,1", "<1", "<0,1"]);
confere("nem por extenso, nem na barra",
  [textoDaMetrica("pedidos", 0.03), textoDaMetrica("itens", 0.03), textoDaMetrica("pedidos", 1), numeroDaMetrica("pedidos", 0.03), numeroDaMetrica("pedidos", 13.14), numeroDaMetrica("pedidos", null)],
  ["menos de 0,1 venda", "menos de 0,1 item", "1 venda", "<0,1", "13,1", "—"]);
const umPedido = vendasPorDiaEHora([pedido("2026-08-11", 15)], { tz: TZ, de: "2026-08-01", ate: "2026-08-30" });
confere("30 dias com 1 pedido às 15h: a linha \"Dia médio\" mostra <0,1 (antes \"0\")",
  [umPedido.frequencia[15] > 0, numeroCurto("pedidos", umPedido.metricas.pedidos.porHora.todos[15])], [true, "<0,1"]);
const umPedidoEm395 = vendasPorDiaEHora([pedido("2026-08-11", 15)], { tz: TZ, de: "2025-08-01", ate: "2026-08-30" });
confere("395 dias com 1 pedido às 15h: a média guarda 0,0025 (o c2 zerava e a casa ficava em branco)",
  [umPedidoEm395.dias, umPedidoEm395.metricas.pedidos.porHora.todos[15]], [395, 0.0025]);
confere("arredondar a média: 2 casas no normal", [arredondarMedia(22.142857), arredondarMedia(0), arredondarMedia(0.00253)], [22.14, 0, 0.0025]);
confere("legenda nunca \"até 0\"",
  [tetoDaFaixa("pedidos", 0.0055), tetoDaFaixa("pedidos", 0.35), tetoDaFaixa("pedidos", 3.25), tetoDaFaixa("pedidos", 12.4), tetoDaFaixa("valor", 847.4), tetoDaFaixa("valor", 3.456)],
  ["0,0055", "0,35", "3,3", "12", "R$ 847", "R$ 3,46"]);

console.log("\n10) Cores do mapa: o pico marcado aparece e o número se lê");
/** Contraste WCAG entre duas cores #RRGGBB. */
const contraste = (a: string, b: string) => {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [claro, escuro] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (claro + 0.05) / (escuro + 0.05);
};
confere("o pico (a maior casa) cai sempre na última faixa", [faixaDe(13.1, 13.1), faixaDe(0.01, 13.1), faixaDe(0, 13.1)], [RAMPA_DO_MAPA.length - 1, 0, -1]);
confere("o anel do pico tem ≥ 3:1 com a casa em todas as faixas (antes: carvão na brasaTinta, 2,4:1)",
  RAMPA_DO_MAPA.map((cor, f) => contraste(corDoAnelDoPico(f), cor) >= 3), RAMPA_DO_MAPA.map(() => true));
confere("o número da casa tem ≥ 4,5:1 em todas as faixas", RAMPA_DO_MAPA.map((cor, f) => contraste(corDoTexto(f), cor) >= 4.5), RAMPA_DO_MAPA.map(() => true));
confere("a faixa do texto claro é a 4", FAIXA_TEXTO_CLARO, 4);

console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
