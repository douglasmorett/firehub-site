/**
 * A LOJA ABRE E FECHA SOZINHA NO HORÁRIO — E O DONO SABE QUANDO NÃO ABRIU.
 *
 * Caso de 25/09/2026: a Hakim Centro (17:30–23:30) passou a noite com o "Site
 * aberto" desligado porque ninguém ligou o interruptor; site e robô recusaram
 * pedido a noite inteira. Este harness prova as decisões de
 * lib/abertura-da-loja.ts e o turno de lib/loja-aberta.ts:
 *
 *   - abre UMA vez por turno e fecha UMA vez depois dele (quem fecha no meio
 *     do turno continua fechado);
 *   - avisa loja fechada e caixa fechado 15 min depois de abrir, uma vez;
 *   - avisa iFood fechado só na segunda consulta, uma vez por fechamento, e
 *     "não sei" não é "fechado".
 *
 *   node scripts/teste-abertura-da-loja.js
 */
const path = require("path");
const createJiti = require("jiti");
const jiti = createJiti(__filename, {
  alias: { "@": path.resolve(__dirname, "..", "src") },
  interopDefault: true,
  esmResolve: true,
});
const { turnoAgora } = jiti(path.resolve(__dirname, "..", "src", "lib", "loja-aberta.ts"));
const A = jiti(path.resolve(__dirname, "..", "src", "lib", "abertura-da-loja.ts"));

let ok = 0;
let falhou = 0;
function conferir(nome, real, esperado) {
  const igual = JSON.stringify(real) === JSON.stringify(esperado);
  if (igual) { ok++; console.log(`  ok    ${nome}`); }
  else { falhou++; console.log(`  FALHOU ${nome}\n         esperado: ${JSON.stringify(esperado)}\n         veio:     ${JSON.stringify(real)}`); }
}

const SP = "America/Sao_Paulo";
const turnoTodoDia = (open, close) =>
  ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"].map((day) => ({ day, open, close, active: true, shifts: [{ open, close }] }));
const hakim = turnoTodoDia("17:30", "23:30");
const em = (iso) => new Date(`${iso}-03:00`);

// ── O TURNO ────────────────────────────────────────────────────────────────
console.log("\nturno");
conferir("17:29 ainda fora", turnoAgora(hakim, SP, em("2026-09-25T17:29:00")), null);
const t1800 = turnoAgora(hakim, SP, em("2026-09-25T18:00:00"));
conferir("18:00 dentro, chave do dia", [t1800.chave, t1800.minutosDesdeAbertura, t1800.minutosAteFechar], ["2026-09-25@17:30", 30, 330]);
conferir("23:30 ainda dentro (mesma borda do estadoDaLoja)", turnoAgora(hakim, SP, em("2026-09-25T23:30:00"))?.chave, "2026-09-25@17:30");
conferir("23:31 fora", turnoAgora(hakim, SP, em("2026-09-25T23:31:00")), null);
const madrugada = turnoTodoDia("18:00", "02:00");
const t0030 = turnoAgora(madrugada, SP, em("2026-09-26T00:30:00"));
conferir("18h–02h: à 00:30 o turno é o de ONTEM", [t0030.chave, t0030.minutosDesdeAbertura, t0030.minutosAteFechar], ["2026-09-25@18:00", 390, 90]);
const t2300 = turnoAgora(madrugada, SP, em("2026-09-25T23:00:00"));
conferir("18h–02h: às 23:00 faltam 180 min", [t2300.chave, t2300.minutosAteFechar], ["2026-09-25@18:00", 180]);
const fechadoDomingo = hakim.map((d) => (d.day === "Domingo" ? { ...d, active: false } : d));
conferir("dia desativado não tem turno", turnoAgora(fechadoDomingo, SP, em("2026-09-27T19:00:00")), null);

// ── ABRE E FECHA ───────────────────────────────────────────────────────────
console.log("\nabertura automática");
let estado = {};
let d = A.decidirAbertura({ turno: null, storeOpen: false, emPausa: false, estado });
conferir("antes do turno: não mexe", [d.storeOpen, d.acao], [undefined, null]);
d = A.decidirAbertura({ turno: t1800, storeOpen: false, emPausa: false, estado });
conferir("turno começou, loja fechada: ABRE", [d.storeOpen, d.acao, d.estado.abriu], [true, "abriu", "2026-09-25@17:30"]);
estado = d.estado;
d = A.decidirAbertura({ turno: t1800, storeOpen: false, emPausa: false, estado });
conferir("atendente fechou no meio do turno: continua fechada", [d.storeOpen, d.acao], [undefined, null]);
d = A.decidirAbertura({ turno: null, storeOpen: true, emPausa: false, estado });
conferir("turno acabou: FECHA", [d.storeOpen, d.acao, d.estado.fechou], [false, "fechou", "2026-09-25@17:30"]);
estado = d.estado;
d = A.decidirAbertura({ turno: null, storeOpen: true, emPausa: false, estado });
conferir("reaberta à mão depois do turno: não fecha de novo", [d.storeOpen, d.acao], [undefined, null]);
d = A.decidirAbertura({ turno: t1800, storeOpen: true, emPausa: false, estado: {} });
conferir("turno começou com a loja já aberta: só carimba", [d.storeOpen, d.acao, d.estado.abriu], [undefined, null, "2026-09-25@17:30"]);
d = A.decidirAbertura({ turno: t1800, storeOpen: false, emPausa: true, estado: {} });
conferir("pausa programada (férias): não abre nem carimba", [d.storeOpen, d.estado.abriu], [undefined, undefined]);
d = A.decidirAbertura({ turno: null, storeOpen: true, emPausa: false, estado: {} });
conferir("ligada fora do turno, nunca abriu: não fecha", [d.storeOpen, d.acao], [undefined, null]);

// ── AVISOS: LOJA E CAIXA ───────────────────────────────────────────────────
console.log("\navisos da loja e do caixa");
const ms = (iso) => em(iso).getTime();
const t1740 = turnoAgora(hakim, SP, em("2026-09-25T17:40:00"));
let r = A.avisosDevidos({ turno: turnoAgora(hakim, SP, em("2026-09-25T17:30:00")), agora: ms("2026-09-25T17:30:00"), storeOpen: false, emPausa: false, caixaAberto: false, estado: {} });
conferir("17:30 fechada: marca desde quando, sem aviso (carência)", [r.devidos, r.estado.fechadaDesde], [[], ms("2026-09-25T17:30:00")]);
estado = r.estado;
r = A.avisosDevidos({ turno: t1740, agora: ms("2026-09-25T17:40:00"), storeOpen: false, emPausa: false, caixaAberto: false, estado });
conferir("17:40: ainda na carência de 15 min", r.devidos, []);
const t1745 = turnoAgora(hakim, SP, em("2026-09-25T17:45:00"));
r = A.avisosDevidos({ turno: t1745, agora: ms("2026-09-25T17:45:00"), storeOpen: false, emPausa: false, caixaAberto: false, estado });
conferir("17:45 fechada e sem caixa: os dois avisos", r.devidos, ["lojaFechada", "caixa"]);
estado = A.marcarAviso(r.estado, "lojaFechada", t1745, true, ms("2026-09-25T17:45:00"));
estado = A.marcarAviso(estado, "caixa", t1745, false, ms("2026-09-25T17:45:00"));
r = A.avisosDevidos({ turno: t1745, agora: ms("2026-09-25T17:46:00"), storeOpen: false, emPausa: false, caixaAberto: false, estado });
conferir("17:46: loja já avisada; caixa falhou há 1 min, espera", r.devidos, []);
r = A.avisosDevidos({ turno: t1745, agora: ms("2026-09-25T17:56:00"), storeOpen: false, emPausa: false, caixaAberto: false, estado });
conferir("17:56: o do caixa tenta de novo", r.devidos, ["caixa"]);
r = A.avisosDevidos({ turno: t1745, agora: ms("2026-09-25T18:00:00"), storeOpen: true, emPausa: false, caixaAberto: true, estado });
conferir("abriu tudo: nada devido e o 'fechada desde' some", [r.devidos, r.estado.fechadaDesde], [[], undefined]);
r = A.avisosDevidos({ turno: t1745, agora: ms("2026-09-25T17:45:00"), storeOpen: true, emPausa: false, caixaAberto: false, estado: {} });
conferir("loja aberta e caixa fechado: só o do caixa", r.devidos, ["caixa"]);
r = A.avisosDevidos({ turno: t1745, agora: ms("2026-09-25T17:45:00"), storeOpen: false, emPausa: true, caixaAberto: true, estado: { fechadaDesde: ms("2026-09-25T17:30:00") } });
conferir("pausa programada não é 'devia estar aberta'", r.devidos, []);
// Fechou no meio do turno: só depois de 10 min fechada.
let meio = A.avisosDevidos({ turno: turnoAgora(hakim, SP, em("2026-09-25T20:00:00")), agora: ms("2026-09-25T20:00:00"), storeOpen: false, emPausa: false, caixaAberto: true, estado: {} });
conferir("fechou às 20:00: ainda não avisa", meio.devidos, []);
meio = A.avisosDevidos({ turno: turnoAgora(hakim, SP, em("2026-09-25T20:10:00")), agora: ms("2026-09-25T20:10:00"), storeOpen: false, emPausa: false, caixaAberto: true, estado: meio.estado });
conferir("fechada há 10 min: avisa", meio.devidos, ["lojaFechada"]);
r = A.avisosDevidos({ turno: turnoAgora(hakim, SP, em("2026-09-25T23:25:00")), agora: ms("2026-09-25T23:25:00"), storeOpen: false, emPausa: false, caixaAberto: false, estado: { fechadaDesde: ms("2026-09-25T22:00:00") } });
conferir("nos últimos 10 min do turno: não avisa", r.devidos, []);
const amanha = turnoAgora(hakim, SP, em("2026-09-26T17:45:00"));
r = A.avisosDevidos({ turno: amanha, agora: ms("2026-09-26T17:45:00"), storeOpen: false, emPausa: false, caixaAberto: true, estado: A.marcarAviso({ fechadaDesde: ms("2026-09-26T17:30:00") }, "lojaFechada", t1745, true, 0) });
conferir("aviso de ontem não segura o de hoje", r.devidos, ["lojaFechada"]);

// ── AVISO DO IFOOD ─────────────────────────────────────────────────────────
console.log("\niFood");
conferir("fora do turno: não consulta", A.consultarIfoodAgora(null, undefined, 0), false);
conferir("na carência: não consulta", A.consultarIfoodAgora(t1740, undefined, ms("2026-09-25T17:40:00")), false);
conferir("dentro: consulta", A.consultarIfoodAgora(t1800, undefined, ms("2026-09-25T18:00:00")), true);
conferir("consultou há 1 min: espera", A.consultarIfoodAgora(t1800, { consultadoEm: ms("2026-09-25T17:59:00") }, ms("2026-09-25T18:00:00")), false);
let f = A.decidirIfood({ aberta: false, agora: ms("2026-09-25T18:00:00"), registro: undefined });
conferir("primeira consulta fechada: ainda não avisa", [f.avisar, f.registro.fechadoDesde], [false, ms("2026-09-25T18:00:00")]);
f = A.decidirIfood({ aberta: false, agora: ms("2026-09-25T18:05:00"), registro: f.registro });
conferir("segunda consulta fechada: AVISA", f.avisar, true);
f.registro.avisadoDesde = f.registro.fechadoDesde;
f = A.decidirIfood({ aberta: false, agora: ms("2026-09-25T18:10:00"), registro: f.registro });
conferir("mesmo fechamento: não repete", f.avisar, false);
const semSaber = A.decidirIfood({ aberta: null, agora: ms("2026-09-25T18:15:00"), registro: f.registro });
conferir("iFood não respondeu: nada muda", [semSaber.avisar, semSaber.registro], [false, f.registro]);
f = A.decidirIfood({ aberta: true, agora: ms("2026-09-25T18:20:00"), registro: f.registro });
conferir("reabriu: zera", [f.avisar, f.registro.fechadoDesde, f.registro.avisadoDesde], [false, undefined, undefined]);
f = A.decidirIfood({ aberta: false, agora: ms("2026-09-25T20:00:00"), registro: f.registro });
f = A.decidirIfood({ aberta: false, agora: ms("2026-09-25T20:05:00"), registro: f.registro });
conferir("fechou de novo mais tarde: avisa de novo", f.avisar, true);
conferir("fora do turno o registro do iFood some", A.limparIfoodForaDoTurno({ abriu: "x", ifood: { m: { fechadoDesde: 1 } } }), { abriu: "x" });

// ── LEITURA DO STATUS DO IFOOD ─────────────────────────────────────────────
console.log("\nstatus do iFood");
const { lerStatusDoMerchant } = jiti(path.resolve(__dirname, "..", "src", "lib", "ifood-disponibilidade.ts"));
conferir("available true = aberta", lerStatusDoMerchant([{ operation: "DELIVERY", available: true, state: "OK" }]), { aberta: true, motivo: null });
conferir(
  "fechada com o motivo do iFood",
  lerStatusDoMerchant([{ available: false, state: "CLOSED", message: { title: "Loja fechada", subtitle: "Fora do horário de funcionamento" } }]),
  { aberta: false, motivo: "Loja fechada — Fora do horário de funcionamento" },
);
conferir("resposta estranha = não sei", lerStatusDoMerchant({ error: "x" }), null);

console.log(`\n${ok} ok, ${falhou} falharam\n`);
process.exit(falhou > 0 ? 1 : 0);
