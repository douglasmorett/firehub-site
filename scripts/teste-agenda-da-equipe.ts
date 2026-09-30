/**
 * Agenda da equipe: horários, vagas e o fuso (lib/crm/agenda.ts) e a chave do
 * telefone do contato (lib/crm/telefone.ts).
 *
 *   npx tsx scripts/teste-agenda-da-equipe.ts
 *
 * O pedido do Douglas (30/09/2026): "ver em cada dia se tem vaga para marcar
 * mais alguém na agenda daquele vendedor". A vaga é o horário da disponibilidade
 * sem reunião ativa por cima e que ainda não passou — em Brasília, com o
 * servidor em UTC.
 */
import {
  DISPONIBILIDADE_PADRAO, dataDaAgenda, diaDaSemana, horaDaAgenda, horariosDoDia, instanteDaAgenda,
  normalizarDisponibilidade, somarDias, sobrepoe, vagasDoDia,
} from "../src/lib/crm/agenda";
import { chaveDoTelefone, jidDoTelefone, linkDoWhatsApp, telefoneParaExibir } from "../src/lib/crm/telefone";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — veio ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`}`);
};

console.log("\n— Fuso: 9h em Brasília é 12h UTC —");
confere("instante de 02/10 09:00", instanteDaAgenda("2026-10-02", "09:00").toISOString(), "2026-10-02T12:00:00.000Z");
confere("hora de volta", horaDaAgenda(instanteDaAgenda("2026-10-02", "09:00")), "09:00");
confere("23:30 de Brasília ainda é o mesmo dia", dataDaAgenda(new Date("2026-10-03T02:30:00Z")), "2026-10-02");
confere("02/10/2026 é sexta", diaDaSemana("2026-10-02"), 5);
confere("somar dias vira o mês", somarDias("2026-09-30", 1), "2026-10-01");

console.log("\n— Horários do dia útil padrão: 9–12 e 14–18, 45 min + 15 —");
const sexta = horariosDoDia(DISPONIBILIDADE_PADRAO, "2026-10-02").map((h) => horaDaAgenda(h.inicio));
confere("sexta", sexta, ["09:00", "10:00", "11:00", "14:00", "15:00", "16:00", "17:00"]);
confere("sábado não tem", horariosDoDia(DISPONIBILIDADE_PADRAO, "2026-10-03").length, 0);
confere("11:00 termina 11:45", horaDaAgenda(horariosDoDia(DISPONIBILIDADE_PADRAO, "2026-10-02")[2].fim), "11:45");

console.log("\n— Vagas: reunião ativa ocupa, cancelada não, passado não é vaga —");
const agora = instanteDaAgenda("2026-10-02", "09:40");
const reunioes = [
  { inicio: instanteDaAgenda("2026-10-02", "14:00"), fim: instanteDaAgenda("2026-10-02", "14:45"), status: "MARCADA" },
  { inicio: instanteDaAgenda("2026-10-02", "15:00"), fim: instanteDaAgenda("2026-10-02", "15:45"), status: "CANCELADA" },
  // Reunião fora da grade (16:30–17:15) derruba os dois horários que ela cruza.
  { inicio: instanteDaAgenda("2026-10-02", "16:30"), fim: instanteDaAgenda("2026-10-02", "17:15"), status: "MARCADA" },
];
confere(
  "vagas às 9:40",
  vagasDoDia(DISPONIBILIDADE_PADRAO, "2026-10-02", reunioes, agora).map((h) => horaDaAgenda(h.inicio)),
  ["11:00", "15:00"],
);
confere("encostar não é sobrepor", sobrepoe(
  { inicio: instanteDaAgenda("2026-10-02", "10:00"), fim: instanteDaAgenda("2026-10-02", "10:45") },
  { inicio: instanteDaAgenda("2026-10-02", "10:45"), fim: instanteDaAgenda("2026-10-02", "11:30") },
), false);

console.log("\n— Disponibilidade vinda da tela —");
const lida = normalizarDisponibilidade({
  dias: { "1": [["13:00", "18:00"], ["08:00", "11:00"], ["19:00", "18:00"], "lixo"], "6": [["9:00", "12:00"]] },
  duracaoMin: 30,
  intervaloMin: 0,
});
confere("faixas em ordem, inválidas fora", lida.dias["1"], [["08:00", "11:00"], ["13:00", "18:00"]]);
confere("9:00 vira 09:00", lida.dias["6"], [["09:00", "12:00"]]);
confere("dia sem faixa fica vazio", lida.dias["3"], []);
confere("duração 30", lida.duracaoMin, 30);
confere("duração absurda cai no padrão", normalizarDisponibilidade({ duracaoMin: 5000 }).duracaoMin, 45);
confere("sem nada = padrão", normalizarDisponibilidade(null).dias["2"], DISPONIBILIDADE_PADRAO.dias["2"]);

console.log("\n— Telefone do contato: o mesmo número com e sem o nono dígito —");
confere("cadastro com 9", chaveDoTelefone("(22) 98111-8514"), "2281118514");
confere("jid sem o 9", chaveDoTelefone("552281118514@s.whatsapp.net".split("@")[0]), "2281118514");
confere("com +55 e 9", chaveDoTelefone("+55 22 98111-8514"), "2281118514");
confere("lixo", chaveDoTelefone("123"), null);
confere("estrangeiro fica cru", chaveDoTelefone("+1 415 555 2671"), "14155552671");
confere("exibir chave volta o 9", telefoneParaExibir("2281118514"), "(22) 98111-8514");
confere("exibir jid", telefoneParaExibir("5522981118514@s.whatsapp.net"), "(22) 98111-8514");
confere("fixo fica sem 9", telefoneParaExibir("2226431234"), "(22) 2643-1234");
confere("jid para envio", jidDoTelefone("(22) 98111-8514"), "5522981118514@s.whatsapp.net");
confere("wa.me da chave", linkDoWhatsApp("2281118514"), "https://wa.me/5522981118514");
confere("LID não tem wa.me", linkDoWhatsApp("123456789012345@lid"), null);

console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ tudo certo");
process.exit(falhas ? 1 : 0);
