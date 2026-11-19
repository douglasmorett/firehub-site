/**
 * Prova de "com quanto tempo o pedido agendado entra na cozinha" (lib/agendamento.ts).
 *
 *   npx tsx scripts/teste-agendado-entra-na-cozinha.ts
 *
 * Caso de origem: Vania (pizzaria Bom cheff, 19/11/2026). Pedido de balcão
 * "para levar", cliente busca às 20:15, feito às 19:10 — caiu no KDS na hora e
 * a cozinha não tinha como segurar. A regra (`aindaGuardado`) é a mesma que o
 * KDS (api/kds) e o painel (Pedidos › Agendamentos) usam.
 */
import {
  aindaGuardado, ehAgendadoDeVerdade, instanteDoHorarioDoBalcao, lerConfigDeAgendamento,
  marcaDoAgendamento, OPCOES_DE_LIBERACAO,
} from "../src/lib/agendamento";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

const SP = "America/Sao_Paulo";
// Quinta, 19/11/2026. 19:10 em Brasília = 22:10 UTC.
const criado = new Date("2026-11-19T22:10:36Z");
const buscar2015 = new Date("2026-11-19T23:15:00Z");
const pedidoDaVania = { agendado: true, scheduledDatetime: buscar2015, createdAt: criado };
const em = (hhmm: string) => new Date(`2026-11-19T${String(Number(hhmm.slice(0, 2)) + 3).padStart(2, "0")}:${hhmm.slice(3)}:00Z`);

// ── O pedido agendado fora da janela NÃO aparece na cozinha ─────────────────
confere("40 min: às 19:10 (65 min antes) fica fora do KDS", aindaGuardado(pedidoDaVania, 40, criado), true);
confere("40 min: às 19:34 (41 min antes) ainda fora", aindaGuardado(pedidoDaVania, 40, em("19:34")), true);
// ── Dentro da janela aparece ─────────────────────────────────────────────────
confere("40 min: às 19:35 (40 min antes) entra", aindaGuardado(pedidoDaVania, 40, em("19:35")), false);
confere("40 min: às 20:00 entra", aindaGuardado(pedidoDaVania, 40, em("20:00")), false);
confere("40 min: passou do horário, continua na cozinha", aindaGuardado(pedidoDaVania, 40, em("20:30")), false);
confere("60 min (padrão): às 19:10 (65 min antes) fica fora", aindaGuardado(pedidoDaVania, 60, criado), true);
confere("60 min: às 19:15 entra", aindaGuardado(pedidoDaVania, 60, em("19:15")), false);
// ── X = 0: entra na hora em que é feito (o comportamento antigo) ─────────────
confere("0: aparece na cozinha na hora", aindaGuardado(pedidoDaVania, 0, criado), false);
confere("0: encomenda para amanhã também aparece na hora", aindaGuardado({ agendado: true, scheduledDatetime: "2026-11-20T23:00:00Z", createdAt: criado }, 0, criado), false);
confere("0 é opção da tela", OPCOES_DE_LIBERACAO.includes(0), true);
confere("0 gravado é lido como 0 (não cai no padrão)", lerConfigDeAgendamento({ liberarAntesMin: 0 }).liberarAntesMin, 0);
confere("sem config: 60 min (o padrão de sempre)", lerConfigDeAgendamento(null).liberarAntesMin, 60);
confere("40 gravado vale com o agendamento do site desligado", lerConfigDeAgendamento({ ativo: false, liberarAntesMin: 40 }).liberarAntesMin, 40);

// ── Pedido normal não muda ───────────────────────────────────────────────────
confere("pedido sem horário nunca fica guardado", aindaGuardado({ agendado: false, scheduledDatetime: null, createdAt: criado }, 40, criado), false);
// iFood/99 gravam o PRAZO em scheduledDatetime em todo pedido: 50 min de folga é prazo, não agendamento.
const prazoDoIfood = { agendado: false, scheduledDatetime: new Date(criado.getTime() + 50 * 60_000), createdAt: criado };
confere("prazo do parceiro (50 min) não é agendado", ehAgendadoDeVerdade(prazoDoIfood), false);
confere("prazo do parceiro entra na cozinha na hora", aindaGuardado(prazoDoIfood, 40, criado), false);
confere("prazo do parceiro sem createdAt: também não", aindaGuardado({ agendado: false, scheduledDatetime: prazoDoIfood.scheduledDatetime }, 40, criado), false);

// ── iFood agendado (folga > 3 h, sem a marca `agendado`) ─────────────────────
const ifoodAgendado = { agendado: false, scheduledDatetime: new Date("2026-11-20T15:00:00Z"), createdAt: criado }; // amanhã 12:00
confere("iFood para amanhã 12:00 é agendado de verdade", ehAgendadoDeVerdade(ifoodAgendado), true);
confere("iFood agendado: hoje fica fora do KDS", aindaGuardado(ifoodAgendado, 40, criado), true);
confere("iFood agendado: amanhã 11:20 entra", aindaGuardado(ifoodAgendado, 40, new Date("2026-11-20T14:20:00Z")), false);

// ── "Buscar às" do balcão → o instante no relógio da loja ────────────────────
confere("20:15 digitado às 19:10 = hoje 20:15", instanteDoHorarioDoBalcao("20:15", SP, criado)?.toISOString(), buscar2015.toISOString());
confere("00:30 digitado às 23:30 = amanhã 00:30", instanteDoHorarioDoBalcao("00:30", SP, new Date("2026-11-20T02:30:00Z"))?.toISOString(), "2026-11-20T03:30:00.000Z");
confere("hora que já passou (19:05 às 19:10) = pedido para agora", instanteDoHorarioDoBalcao("19:05", SP, criado), null);
confere("vazio = pedido para agora", instanteDoHorarioDoBalcao("", SP, criado), null);
confere("lixo = pedido para agora", instanteDoHorarioDoBalcao("25:99", SP, criado), null);
confere("fuso da loja (Campo Grande, UTC−4): 20:15 = 00:15 UTC", instanteDoHorarioDoBalcao("20:15", "America/Campo_Grande", criado)?.toISOString(), "2026-11-20T00:15:00.000Z");
confere("marca na comanda", marcaDoAgendamento(buscar2015, SP), "[📅 AGENDADO para qui 19/11 às 20:15]");

console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
