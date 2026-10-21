import { horarioPedeGps } from "../src/lib/app-motoboy/gps-no-horario";
const turno = { open: "17:30", close: "23:30" };
const dia = (d: string, active = true) => ({ day: d, open: "17:30", close: "23:30", active, shifts: [turno] });
const horas = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"].map((d) => dia(d, d !== "Segunda"));
const loja = { storeHours: horas, storePause: null, storeTimezone: "America/Sao_Paulo" };
// 21/10/2026 é quarta; 26/10 é segunda. Horas em -03:00.
const casos: [string, boolean][] = [
  ["2026-10-21T12:00:00-03:00", false],
  ["2026-10-21T16:55:00-03:00", false],
  ["2026-10-21T17:05:00-03:00", true],
  ["2026-10-21T20:00:00-03:00", true],
  ["2026-10-21T23:55:00-03:00", true],
  ["2026-10-22T00:05:00-03:00", false],
  ["2026-10-22T03:00:00-03:00", false],
  ["2026-10-26T20:00:00-03:00", false],
];
let falhas = 0;
for (const [quando, esperado] of casos) {
  const r = horarioPedeGps(loja, new Date(quando));
  if (r !== esperado) falhas++;
  console.log(r === esperado ? "✅" : "❌", quando, "→", r ? "liga" : "desliga");
}
const semHorario = horarioPedeGps({ storeHours: null, storePause: null, storeTimezone: null }, new Date("2026-10-21T12:00:00-03:00"));
console.log(semHorario ? "✅" : "❌", "loja sem horário → liga");
if (!semHorario) falhas++;
process.exit(falhas ? 1 : 0);
