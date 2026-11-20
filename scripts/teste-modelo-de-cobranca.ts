/**
 * Teste da regra do modelo de cobrança (lib/modelo-de-cobranca.ts).
 *   npx tsx scripts/teste-modelo-de-cobranca.ts
 */
import { modeloDaLoja, valorDaRenovacao, dataDaRenovacao, VIRADA_DO_PRE_PAGO, prePagoSemAtivacao } from "../src/lib/modelo-de-cobranca";
import { bloqueioDaMensalidade, bloqueioDoCiclo, ehCicloPrePago, MARCA_DA_ATIVACAO, MARCA_DA_RENOVACAO, vencimentoDoCiclo } from "../src/lib/prazo-da-mensalidade";
import { cicloBloqueia } from "../src/lib/loja-bloqueada";

let falhas = 0, ok = 0;
function igual(nome: string, veio: unknown, esperado: unknown) {
  if (JSON.stringify(veio) === JSON.stringify(esperado)) { ok++; return; }
  falhas++;
  console.log(`✗ ${nome}\n  veio:     ${JSON.stringify(veio)}\n  esperado: ${JSON.stringify(esperado)}`);
}
const br = (d: Date) => d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

// Modelo pela data de criação (21/11/2026 00:00 de Brasília)
igual("virada é 21/11 00:00 Brasília", br(VIRADA_DO_PRE_PAGO), "21/11/2026, 00:00:00");
igual("criada 20/11 23:59 Brasília = percentual", modeloDaLoja("2026-11-21T02:59:59Z"), "PERCENTUAL");
igual("criada 21/11 00:00 Brasília = pré-pago", modeloDaLoja("2026-11-21T03:00:00Z"), "PRE_PAGO");
igual("criada em outubro = percentual", modeloDaLoja(new Date("2026-10-10T12:00:00Z")), "PERCENTUAL");
igual("sem data = percentual", modeloDaLoja(null), "PERCENTUAL");
igual("loja extra nova de conta antiga segue a principal", modeloDaLoja("2026-12-01T12:00:00Z", "2026-09-01T12:00:00Z"), "PERCENTUAL");
igual("loja extra de conta nova = pré-pago", modeloDaLoja("2026-12-01T12:00:00Z", "2026-11-25T12:00:00Z"), "PRE_PAGO");

// Degrau da renovação
igual("vendeu 0 = 200", valorDaRenovacao(0), 200);
igual("vendeu 9.999,99 = 200", valorDaRenovacao(9999.99), 200);
igual("vendeu exatamente 10 mil = 200", valorDaRenovacao(10000), 200);
igual("vendeu 10.000,01 = 400", valorDaRenovacao(10000.01), 400);
igual("vendeu 45 mil = 400", valorDaRenovacao(45000), 400);

// Data da renovação: mesma data do mês seguinte, mesma hora, no fuso da loja
igual("08/12 15h → 08/01 15h", br(dataDaRenovacao("2026-12-08T18:00:00Z")), "08/01/2027, 15:00:00");
igual("08/12 → 2ª renovação 08/02", br(dataDaRenovacao("2026-12-08T18:00:00Z", 2)), "08/02/2027, 15:00:00");
igual("31/01 → 28/02 (fevereiro curto)", br(dataDaRenovacao("2027-01-31T15:00:00Z")), "28/02/2027, 12:00:00");
igual("31/01 → 2ª renovação 31/03", br(dataDaRenovacao("2027-01-31T15:00:00Z", 2)), "31/03/2027, 12:00:00");
igual("30/11 → 30/12", br(dataDaRenovacao("2026-11-30T13:00:00Z")), "30/12/2026, 10:00:00");
igual("15/12 23h30 Brasília (02h30 UTC do dia 16) → 15/01 23h30", br(dataDaRenovacao("2026-12-16T02:30:00Z")), "15/01/2027, 23:30:00");
igual("Manaus: 08/12 20h local → 08/01 20h local", dataDaRenovacao("2026-12-09T00:00:00Z", 1, "America/Manaus").toLocaleString("pt-BR", { timeZone: "America/Manaus" }), "08/01/2027, 20:00:00");

// ── Prazos e bloqueio do pré-pago (lib/prazo-da-mensalidade.ts, lib/loja-bloqueada.ts) ──
const venc = new Date("2027-01-08T18:00:00Z"); // 08/01 15h Brasília
const H = 3_600_000, D = 24 * H;
const renov = { yearMonth: "2027-01", status: "CLOSED", amountPending: 200, closedAt: new Date(venc.getTime() - 5 * D), dueDate: venc, notes: `${MARCA_DA_RENOVACAO} | Mensalidade R$200.00` };
const ativ = { yearMonth: "2026-12", status: "CLOSED", amountPending: 200, closedAt: new Date("2026-12-03T18:00:00Z"), dueDate: new Date("2026-12-08T18:00:00Z"), notes: `${MARCA_DA_ATIVACAO} | Ativação R$200.00` };
igual("ciclo pré-pago é reconhecido", ehCicloPrePago(renov), true);
igual("vencimento da renovação = data da loja", vencimentoDoCiclo(renov).dia, "2027-01-08");
igual("renovação: no vencimento ainda não trava", cicloBloqueia(renov, "x@y.com", venc), false);
igual("renovação: 4 dias depois ainda não trava (tolerância)", cicloBloqueia(renov, "x@y.com", new Date(venc.getTime() + 4 * D)), false);
igual("renovação: 5 dias depois trava", cicloBloqueia(renov, "x@y.com", new Date(venc.getTime() + 5 * D)), true);
igual("ativação: 1 minuto antes do fim do teste não trava", cicloBloqueia(ativ, "x@y.com", new Date(ativ.dueDate.getTime() - 60_000)), false);
igual("ativação: no fim do teste já trava (sem tolerância)", cicloBloqueia(ativ, "x@y.com", ativ.dueDate), true);
igual("ativação paga não trava", cicloBloqueia({ ...ativ, status: "PAID", amountPending: 0 }, "x@y.com", new Date("2026-12-20T12:00:00Z")), false);
// A base não muda: ciclo de outubro sem marca trava no fim do dia 10/11, como sempre.
const antigo = { yearMonth: "2026-10", status: "CLOSED", amountPending: 300, closedAt: new Date("2026-11-01T03:30:00Z"), dueDate: new Date("2026-11-11T02:59:59Z"), notes: null };
igual("base: vencimento continua dia 5", vencimentoDoCiclo(antigo).dia, "2026-11-05");
igual("base: 10/11 ao meio-dia não trava", cicloBloqueia(antigo, "x@y.com", new Date("2026-11-10T15:00:00Z")), false);
igual("base: 11/11 trava", cicloBloqueia(antigo, "x@y.com", new Date("2026-11-11T12:00:00Z")), true);
igual("base: bloqueio igual ao de antes", bloqueioDoCiclo(antigo).toISOString(), bloqueioDaMensalidade("2026-10", new Date("2026-11-01T03:30:00Z")).toISOString());

// Conta pré-paga que terminou o teste sem nenhuma cobrança trava; a antiga, nunca.
const criadaNova = "2026-11-24T15:00:00Z", fimTeste = "2026-12-09T15:00:00Z";
igual("pré-pago em teste não trava", prePagoSemAtivacao({ criadaEm: criadaNova, trialEndsAt: fimTeste, temCobranca: false }, new Date("2026-12-05T12:00:00Z")), false);
igual("pré-pago depois do teste sem cobrança trava", prePagoSemAtivacao({ criadaEm: criadaNova, trialEndsAt: fimTeste, temCobranca: false }, new Date("2026-12-10T12:00:00Z")), true);
igual("pré-pago com cobrança: quem decide é o ciclo", prePagoSemAtivacao({ criadaEm: criadaNova, trialEndsAt: fimTeste, temCobranca: true }, new Date("2026-12-10T12:00:00Z")), false);
igual("pré-pago isenta nunca trava", prePagoSemAtivacao({ criadaEm: criadaNova, trialEndsAt: fimTeste, planPercent: 0, temCobranca: false }, new Date("2026-12-10T12:00:00Z")), false);
igual("conta antiga com teste acabado NÃO trava por isso", prePagoSemAtivacao({ criadaEm: "2026-11-10T15:00:00Z", trialEndsAt: "2026-11-25T15:00:00Z", temCobranca: false }, new Date("2026-12-10T12:00:00Z")), false);
igual("loja extra nova de conta antiga NÃO trava por isso", prePagoSemAtivacao({ criadaEm: criadaNova, principalCriadaEm: "2026-09-01T12:00:00Z", trialEndsAt: fimTeste, temCobranca: false }, new Date("2026-12-10T12:00:00Z")), false);

// Pagou atrasado: a data seguinte não anda (sempre a partir da ativação).
const ativacaoEm = new Date("2026-12-10T15:00:00Z");
igual("ativação 10/12 → renova 10/01", br(dataDaRenovacao(ativacaoEm, 1)), "10/01/2027, 12:00:00");
igual("pagou a de 10/01 no dia 15 → a próxima continua 10/02", br(dataDaRenovacao(ativacaoEm, 2)), "10/02/2027, 12:00:00");

console.log(`\n${ok} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
