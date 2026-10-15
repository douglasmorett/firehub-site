/**
 * Teste do relatório "Acerto de entregadores" (lib/relatorios/acerto-de-entregadores.ts)
 * — a soma da equipe por cima do acerto de cada motoboy. Rodar:
 * npx tsx scripts/teste-acerto-de-entregadores.ts
 */
import { acertoDaEquipe, type MotoboyDoAcerto } from "../src/lib/relatorios/acerto-de-entregadores";

let falhas = 0;
const confere = (nome: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHOU"} ${nome}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`}`);
};

const tz = "America/Sao_Paulo";
const stats = (s: Partial<MotoboyDoAcerto["stats"]>): MotoboyDoAcerto["stats"] => ({
  totalDeliveries: 0, entreguesCount: 0, emAndamentoCount: 0, canceladasComCorridaCount: 0, canceladasSemCorridaCount: 0,
  valorDosPedidos: 0, totalDistance: 0, uniqueDays: 0, cashCollectedSum: 0, changeGivenSum: 0, cardPosTotal: 0, pixTotal: 0,
  onlineTotal: 0, fiadoTotal: 0, naoIdentificadoTotal: 0, naoIdentificadoCount: 0, dailyTotal: 0, feeTotal: 0, totalWithDaily: 0,
  lancheDescontado: 0, ...s,
});

// Jobson: 2 dias, diária R$ 40, 3 entregas de R$ 5; R$ 150 em dinheiro com ele.
// 01/10 20h e 21h (horário de Brasília = 23h e 00h UTC) e 03/10 01h — a da 1h é do expediente do dia 02.
const jobson: MotoboyDoAcerto = {
  motoboy: { id: "j", name: "Jobson", paymentType: "BOTH", dailyRate: 40, active: true },
  stats: stats({ totalDeliveries: 3, entreguesCount: 3, uniqueDays: 2, dailyTotal: 80, feeTotal: 15, totalWithDaily: 95, cashCollectedSum: 150, valorDosPedidos: 200, totalDistance: 9 }),
  orders: [
    { id: "1", createdAt: "2026-10-01T23:00:00Z", ganhoDoMotoboy: 5, corrida: true },
    { id: "2", createdAt: "2026-10-02T00:30:00Z", ganhoDoMotoboy: 5, corrida: true },
    { id: "3", createdAt: "2026-10-03T04:00:00Z", ganhoDoMotoboy: 5, corrida: true },
    // cancelado antes de sair: não é corrida, não entra no dia nem na hora
    { id: "4", createdAt: "2026-10-01T23:10:00Z", ganhoDoMotoboy: 0, corrida: false, cancelado: true },
  ],
};
// Lucas: 1 dia, por entrega R$ 7, 1 entrega, sem dinheiro; lanche de R$ 3 descontado.
const lucas: MotoboyDoAcerto = {
  motoboy: { id: "l", name: "Lucas", paymentType: "PER_DELIVERY", active: true, entregasSemDistancia: 1 },
  stats: stats({ totalDeliveries: 1, entreguesCount: 1, uniqueDays: 1, feeTotal: 7, totalWithDaily: 4, lancheDescontado: 3, valorDosPedidos: 50 }),
  orders: [{ id: "5", createdAt: "2026-10-01T23:40:00Z", ganhoDoMotoboy: 7, corrida: true }],
};
const parado: MotoboyDoAcerto = { motoboy: { id: "p", name: "Parado", active: false }, stats: stats({}), orders: [] };

const r = acertoDaEquipe([{ loja: "Hakim Centro", report: [lucas, parado, jobson] }], tz);

confere("ordem por entregas", r.linhas.map((l) => l.nome), ["Jobson", "Lucas"]);
confere("sem entrega à parte", r.semEntrega, [{ nome: "Parado", loja: "Hakim Centro", ativo: false }]);
confere("saldo do Jobson: devolve 55", r.linhas[0].saldo, -55);
confere("saldo do Lucas: loja paga 4", r.linhas[1].saldo, 4);
confere("a pagar da equipe", r.total.aPagar, 99);
confere("saldo da equipe", r.total.saldo, -51);
confere("custo por entrega", r.total.custoPorEntrega, 24.75);
confere("peso no valor (99/250)", Math.round((r.total.pesoNoValor || 0) * 10) / 10, 39.6);
confere("% das entregas", r.linhas.map((l) => l.pctDasEntregas), [75, 25]);
confere("dias operacionais (a da 1h é do dia anterior)", r.dias.map((d) => [d.dia, d.entregas]), [["2026-10-01", 3], ["2026-10-02", 1]]);
// 01/10: ganhos 5+5+7 + diária do Jobson (40) + diária do Lucas (0) = 57
confere("custo do dia 01/10", r.dias[0].custo, 57);
confere("motoboys no dia 01/10", r.dias[0].motoboys, 2);
confere("horas na ordem do expediente, com as vazias", r.horas.map((h) => h.hora), [20, 21, 22, 23, 0, 1]);
confere("hora vazia zerada", [r.horas[2].entregas, r.horas[2].motoboysNaHora], [0, 0]);
confere("motoboys às 20h", r.horas[0].motoboysNaHora, 2);
confere("aviso de sem distância", r.avisos.some((a) => a.tom === "grave" && a.texto.startsWith("Lucas")), true);

if (falhas) { console.log(`\n${falhas} falha(s)`); process.exit(1); }
console.log("\ntudo certo");
