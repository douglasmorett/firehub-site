/**
 * A virada das 5h que conta as entregas do motoboy (lib/fuso.ts,
 * viradaDoExpedienteDaLoja) e o dia do relatório do motoboy.
 *
 *   npx tsx scripts/teste-virada-do-expediente.ts
 *
 * O caso: Frangoso, entrega da 1h contada duas vezes (02/10/2026).
 */
import { viradaDoExpedienteDaLoja, inicioDoExpedienteDaLoja, HORA_DE_VIRADA_DO_EXPEDIENTE } from "../src/lib/fuso";
import { getStartOfDayUTC, getEndOfDayUTC } from "../src/lib/timezone";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};
const SP = "America/Sao_Paulo";
const iso = (d: Date) => d.toISOString();

console.log("\n— O app do motoboy: desde quando conta 'concluídas hoje' —");
// 22h de 02/10 em Brasília = 01:00Z de 03/10.
confere("às 22h a conta começa às 5h de hoje, não à meia-noite",
  iso(viradaDoExpedienteDaLoja(SP, new Date("2026-10-03T01:00:00Z"))), "2026-10-02T08:00:00.000Z");
confere("a meia-noite de antes (o defeito) engolia a madrugada",
  iso(inicioDoExpedienteDaLoja(SP, new Date("2026-10-03T01:00:00Z"))), "2026-10-02T03:00:00.000Z");
const entregaDa1h = new Date("2026-10-02T04:00:00Z"); // 01:00 de 02/10 em Brasília
confere("a entrega da 1h NÃO conta no turno da noite seguinte",
  entregaDa1h >= viradaDoExpedienteDaLoja(SP, new Date("2026-10-03T01:00:00Z")), false);
confere("…e conta no turno dela (às 1h30 da mesma madrugada)",
  entregaDa1h >= viradaDoExpedienteDaLoja(SP, new Date("2026-10-02T04:30:00Z")), true);
confere("às 4h59 ainda é o expediente de ontem",
  iso(viradaDoExpedienteDaLoja(SP, new Date("2026-10-02T07:59:00Z"))), "2026-10-01T08:00:00.000Z");
confere("às 5h vira", iso(viradaDoExpedienteDaLoja(SP, new Date("2026-10-02T08:00:00Z"))), "2026-10-02T08:00:00.000Z");

console.log("\n— O relatório da loja: o dia sem hora é o expediente —");
const V = HORA_DE_VIRADA_DO_EXPEDIENTE * 3600_000;
const de = new Date(getStartOfDayUTC("2026-10-01", SP).getTime() + V);
const ate = new Date(getEndOfDayUTC("2026-10-01", SP).getTime() + V);
confere("01/10 começa às 5h de 01/10", iso(de), "2026-10-01T08:00:00.000Z");
confere("01/10 termina às 4h59 de 02/10", iso(ate), "2026-10-02T07:59:59.999Z");
confere("a entrega da 1h de 02/10 é do dia 01/10", entregaDa1h >= de && entregaDa1h <= ate, true);
const de2 = new Date(getStartOfDayUTC("2026-10-02", SP).getTime() + V);
confere("…e não do dia 02/10 (não conta duas vezes)", entregaDa1h >= de2, false);

console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
