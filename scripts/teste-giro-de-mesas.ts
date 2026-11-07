/**
 * Trava o Giro de mesas (lib/relatorios/giro-de-mesas.ts), as pessoas da mesa
 * (lib/pessoas-da-mesa.ts) e a taxa de serviço esperada × realizada do
 * Relatório de Mesas (lib/relatorios/relatorio-de-mesas.ts).
 *
 *   npx tsx scripts/teste-giro-de-mesas.ts
 *
 * Dados sintéticos: um salão de 5 mesas e 1 comanda em dois dias de
 * expediente. Confere cada coluna contra a conta de mão, que o faturamento
 * fecha com o "Consumo nas mesas" do Relatório de Mesas, e que o ticket por
 * pessoa nunca inventa pessoas.
 */
import { fmtPermanencia, giroDeMesas, nomeDaLinha, type ContaDoGiro, type MesaDoSalao } from "../src/lib/relatorios/giro-de-mesas";
import { mesasFechadasDoRelatorio } from "../src/lib/relatorios/relatorio-de-mesas";
import { pessoasDaConta, sanearPessoas } from "../src/lib/pessoas-da-mesa";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};
const SP = "America/Sao_Paulo";

// ── 1) Pessoas da mesa ──────────────────────────────────────────────────────
console.log("\n1) Quantas pessoas: o digitado, senão as nomeadas, senão não se sabe");
confere("vazio, zero, texto e negativo viram nulo", [sanearPessoas(""), sanearPessoas(0), sanearPessoas("abc"), sanearPessoas(-2), sanearPessoas(null)], [null, null, null, null, null]);
confere("'4' vira 4; 2,6 vira 3; 250 para em 99", [sanearPessoas("4"), sanearPessoas(2.6), sanearPessoas(250)], [4, 3, 99]);
confere("digitado vale mais que as nomeadas", pessoasDaConta({ pessoas: 4, convidados: 2 }), 4);
confere("sem digitado, as nomeadas", pessoasDaConta({ pessoas: null, convidados: 3 }), 3);
confere("sem nenhum dos dois: null (nunca 1, nunca a capacidade)", pessoasDaConta({ pessoas: null, convidados: 0 }), null);

// ── 2) O salão ──────────────────────────────────────────────────────────────
// Dias operacionais 07/11 e 08/11/2026 (sábado e domingo). Horário de Brasília (−3).
const h = (dia: string, hora: string) => `${dia}T${hora}:00-03:00`;
const venda = (totalAmount: number, itens: number[] = [1], status = "ENTREGUE") => ({ status, totalAmount, discountTotal: null, items: itens.map((q) => ({ quantity: q, price: 1 })) });

const mesas: MesaDoSalao[] = [
  { id: "m1", numero: 1 },
  { id: "m2", numero: 2, nome: "Varanda" },
  { id: "m3", numero: 3 },
  { id: "m4", numero: 4 },
  { id: "m5", numero: 5 }, // nunca abre: parada
  { id: "c101", numero: 101, comanda: true },
];

const contas: ContaDoGiro[] = [
  // Mesa 1: 3 contas — 4 pessoas digitadas, 2 nomeadas, 1 sem número.
  { id: "a", mesaId: "m1", abertaEm: h("2026-11-07", "19:00"), fechadaEm: h("2026-11-07", "20:00"), pessoas: 4, pedidos: [venda(120, [2, 2]), venda(40, [1])] },
  { id: "b", mesaId: "m1", abertaEm: h("2026-11-07", "20:30"), fechadaEm: h("2026-11-07", "21:00"), convidados: 2, pedidos: [venda(80, [1, 1])] },
  // fechada à 1h da manhã de 08/11: ainda é o expediente de 07/11
  { id: "c", mesaId: "m1", abertaEm: h("2026-11-07", "23:30"), fechadaEm: h("2026-11-08", "01:00"), pedidos: [venda(60, [3]), venda(999, [9], "CANCELADO")] },
  // Mesa 2: 2 contas, uma em cada dia.
  { id: "d", mesaId: "m2", abertaEm: h("2026-11-07", "19:00"), fechadaEm: h("2026-11-07", "21:00"), pessoas: 2, pedidos: [venda(100, [2])] },
  { id: "e", mesaId: "m2", abertaEm: h("2026-11-08", "12:00"), fechadaEm: h("2026-11-08", "13:30"), pessoas: 3, pedidos: [venda(150, [4])] },
  // Mesa 3: 1 conta, sem pessoas.
  { id: "f", mesaId: "m3", abertaEm: h("2026-11-08", "12:00"), fechadaEm: h("2026-11-08", "12:45"), pedidos: [venda(45, [1])] },
  // Mesa 4: 2 contas.
  { id: "g", mesaId: "m4", abertaEm: h("2026-11-08", "19:00"), fechadaEm: h("2026-11-08", "20:00"), pedidos: [venda(70, [2])] },
  { id: "i", mesaId: "m4", abertaEm: h("2026-11-08", "20:10"), fechadaEm: h("2026-11-08", "21:10"), pedidos: [venda(30, [1])] },
  // Mesa 4 liberada sem consumo (aberta por engano): fora do giro.
  { id: "j", mesaId: "m4", abertaEm: h("2026-11-08", "21:20"), fechadaEm: h("2026-11-08", "21:22"), pedidos: [] },
  // Comanda: fora do giro.
  { id: "k", mesaId: "c101", abertaEm: h("2026-11-08", "12:00"), fechadaEm: h("2026-11-08", "12:30"), pedidos: [venda(25, [1])] },
];

const g = giroDeMesas({ mesas, contas, tz: SP, de: "2026-11-07", ate: "2026-11-08", hoje: "2026-11-08" });
const linha = (id: string) => g.mesas.find((l) => l.mesaId === id)!;

console.log("\n2) Mesa 1: giro, faturamento, tickets, P.A. e tempo");
const m1 = linha("m1");
confere("3 contas; o cancelado fora do consumo (120 + 40 + 80 + 60 = 300)", [m1.contas, m1.faturamento], [3, 300]);
confere("giro por dia: 3 ÷ 2 dias de salão aberto = 1,5", m1.giroPorDia, 1.5);
confere("ticket por conta 100", m1.ticketPorConta, 100);
confere("pessoas: 4 digitadas + 2 nomeadas, em 2 das 3 contas", [m1.pessoas, m1.contasComPessoas], [6, 2]);
confere("ticket por pessoa: (160 + 80) ÷ 6 = 40 — a conta sem número fica fora dos dois lados", m1.ticketPorPessoa, 40);
confere("P.A.: (2+2+1) + (1+1) + 3 = 10 itens ÷ 3 = 3,3 (o cancelado não conta)", [m1.itens, m1.pa], [10, 3.3]);
confere("permanência: 60 + 30 + 90 min ÷ 3 = 60", m1.permanenciaMediaMin, 60);
confere("R$ por hora: 300 ÷ 3 h = 100", [m1.horasOcupada, m1.reaisPorHora], [3, 100]);

console.log("\n3) Sem nº de pessoas não vira número");
const m3 = linha("m3");
confere("mesa 3: nenhuma conta com pessoas → ticket por pessoa nulo", [m3.pessoas, m3.contasComPessoas, m3.ticketPorPessoa], [0, 0, null]);
confere("mesa 4: ticket por pessoa nulo, ticket por conta 50", [linha("m4").ticketPorPessoa, linha("m4").ticketPorConta], [null, 50]);

console.log("\n4) Fora do giro: liberada sem consumo e comanda");
confere("1 liberada sem consumo, 1 conta de comanda", [g.resumo.liberadasSemConsumo, g.resumo.contasDeComanda], [1, 1]);
confere("a comanda não entra no ranking", g.mesas.some((l) => l.mesaId === "c101"), false);
confere("mesa 4 tem 2 contas, não 3", linha("m4").contas, 2);

console.log("\n5) O resumo do salão");
const r = g.resumo;
confere("8 contas, 5 mesas, 4 giraram, 2 dias abertos, 2 dias no período", [r.contas, r.mesas, r.mesasQueGiraram, r.diasAbertos, r.diasDoPeriodo], [8, 5, 4, 2, 2]);
confere("faturamento 300 + 250 + 45 + 100 = 695", r.faturamento, 695);
confere("giro médio: 8 contas ÷ 5 mesas ÷ 2 dias = 0,8", r.giroMedioPorMesa, 0.8);
confere("ticket por conta 695 ÷ 8 = 86,88 (centavo inteiro)", r.ticketPorConta, 86.88);
confere("ticket por pessoa: (160 + 80 + 100 + 150) ÷ (4 + 2 + 2 + 3) = 490 ÷ 11 = 44,55", [r.pessoas, r.contasComPessoas, r.ticketPorPessoa], [11, 4, 44.55]);
confere("P.A.: 10 + 2 + 4 + 1 + 2 + 1 = 20 itens ÷ 8 = 2,5", [r.itens, r.pa], [20, 2.5]);
// 60+30+90 | 120+90 | 45 | 60+60 = 555 min
confere("permanência média 555 ÷ 8 = 69 min; 9,3 h ocupadas", [r.permanenciaMediaMin, r.horasOcupada], [69, 9.3]);
confere("R$ por hora: 695 ÷ 9,25 h = 75,14", r.reaisPorHora, 75.14);
confere("Σ faturamento das linhas = o do salão", Math.round(g.mesas.reduce((s, l) => s + l.faturamento, 0) * 100) / 100, r.faturamento);
confere("Σ % do salão ≈ 100", Math.round(g.mesas.reduce((s, l) => s + l.participacao, 0)), 100);

console.log("\n6) Bate com o Relatório de Mesas (Consumo nas mesas), nas mesmas contas");
const mesmas = contas.filter((c) => c.mesaId !== "c101").map((c) => ({ id: c.id, serviceFee: 0, waiterTip: 0, fechadaEm: c.fechadaEm, pago: 0, pedidos: c.pedidos }));
confere("consumo do Relatório de Mesas = faturamento do giro (a liberada soma zero)", mesasFechadasDoRelatorio(mesmas).consumo, r.faturamento);

console.log("\n7) Destaques: as que mais rendem e as paradas");
confere("ordem pelo faturamento: 1, 2, 4, 3, 5", g.mesas.map((l) => l.numero), [1, 2, 4, 3, 5]);
confere("mesa 1 rende mais (1 a cada 5 das 4 que giraram = 1)", [m1.destaque, m1.motivo], ["rende", "das que mais faturam"]);
confere("mesa 5 parada: não abriu no período", [linha("m5").destaque, linha("m5").motivo], ["parada", "não abriu no período"]);
// média de contas por mesa: 8 ÷ 5 = 1,6; metade = 0,8 → a mesa 3 (1 conta) não é parada
confere("mesa 3, com 1 conta (média 1,6; metade 0,8), não é parada", linha("m3").destaque, null);
confere("com 2 mesas não há destaque", giroDeMesas({ mesas: mesas.slice(0, 2), contas: contas.slice(0, 4), tz: SP, de: "2026-11-07", ate: "2026-11-08" }).mesas.map((l) => l.destaque), [null, null]);

console.log("\n8) Período e textos");
confere("'Este mês' no dia 08: dias do período até hoje", giroDeMesas({ mesas, contas: [], tz: SP, de: "2026-11-01", ate: "2026-11-30", hoje: "2026-11-08" }).resumo.diasDoPeriodo, 8);
confere("salão sem conta: giro e tickets nulos, nada dividido por zero", (() => { const v = giroDeMesas({ mesas, contas: [], tz: SP, de: "2026-11-07", ate: "2026-11-07" }).resumo; return [v.giroMedioPorMesa, v.ticketPorConta, v.ticketPorPessoa, v.pa, v.reaisPorHora]; })(), [null, null, null, null, null]);
confere("nome da linha", [nomeDaLinha(linha("m2")), nomeDaLinha({ numero: 7, nome: null, loja: "Centro" })], ["Mesa 2 · Varanda", "Mesa 7 (Centro)"]);
confere("permanência em texto", [fmtPermanencia(45), fmtPermanencia(60), fmtPermanencia(85), fmtPermanencia(null)], ["45 min", "1h", "1h25", "—"]);

// ── 9) Taxa de serviço esperada × realizada (Relatório de Mesas) ────────────
console.log("\n9) Taxa de serviço: esperado × realizado por garçom");
const ses = [
  // Ana: 2 contas pagaram os 10% (100 → 10; 50 → 5); 1 recusou (80 → 0).
  { id: "t1", waiterId: "ana", garcom: "Ana", serviceFee: 10, waiterTip: 0, fechadaEm: "2026-11-07T23:00:00Z", pago: 110, pedidos: [venda(100)] },
  { id: "t2", waiterId: "ana", garcom: "Ana", serviceFee: 5, waiterTip: 0, fechadaEm: "2026-11-07T23:10:00Z", pago: 55, pedidos: [venda(50)] },
  { id: "t3", waiterId: "ana", garcom: "Ana", serviceFee: 0, waiterTip: 0, fechadaEm: "2026-11-07T23:20:00Z", pago: 80, pedidos: [venda(80)] },
  // Beto: desconto de 20 numa conta de 120; taxa de 10% sobre os 100 que sobraram = 10 → 100% atingido.
  { id: "t4", waiterId: "beto", garcom: "Beto", serviceFee: 10, waiterTip: 0, fechadaEm: "2026-11-07T23:30:00Z", pago: 110, pedidos: [venda(120)] },
  // Liberada sem consumo: nada a esperar, não conta como "sem taxa".
  { id: "t5", waiterId: "beto", garcom: "Beto", serviceFee: 0, waiterTip: 0, fechadaEm: "2026-11-07T23:40:00Z", pago: 0, pedidos: [] },
];
const mf = mesasFechadasDoRelatorio(ses, { taxaPct: 10 });
const ana = mf.porGarcom.find((x) => x.nome === "Ana")!;
const beto = mf.porGarcom.find((x) => x.nome === "Beto")!;
confere("Ana: esperado 23, cobrado 15, 65,2% atingido, 1 conta sem taxa", [ana.taxaEsperada, ana.taxaServico, ana.pctAtingido, ana.contasSemTaxa], [23, 15, 65.2, 1]);
confere("Beto: esperado sobre o consumo descontado (100 → 10), 100%", [beto.desconto, beto.taxaEsperada, beto.pctAtingido, beto.contasSemTaxa], [20, 10, 100, 0]);
confere("total: esperado 33, cobrado 25, 75,8%", [mf.taxaPct, mf.taxaEsperada, mf.taxaServico, mf.pctAtingido, mf.contasSemTaxa], [10, 33, 25, 75.8, 1]);
confere("loja que não cobra taxa (0%): nada esperado, % nulo", (() => { const z = mesasFechadasDoRelatorio(ses, { taxaPct: 0 }); return [z.taxaEsperada, z.pctAtingido]; })(), [0, null]);
confere("sem a % (chamada antiga): esperado 0, % nulo — o resto igual", (() => { const z = mesasFechadasDoRelatorio(ses); return [z.taxaPct, z.taxaEsperada, z.pctAtingido, z.taxaServico]; })(), [null, 0, null, 25]);

console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
