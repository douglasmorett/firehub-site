/**
 * Trava o FLUXO DE CAIXA (lib/relatorios/fluxo-de-caixa.ts): realizado antes
 * de hoje × previsto de hoje em diante, a conta vencida entrando hoje, a conta
 * paga no dia do "Já paguei", a parcela recorrente que ainda não existe, a
 * despesa lançada, o saldo ancorado no dia informado (para a frente e para
 * trás), o aviso do 1º dia negativo (só com saldo informado), as vendas
 * previstas pelas últimas 4 semanas e o agrupamento por semana e por mês.
 *
 *   npx tsx scripts/teste-fluxo-de-caixa.ts
 *
 * "Hoje" = terça 03/11/2026.
 */
import { DIAS_DA_BASE, agruparFluxo, fluxoDeCaixa, recorrentesPrevistas, vendasPrevistas, type ContaParaFluxo } from "../src/lib/relatorios/fluxo-de-caixa";
import type { Recebivel } from "../src/lib/relatorios/recebiveis";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

const HOJE = "2026-11-03";
const rec = (diaDaVenda: string, dia: string, liquido: number, chave = "PIX"): Recebivel => ({
  diaDaVenda, dia, chave, rotulo: chave === "PIX" ? "Pix" : chave, tipo: "LOJA", quantidade: 1, bruto: liquido, taxaPct: 0, taxa: 0, liquido, prazo: 0, prazoPadrao: true,
});

const RECEBIVEIS: Recebivel[] = [
  rec("2026-11-01", "2026-11-01", 100),
  rec("2026-11-02", "2026-11-02", 50),
  rec("2026-10-05", "2026-11-04", 200, "CREDITO"), // crédito de outubro caindo amanhã
];
const CONTAS: ContaParaFluxo[] = [
  // Paga ontem: saída realizada em 02/11.
  { id: "c1", fornecedor: "Gás", valor: 30, vencimento: "2026-11-05", pago: true, pagoEm: "2026-11-02" },
  // Pendente e vencida em 01/11: entra HOJE, marcada.
  { id: "c2", fornecedor: "Luz", valor: 80, vencimento: "2026-11-01", pago: false, pagoEm: null },
  // Pendente no dia 05.
  { id: "c3", fornecedor: "Carne", valor: 400, vencimento: "2026-11-05", pago: false, pagoEm: null },
  // A 1ª parcela da recorrente (gerada no cadastro, em novembro).
  { id: "c4", fornecedor: "Aluguel", valor: 1000, vencimento: "2026-11-10", pago: false, pagoEm: null, recorrenteId: "r1" },
];
const RECORRENTES = [
  { id: "r1", fornecedor: "Aluguel", valor: 1000, diaDoVencimento: 10, ativa: true },
  { id: "r2", fornecedor: "Contador", valor: 300, diaDoVencimento: 31, ativa: true },
  { id: "r3", fornecedor: "Desligada", valor: 999, diaDoVencimento: 5, ativa: false },
];
const DESPESAS = [
  { id: "d1", dia: "2026-11-02", categoria: "Embalagem", descricao: "Caixas", valor: 20 },
  { id: "d2", dia: "2026-11-06", categoria: "Conserto", descricao: null, valor: 15 },
];

// ── Recorrentes ──
const parcelas = recorrentesPrevistas(RECORRENTES, CONTAS, { hoje: HOJE, ate: "2026-12-31" });
confere("recorrentes: aluguel de nov já existe; dez previsto; contador 30/11 (dia 31 → último dia) e 31/12; desligada não",
  parcelas.map((c) => `${c.fornecedor} ${c.vencimento}`), ["Aluguel 2026-12-10", "Contador 2026-11-30", "Contador 2026-12-31"]);

// ── Sem saldo informado ──
const semSaldo = fluxoDeCaixa({ de: "2026-11-01", ate: "2026-11-06", hoje: HOJE, recebiveis: RECEBIVEIS, previstas: [], contas: CONTAS, recorrentes: RECORRENTES, despesas: DESPESAS, saldo: null });
const d = (dia: string, r = semSaldo) => r.dias.find((x) => x.dia === dia)!;
confere("01/11 passado: entrada realizada 100", [d("2026-11-01").quando, d("2026-11-01").entradasRealizadas, d("2026-11-01").aReceber], ["passado", 100, 0]);
confere("02/11: entrada 50; saídas realizadas 30 (gás pago) + 20 (despesa)", [d("2026-11-02").entradasRealizadas, d("2026-11-02").saidasRealizadas], [50, 50]);
confere("03/11 hoje: a pagar 80 (luz vencida em 01/11)", [d("2026-11-03").quando, d("2026-11-03").aPagar, d("2026-11-03").movimentos[0].vencidaEm], ["hoje", 80, "2026-11-01"]);
confere("04/11: a receber 200 (crédito de outubro)", d("2026-11-04").aReceber, 200);
confere("05/11: a pagar 400; 06/11: despesa lançada para o futuro, 15", [d("2026-11-05").aPagar, d("2026-11-06").aPagar], [400, 15]);
confere("sem saldo, começa em zero e anda", [semSaldo.saldoInicial, d("2026-11-01").saldo, d("2026-11-02").saldo, d("2026-11-03").saldo], [0, 100, 100, 20]);
confere("saldo final: 100 + 50 − 50 − 80 + 200 − 400 − 15", semSaldo.saldoFinal, -195);
confere("sem saldo informado não há aviso de negativo (seria falso)", semSaldo.negativo, null);
confere("vencidas", semSaldo.vencidas, { quantidade: 1, valor: 80 });
confere("o saldo anterior de um dia é o saldo do dia antes", d("2026-11-05").saldoAnterior, d("2026-11-04").saldo);

// ── Com saldo informado HOJE (começo do dia): R$ 300 ──
const comSaldo = fluxoDeCaixa({ de: "2026-11-01", ate: "2026-11-06", hoje: HOJE, recebiveis: RECEBIVEIS, previstas: [], contas: CONTAS, recorrentes: RECORRENTES, despesas: DESPESAS, saldo: { valor: 300, dia: HOJE } });
confere("hoje começa em 300; para trás: 02/11 terminou em 300", [d("2026-11-03", comSaldo).saldoAnterior, d("2026-11-02", comSaldo).saldo], [300, 300]);
confere("para trás: 01/11 começou em 300 − 0 − 100 = 200", d("2026-11-01", comSaldo).saldoAnterior, 200);
confere("para a frente: 03 → 220, 04 → 420, 05 → 20, 06 → 5", ["2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"].map((x) => d(x, comSaldo).saldo), [220, 420, 20, 5]);
confere("nada negativo", comSaldo.negativo, null);

// Saldo menor: R$ 100 → 05/11 fica em −180.
const apertado = fluxoDeCaixa({ de: "2026-11-01", ate: "2026-11-06", hoje: HOJE, recebiveis: RECEBIVEIS, previstas: [], contas: CONTAS, recorrentes: RECORRENTES, despesas: DESPESAS, saldo: { valor: 100, dia: HOJE } });
confere("1º dia negativo: 05/11, −180, e as contas que mais pesam até lá", apertado.negativo, {
  dia: "2026-11-05", saldo: -180, maioresContas: [{ descricao: "Carne", dia: "2026-11-05", valor: 400 }, { descricao: "Luz", dia: "2026-11-03", valor: 80 }],
});
confere("menor saldo do período: 06/11, depois do conserto de R$ 15", apertado.menorSaldo, { dia: "2026-11-06", valor: -195 });

// Saldo informado ANTES do período (29/10, R$ 1.000): a linha vem de lá.
const antigo = fluxoDeCaixa({ de: "2026-11-01", ate: "2026-11-03", hoje: HOJE, recebiveis: RECEBIVEIS, previstas: [], contas: CONTAS, recorrentes: [], despesas: DESPESAS, saldo: { valor: 1000, dia: "2026-10-29" } });
confere("saldo de 29/10 sem movimento até 31/10: 01/11 começa em 1.000", antigo.saldoInicial, 1000);
confere("o período continua começando em 01/11", antigo.dias[0].dia, "2026-11-01");

// ── Vendas previstas: as próximas 4 semanas repetem as últimas 4 ──
const base: Recebivel[] = [
  rec("2026-10-06", "2026-10-06", 10),             // 28 dias antes de hoje: repete HOJE (fora) e hoje + 28
  rec("2026-11-02", "2026-11-02", 70),             // ontem: repete em 30/11
  rec("2026-11-02", "2026-12-02", 90, "CREDITO"),  // crédito de ontem: a venda de 30/11 cai em 30/12 (depois do fim)
  rec("2026-10-20", "2026-10-21", 33, "DEBITO"),   // terça 20/10: repete 17/11 e cai 18/11
];
const prev = vendasPrevistas(base, { hoje: HOJE, ate: "2026-12-01" });
confere("previstas: hoje fica de fora; 30/11 ← 02/11; 17/11 ← 20/10; 01/12 ← 03/11 − 28 = 06/10",
  prev.map((x) => `${x.diaDaVenda}>${x.dia}:${x.liquido}`).sort(),
  ["2026-11-17>2026-11-18:33", "2026-11-30>2026-11-30:70", "2026-12-01>2026-12-01:10"]);
confere("base de 28 dias", DIAS_DA_BASE, 28);
const comPrev = fluxoDeCaixa({ de: HOJE, ate: "2026-12-01", hoje: HOJE, recebiveis: [], previstas: prev, contas: [], recorrentes: [], despesas: [], saldo: null });
confere("as previstas entram na coluna própria", [comPrev.total.vendasPrevistas, comPrev.total.aReceber], [113, 0]);

// ── Por semana e por mês ──
const semanas = agruparFluxo(semSaldo.dias, "semana");
confere("semanas: dom 01/11 é da semana de 26/10; 02 a 06 é outra", semanas.map((s) => [s.de, s.ate]), [["2026-11-01", "2026-11-01"], ["2026-11-02", "2026-11-06"]]);
confere("a semana soma e leva o saldo do 1º e do último dia", [semanas[1].saldoAnterior, semanas[1].entradasRealizadas, semanas[1].aPagar, semanas[1].saldo, semanas[1].temNegativo], [100, 50, 495, -195, true]);
const meses = agruparFluxo(semSaldo.dias, "mes");
confere("mês", [meses.length, meses[0].rotulo, meses[0].saldo], [1, "nov/2026", -195]);

console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ Tudo certo");
process.exit(falhas ? 1 : 0);
