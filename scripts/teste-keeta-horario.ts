/**
 * scripts/teste-keeta-horario.ts — o horário do FireHub vira o weekHours da Keeta.
 *
 *   npx tsx scripts/teste-keeta-horario.ts
 *
 * A Keeta quer UTC+0, fim > início e nada passando da meia-noite
 * (lib/keeta/loja-na-keeta.ts). Brasília é UTC-3: 18h–23h local = 21h–02h UTC.
 */
import { horarioParaKeeta, deslocamentoDoFuso } from "../src/lib/keeta/loja-na-keeta";

let falhas = 0;
function confere(nome: string, obtido: unknown, esperado: unknown) {
  const a = JSON.stringify(obtido);
  const b = JSON.stringify(esperado);
  if (a === b) console.log(`✅ ${nome}`);
  else {
    falhas++;
    console.log(`❌ ${nome}\n   esperado: ${b}\n   obtido:   ${a}`);
  }
}

const TODOS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];
const dia = (open: string, close: string, active = true) => ({ active, open, close, shifts: [{ open, close }] });

confere("Brasília está 180 min atrás do UTC", deslocamentoDoFuso("America/Sao_Paulo", new Date("2026-10-31T15:00:00Z")), -180);

confere(
  "18h–23h todo dia em Brasília: 21h–23h59 UTC e 00h–02h UTC do dia seguinte",
  horarioParaKeeta(Array.from({ length: 7 }, () => dia("18:00", "23:00")), -180),
  [
    { dayOfWeek: TODOS, timePeriods: { startTime: "21:00:00.000Z", endTime: "23:59:00.000Z" } },
    { dayOfWeek: TODOS, timePeriods: { startTime: "00:00:00.000Z", endTime: "02:00:00.000Z" } },
  ],
);

confere(
  "só segunda 18h–02h (vira a noite): segunda 21h–24h, terça 00h–05h UTC",
  horarioParaKeeta([dia("18:00", "02:00"), ...Array.from({ length: 6 }, () => dia("18:00", "23:00", false))], -180),
  [
    { dayOfWeek: ["MONDAY"], timePeriods: { startTime: "21:00:00.000Z", endTime: "23:59:00.000Z" } },
    { dayOfWeek: ["TUESDAY"], timePeriods: { startTime: "00:00:00.000Z", endTime: "05:00:00.000Z" } },
  ],
);

confere(
  "domingo 22h–23h30 local cai na segunda em UTC (domingo vira segunda)",
  horarioParaKeeta([...Array.from({ length: 6 }, () => dia("18:00", "23:00", false)), dia("22:00", "23:30")], -180),
  [{ dayOfWeek: ["MONDAY"], timePeriods: { startTime: "01:00:00.000Z", endTime: "02:30:00.000Z" } }],
);

confere("tudo fechado: nada a mandar", horarioParaKeeta(Array.from({ length: 7 }, () => dia("18:00", "23:00", false)), -180), []);

console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
