/**
 * Teste da regra do modelo de cobrança (lib/modelo-de-cobranca.ts).
 *   npx tsx scripts/teste-modelo-de-cobranca.ts
 */
import { modeloDaLoja, valorDaRenovacao, dataDaRenovacao, VIRADA_DO_PRE_PAGO } from "../src/lib/modelo-de-cobranca";

let falhas = 0, ok = 0;
function igual(nome: string, veio: unknown, esperado: unknown) {
  if (JSON.stringify(veio) === JSON.stringify(esperado)) { ok++; return; }
  falhas++;
  console.log(`✗ ${nome}\n  veio:     ${JSON.stringify(veio)}\n  esperado: ${JSON.stringify(esperado)}`);
}
const br = (d: Date) => d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

// Modelo pela data de criação (23/11/2026 00:00 de Brasília)
igual("virada é 23/11 00:00 Brasília", br(VIRADA_DO_PRE_PAGO), "23/11/2026, 00:00:00");
igual("criada 22/11 23:59 Brasília = percentual", modeloDaLoja("2026-11-23T02:59:59Z"), "PERCENTUAL");
igual("criada 23/11 00:00 Brasília = pré-pago", modeloDaLoja("2026-11-23T03:00:00Z"), "PRE_PAGO");
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

console.log(`\n${ok} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
