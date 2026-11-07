/**
 * Trava o relatório "Faturamento mensal" (lib/relatorios/faturamento-mensal.ts):
 * cada mês BATE com o Faturamento por dia do mesmo mês (a mesma régua: dia
 * que vira às 5h, mesa uma venda, cancelado fora), o mês corrente "até hoje"
 * com a projeção no ritmo dos dias fechados, a comparação do mês corrente com
 * o ano passado até o MESMO dia e horário, o mês sem dado no FireHub (não é
 * zero), o mês em que a loja começou no meio (sem variação) e o ano escolhido.
 *
 *   npx tsx scripts/teste-faturamento-mensal.ts
 *
 * Hoje = sábado 07/11/2026, 15h na loja (America/Sao_Paulo, −03). A loja fez
 * o 1º pedido em 10/03/2025. Horários em UTC.
 */
import {
  corteDoAnoAnterior, estadoDoMes, faturamentoMensal, lerAno, mesesDoAno, mesesParaBuscar, mesmoDiaNoAnoAnterior, resumoDoMes,
} from "../src/lib/relatorios/faturamento-mensal";
import { faturamentoPorDia, type PedidoParaFaturamento } from "../src/lib/relatorios/faturamento-por-dia";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

const TZ = "America/Sao_Paulo";
const HOJE = "2026-11-07";
const AGORA = Date.parse("2026-11-07T18:00:00Z"); // 15h na loja
const PRIMEIRO_DIA = "2025-03-10";
let seq = 0;
const p = (createdAt: string, totalAmount: number, extra: Partial<PedidoParaFaturamento> = {}): PedidoParaFaturamento =>
  ({ id: `p${++seq}`, createdAt, status: "ENTREGUE", totalAmount, ...extra });

const PEDIDOS: PedidoParaFaturamento[] = [
  // ── 2025 ──
  // Março/2025: a loja começou no dia 10.
  p("2025-03-10T23:00:00Z", 300),
  p("2025-03-20T23:00:00Z", 200),
  // Outubro/2025: dois pedidos, R$ 1.000.
  p("2025-10-05T23:00:00Z", 600),
  p("2025-10-18T23:00:00Z", 400),
  // Novembro/2025: dia 3 (R$ 100), dia 7 às 10h (R$ 40) e às 20h (R$ 60, DEPOIS
  // do horário de hoje), dia 20 (R$ 500). Inteiro: R$ 700. Até 07/11 às 15h: R$ 140.
  p("2025-11-03T23:00:00Z", 100),
  p("2025-11-07T13:00:00Z", 40),
  p("2025-11-07T23:00:00Z", 60),
  p("2025-11-20T23:00:00Z", 500),
  // Dezembro/2025: R$ 2.000 — o alvo do dezembro que ainda não chegou.
  p("2025-12-20T23:00:00Z", 2000),

  // ── 2026 ──
  // Outubro/2026: um pedido comum, uma mesa de duas rodadas (UMA venda), um
  // cancelado (fora) e a madrugada de 01/11 às 01h30 (é o expediente de 31/10).
  p("2026-10-02T23:00:00Z", 100),
  p("2026-10-10T22:00:00Z", 80, { tableSessionId: "m1" }),
  p("2026-10-10T23:30:00Z", 70, { tableSessionId: "m1" }),
  p("2026-10-15T23:00:00Z", 999, { status: "CANCELADO" }),
  p("2026-11-01T04:30:00Z", 50),
  // A mesa que atravessa a virada do mês: 04h50 de 01/11 (expediente de 31/10)
  // e 05h10 (já é 01/11). Uma venda em cada mês, como no Faturamento por dia.
  p("2026-11-01T07:50:00Z", 20, { tableSessionId: "m2" }),
  p("2026-11-01T08:10:00Z", 30, { tableSessionId: "m2" }),
  // Novembro/2026: R$ 100 em cada dia de 02 a 06 e R$ 50 hoje (ainda aberto).
  ...[2, 3, 4, 5, 6].map((d) => p(`2026-11-0${d}T23:00:00Z`, 100)),
  p("2026-11-07T15:00:00Z", 50),
];

// ── Cada mês bate com o Faturamento por dia do mesmo mês ──
const out26 = resumoDoMes({ mes: "2026-10", tz: TZ, hoje: HOJE, primeiroDia: PRIMEIRO_DIA, pedidos: PEDIDOS });
const fpd = faturamentoPorDia({ de: "2026-10-01", ate: "2026-10-31", tz: TZ, hoje: HOJE, primeiroDia: PRIMEIRO_DIA, pedidos: PEDIDOS });
confere("outubro/2026 = Faturamento por dia de 01 a 31/10 (valor, vendas, mesas, ticket)",
  [out26.valor, out26.vendas, out26.mesas, out26.ticketMedio], [fpd.total.valor, fpd.total.vendas, fpd.total.mesas, fpd.total.ticketMedio]);
confere("outubro/2026: 100 + mesa 150 + 50 da madrugada + 20 da mesa da virada = 320; 4 vendas (a mesa conta uma vez, o cancelado fica fora)",
  [out26.valor, out26.vendas, out26.lancamentos, out26.ticketMedio, out26.estado], [320, 4, 5, 80, "fechado"]);
confere("a soma dos dias do Faturamento por dia dá o mês", fpd.dias.reduce((s, d) => s + d.valor, 0), out26.valor);

// ── O mês corrente: até hoje, com projeção ──
const nov26 = resumoDoMes({ mes: "2026-11", tz: TZ, hoje: HOJE, primeiroDia: PRIMEIRO_DIA, pedidos: PEDIDOS });
const fpdNov = faturamentoPorDia({ de: "2026-11-01", ate: "2026-11-30", tz: TZ, hoje: HOJE, primeiroDia: PRIMEIRO_DIA, pedidos: PEDIDOS });
confere("novembro/2026 = Faturamento por dia de 01 a 30/11", [nov26.valor, nov26.vendas], [fpdNov.total.valor, fpdNov.total.vendas]);
confere("novembro/2026 até hoje: 30 (mesa da virada) + 5 × 100 + 50 de hoje = 580, 7 vendas",
  [nov26.estado, nov26.valor, nov26.vendas, nov26.ateODia], ["corrente", 580, 7, HOJE]);
// Dias fechados 01 a 06: 30 + 500 = 530 em 6 dias; faltam 24 (hoje incluído)
// no ritmo de 88,333…: 530 + 2.120 = 2.650.
confere("projeção no ritmo dos 6 dias fechados (hoje fica fora do ritmo)", nov26.projecao, 2650);
confere("média por dia: só dos dias fechados", nov26.mediaPorDia, 88.33);

// ── O ano passado até o mesmo dia e horário ──
const corte = corteDoAnoAnterior(HOJE, AGORA);
confere("o corte é 07/11/2025, às 15h na loja", [corte.dia, corte.instante.toISOString()], ["2025-11-07", "2025-11-07T18:00:00.000Z"]);
const nov25 = resumoDoMes({ mes: "2025-11", tz: TZ, hoje: HOJE, primeiroDia: PRIMEIRO_DIA, pedidos: PEDIDOS });
const nov25ate = resumoDoMes({ mes: "2025-11", tz: TZ, hoje: HOJE, primeiroDia: PRIMEIRO_DIA, pedidos: PEDIDOS, corte: corte.instante, hojeDoCorte: corte.dia });
confere("novembro/2025 inteiro: R$ 700 em 4 vendas", [nov25.valor, nov25.vendas, nov25.estado], [700, 4, "fechado"]);
confere("novembro/2025 até 07/11 às 15h: R$ 140 (o pedido das 20h ainda não tinha acontecido)",
  [nov25ate.valor, nov25ate.vendas, nov25ate.estado, nov25ate.ateODia], [140, 2, "corrente", "2025-11-07"]);

// ── O ano ──
const resumos = (ano: number) => mesesDoAno(ano).map((mes) => resumoDoMes({ mes, tz: TZ, hoje: HOJE, primeiroDia: PRIMEIRO_DIA, pedidos: PEDIDOS }));
const r = faturamentoMensal({ ano: 2026, atual: resumos(2026), anterior: resumos(2025), anteriorAteOMesmoDia: nov25ate });
const linha = (mes: string) => r.meses.find((m) => m.mes === mes)!;

confere("novembro compara com o ano passado ATÉ O MESMO DIA: 580 contra 140 = +314,29%",
  [linha("2026-11").comparavel, linha("2026-11").variacao.valor], [true, 3.1429]);
confere("…e o novembro inteiro do ano passado fica ao lado (o alvo da projeção)", linha("2026-11").anterior.valor, 700);
confere("outubro: 320 contra 1.000 = −68%", linha("2026-10").variacao.valor, -0.68);
confere("dezembro ainda não chegou: sem variação, mas o dezembro passado aparece",
  [linha("2026-12").atual.estado, linha("2026-12").comparavel, linha("2026-12").variacao.valor, linha("2026-12").anterior.valor], ["futuro", false, null, 2000]);
confere("março/2025 é o mês em que a loja começou (dia 10): sem variação em março/2026",
  [linha("2026-03").anterior.comecouEm, linha("2026-03").comparavel], ["2025-03-10", false]);
confere("janeiro/2025 é antes do 1º pedido: 'sem dados', não zero", linha("2026-01").anterior.estado, "sem-dados");
confere("total do ano até hoje = soma dos meses", [r.total.valor, r.total.vendas], [900, 11]);
// Comparáveis: abril a novembro (março é o de começo; jan e fev, sem dados).
// Atual: out 320 + nov 580 = 900 (os outros zerados). Anterior: out 1.000 + nov até o dia 140 = 1.140.
confere("ano contra ano só nos meses comparáveis, com novembro até o mesmo dia",
  [r.comparacao.meses, r.comparacao.atual.valor, r.comparacao.anterior.valor, r.comparacao.variacao.valor], [8, 900, 1140, -0.2105]);
confere("o ano passado inteiro", r.totalAnterior.valor, 4200);
confere("melhor mês e mês corrente", [r.melhorMes, r.mesCorrente], [{ mes: "2026-11", valor: 580 }, "2026-11"]);

// ── Datas e ano ──
confere("29/02 vira 28/02 no ano anterior", mesmoDiaNoAnoAnterior("2028-02-29"), "2027-02-28");
confere("estado do mês", [estadoDoMes("2026-12", HOJE, PRIMEIRO_DIA), estadoDoMes("2025-02", HOJE, PRIMEIRO_DIA), estadoDoMes("2025-03", HOJE, PRIMEIRO_DIA), estadoDoMes("2026-11", HOJE, PRIMEIRO_DIA)],
  ["futuro", "sem-dados", "fechado", "corrente"]);
confere("loja sem pedido nenhum: tudo 'sem dados'", estadoDoMes("2026-10", HOJE, null), "sem-dados");
confere("só vai ao banco nos meses com dado", [mesesParaBuscar(mesesDoAno(2025), HOJE, PRIMEIRO_DIA).length, mesesParaBuscar(mesesDoAno(2026), HOJE, PRIMEIRO_DIA).length], [10, 11]);
confere("ano da URL: só do ano do 1º pedido até hoje", [lerAno("2025", HOJE, PRIMEIRO_DIA), lerAno("2024", HOJE, PRIMEIRO_DIA), lerAno("2027", HOJE, PRIMEIRO_DIA), lerAno("abc", HOJE, PRIMEIRO_DIA), lerAno(null, HOJE, null)],
  [2025, 2026, 2026, 2026, 2026]);

console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
