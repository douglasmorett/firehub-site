/**
 * Prova do pedido agendado no site próprio (lib/agendamento.ts).
 *
 *   npx tsx scripts/teste-agendamento.ts
 *
 * O caso de origem é o do Pedro (Pizza Vedana): só encomenda, retirada no
 * sábado das 19h às 21h. E o de toda loja: horário de funcionamento,
 * antecedência mínima, dias à frente, pausa de férias e o fuso da loja.
 */
import {
  lerConfigDeAgendamento, horariosParaAgendar, conferirAgendamento, aceitaAgendamentoPara,
  instanteDaHoraLocal, textoDoAgendamento, aindaGuardado, rotuloDoDia,
} from "../src/lib/agendamento";
import { previsaoDaEntrega } from "../src/lib/previsao-da-entrega";
import { dataDoPedido } from "../src/lib/pedidos-na-cozinha";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

const SP = "America/Sao_Paulo";
// Domingo, 11/10/2026, 22:00 em Brasília (01:00 UTC de segunda).
const agora = new Date("2026-10-12T01:00:00Z");
const DIAS = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];
const horas18a23 = DIAS.map((day) => ({ day, open: "18:00", close: "23:00", active: true, shifts: [{ open: "18:00", close: "23:00" }] }));

// ── Leitura da configuração ──────────────────────────────────────────────────
confere("sem config nasce desligado", lerConfigDeAgendamento(null).ativo, false);
confere("lixo cai no padrão", lerConfigDeAgendamento({ antecedenciaMin: -5, intervaloMin: "x", dias: [9, 2, 2, "1"] }).antecedenciaMin, 60);
confere("dias: só 0–6, sem repetição, em ordem", lerConfigDeAgendamento({ dias: [9, 2, 2, "1"] }).dias, [1, 2]);
confere("entrega e retirada desligadas = as duas ligadas", (() => { const c = lerConfigDeAgendamento({ entrega: false, retirada: false }); return [c.entrega, c.retirada]; })(), [true, true]);
confere("hora inválida no PROPRIO cai no padrão", lerConfigDeAgendamento({ horario: "PROPRIO", de: "25:00" }).de, "18:00");

// ── Fuso ─────────────────────────────────────────────────────────────────────
confere("19:30 de Brasília = 22:30 UTC", instanteDaHoraLocal("2026-10-17", "19:30", SP)?.toISOString(), "2026-10-17T22:30:00.000Z");
confere("19:30 de Dourados (UTC−4) = 23:30 UTC", instanteDaHoraLocal("2026-10-17", "19:30", "America/Campo_Grande")?.toISOString(), "2026-10-17T23:30:00.000Z");
confere("texto do agendamento no relógio da loja", textoDoAgendamento("2026-10-17T22:30:00.000Z", SP), "sáb 17/10 às 19:30");
confere("rótulos Hoje/Amanhã/dia", [rotuloDoDia("2026-10-11", "2026-10-11"), rotuloDoDia("2026-10-12", "2026-10-11"), rotuloDoDia("2026-10-17", "2026-10-11")], ["Hoje", "Amanhã", "Sáb 17/10"]);

// ── O caso do Pedro: só sábado, 19h às 21h, retirada, encomenda ──────────────
const pedro = lerConfigDeAgendamento({
  ativo: true, entrega: false, retirada: true, dias: [5], horario: "PROPRIO", de: "19:00", ate: "21:00",
  antecedenciaMin: 1440, diasAFrente: 14, intervaloMin: 30, soAgendado: true,
});
const diasPedro = horariosParaAgendar({ config: pedro, storeHours: horas18a23, timezone: SP, agora });
confere("Pedro: só os sábados das próximas 2 semanas", diasPedro.map((d) => d.data), ["2026-10-17", "2026-10-24"]);
confere("Pedro: 19:00 a 20:30, de 30 em 30 (21h é o fim)", diasPedro[0].horarios.map((h) => h.hora), ["19:00", "19:30", "20:00", "20:30"]);
confere("Pedro: retirada aceita, entrega não", [aceitaAgendamentoPara(pedro, "PICKUP"), aceitaAgendamentoPara(pedro, "DELIVERY")], [true, false]);
confere("Pedro: servidor aceita sáb 19:30", conferirAgendamento({ config: pedro, deliveryType: "PICKUP", instante: "2026-10-17T22:30:00.000Z", storeHours: horas18a23, timezone: SP, agora }), null);
confere("Pedro: servidor recusa entrega", Boolean(conferirAgendamento({ config: pedro, deliveryType: "DELIVERY", instante: "2026-10-17T22:30:00.000Z", storeHours: horas18a23, timezone: SP, agora })), true);
confere("Pedro: servidor recusa sexta", Boolean(conferirAgendamento({ config: pedro, deliveryType: "PICKUP", instante: "2026-10-16T22:30:00.000Z", storeHours: horas18a23, timezone: SP, agora })), true);
confere("Pedro: servidor recusa 19:15 (fora do intervalo)", Boolean(conferirAgendamento({ config: pedro, deliveryType: "PICKUP", instante: "2026-10-17T22:15:00.000Z", storeHours: horas18a23, timezone: SP, agora })), true);

// ── Horário da loja + antecedência ──────────────────────────────────────────
const loja = lerConfigDeAgendamento({ ativo: true, antecedenciaMin: 60, diasAFrente: 1, intervaloMin: 30 });
// 21:30 de domingo: hoje sobra só 22:30 (antecedência de 1 h; 23:00 é o fechamento).
const as2130 = new Date("2026-10-12T00:30:00Z");
const diasLoja = horariosParaAgendar({ config: loja, storeHours: horas18a23, timezone: SP, agora: as2130 });
confere("hoje às 21:30 com 1 h: só 22:30", diasLoja[0], { data: "2026-10-11", rotulo: "Hoje", horarios: [{ hora: "22:30", iso: "2026-10-12T01:30:00.000Z" }] });
confere("amanhã: 18:00 a 22:30", [diasLoja[1].rotulo, diasLoja[1].horarios[0].hora, diasLoja[1].horarios.at(-1)?.hora, diasLoja[1].horarios.length], ["Amanhã", "18:00", "22:30", 10]);
confere("servidor recusa horário sem a antecedência", conferirAgendamento({ config: loja, deliveryType: "DELIVERY", instante: "2026-10-12T00:45:00.000Z", storeHours: horas18a23, timezone: SP, agora: as2130 })?.startsWith("Esse horário já não dá"), true);
confere("desligado: nenhum horário", horariosParaAgendar({ config: { ...loja, ativo: false }, storeHours: horas18a23, timezone: SP, agora }), []);

// Dia fechado no funcionamento não aparece; turno que vira a noite vai até 23:59.
const horasComFolga = horas18a23.map((d, i) => (i === 0 ? { ...d, active: false } : i === 1 ? { ...d, shifts: [{ open: "22:00", close: "02:00" }] } : d));
const semSegunda = horariosParaAgendar({ config: lerConfigDeAgendamento({ ativo: true, antecedenciaMin: 0, diasAFrente: 2, intervaloMin: 60 }), storeHours: horasComFolga, timezone: SP, agora });
confere("domingo 22:00; segunda fechada some; terça 22h–02h dá 22:00 e 23:00", semSegunda.map((d) => [d.data, d.horarios.map((h) => h.hora)]), [["2026-10-11", ["22:00"]], ["2026-10-13", ["22:00", "23:00"]]]);

// Pausa de férias tira os dias dela.
const comPausa = horariosParaAgendar({ config: lerConfigDeAgendamento({ ativo: true, antecedenciaMin: 0, diasAFrente: 3 }), storeHours: horas18a23, storePause: { active: true, from: "2026-10-12", to: "2026-10-13" }, timezone: SP, agora });
confere("férias de 12 a 13/10 tiram os dois dias", comPausa.map((d) => d.data), ["2026-10-11", "2026-10-14"]);

// ── Quando o pedido sai de Agendamentos ─────────────────────────────────────
confere("guardado: falta mais que a liberação", aindaGuardado({ agendado: true, scheduledDatetime: "2026-10-12T03:00:00Z" }, 60, agora), true);
confere("liberado: falta menos que a liberação", aindaGuardado({ agendado: true, scheduledDatetime: "2026-10-12T01:30:00Z" }, 60, agora), false);
confere("pedido normal nunca fica guardado", aindaGuardado({ agendado: false, scheduledDatetime: "2026-10-20T03:00:00Z" }, 60, agora), false);

// ── A marca `agendado` vale com qualquer folga (antes: só acima de 3 h) ────
const daqui1h = { createdAt: "2026-10-11T21:00:00Z", scheduledDatetime: "2026-10-11T22:00:00Z", deliveryType: "PICKUP" };
confere("comanda: parceiro com 1 h de folga = RETIRADA", previsaoDaEntrega(daqui1h)?.tipo, "RETIRADA");
confere("comanda: agendado no site com 1 h = AGENDADO", previsaoDaEntrega({ ...daqui1h, agendado: true })?.tipo, "AGENDADO");
confere("quadro: parceiro com 1 h fica no dia da criação", dataDoPedido(daqui1h).toISOString(), "2026-10-11T21:00:00.000Z");
confere("quadro: agendado no site vai para a hora marcada", dataDoPedido({ ...daqui1h, agendado: true }).toISOString(), "2026-10-11T22:00:00.000Z");

console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
