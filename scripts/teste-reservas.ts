/**
 * Trava o módulo Reservas de mesa: a regra de disponibilidade (lib/reservas/regras.ts),
 * o que o robô lê e escreve (lib/reservas/robo.ts) e a cobrança do mês.
 *   npx tsx scripts/teste-reservas.ts
 * Sem banco e sem IA: tudo puro.
 */
import {
  CONFIG_PADRAO, avaliarReserva, disponibilidadeDoDia, horariosDoDia, lerConfig, minutos, normalizarHora, numerosDasReservas,
  picoNoIntervalo, sugerirHorarios, diaDaSemana, somarDias,
  type ConfigDasReservas, type ReservaParaConta, type ReservaParaNumeros,
} from "../src/lib/reservas/regras";
import {
  REGRA_DA_RESERVA_COM_MODULO, avisoDeReservaAoDono, blocoDasReservasNaConversa, blocoDasReservasNoSistema, confirmacaoParaOCliente,
  extrairMarcasDeReserva, perguntaDoQueFalta, respostaDeNaoCabe, semFichaDeReserva,
} from "../src/lib/reservas/robo";
import { valorDasReservasNoMes } from "../src/lib/reservas/assinatura";
import { lerRespostasProntas, blocoDasRespostasProntas, regraDaReservaPelaFicha } from "../src/lib/respostas-prontas";
import { regrasDoRobo } from "../src/lib/regras-do-robo";
import { RESPOSTAS } from "./respostas-prontas-pizzaria-17";

let falhas = 0;
const confere = (oQue: string, ok: boolean, obtido?: unknown) => {
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}`}`);
};

// Sábado, 21/11/2026. "Agora" = quinta 19/11 às 15:00.
const SAB = "2026-11-21";
const agora = { data: "2026-11-19", minutos: 15 * 60 };
confere("21/11/2026 é sábado (Segunda = 0)", diaDaSemana(SAB) === 5, diaDaSemana(SAB));

const config: ConfigDasReservas = {
  ...CONFIG_PADRAO,
  dias: CONFIG_PADRAO.dias.map((d, i) => (i === 5 ? { ativo: true, faixas: [{ de: "18:00", ate: "22:00" }] } : i === 0 ? { ativo: false, faixas: [] } : d)),
  intervaloMin: 30, duracaoMin: 120, maxReservasSimultaneas: 3, maxPessoasSimultaneas: null,
  antecedenciaMinimaMin: 60, maxPessoasPorReserva: 12, diasNoFuturo: 30,
};
const r = (hora: string, pessoas = 4, status: ReservaParaConta["status"] = "CONFIRMADA", id?: string): ReservaParaConta => ({ id, hora, pessoas, status });

// ── Hora ──
confere("hora: '19h' → 19:00, '19h30' → 19:30, '8:5' inválida", normalizarHora("19h") === "19:00" && normalizarHora("19h30") === "19:30" && normalizarHora("8:5") === null);
confere("minutos('20:30') = 1230", minutos("20:30") === 1230);

// ── Horários do dia ──
const grade = horariosDoDia(config, SAB);
confere("sábado 18:00–22:00 de 30 em 30 = 9 horários", grade.length === 9 && grade[0] === "18:00" && grade[8] === "22:00", grade);
confere("segunda sem reserva = nenhum horário", horariosDoDia(config, "2026-11-23").length === 0);

// ── Simultâneas considerando a duração ──
const cheio = [r("19:00"), r("19:30"), r("20:00")];
confere("3 reservas entre 19:00 e 20:00 com 2h: pico às 20:00 = 3", picoNoIntervalo(cheio, minutos("20:00"), 120).reservas === 3);
const a2030 = avaliarReserva(config, cheio, { data: SAB, hora: "20:30", pessoas: 2 }, agora);
confere("20:30 lotado: a das 19:00 ainda está na mesa (até 21:00)", !a2030.ok && a2030.motivo === "lotado", a2030);
const a2100 = avaliarReserva(config, cheio, { data: SAB, hora: "21:00", pessoas: 2 }, agora);
confere("21:00 cabe: a das 19:00 saiu às 21:00", a2100.ok, a2100);
const a1830 = avaliarReserva(config, cheio, { data: SAB, hora: "18:30", pessoas: 2 }, agora);
confere("18:30 NÃO cabe: às 20:00 (ainda na mesa) encontra as 3 — pico dentro do intervalo", !a1830.ok && a1830.motivo === "lotado", a1830);
confere("18:00 cabe: sai às 20:00, quando a das 20:00 chega", avaliarReserva(config, cheio, { data: SAB, hora: "18:00", pessoas: 2 }, agora).ok);
const a1700 = avaliarReserva(config, [r("19:00"), r("19:30")], { data: SAB, hora: "18:00", pessoas: 2 }, agora);
confere("18:00 cabe com só 2 reservas depois", a1700.ok, a1700);
confere("cancelada e 'não veio' liberam o lugar",
  avaliarReserva(config, [r("19:00", 4, "CANCELADA"), r("19:30", 4, "NAO_VEIO"), r("20:00")], { data: SAB, hora: "20:00", pessoas: 2 }, agora).ok);
confere("mover a própria reserva não conta ela mesma (ignorarId)",
  avaliarReserva(config, [r("19:00", 4, "CONFIRMADA", "a"), r("19:30"), r("20:00")], { data: SAB, hora: "19:30", pessoas: 4, ignorarId: "a" }, agora).ok);

// ── Pessoas ao mesmo tempo ──
const porPessoas = { ...config, maxReservasSimultaneas: 50, maxPessoasSimultaneas: 20 };
const p = avaliarReserva(porPessoas, [r("19:00", 10), r("19:30", 8)], { data: SAB, hora: "20:00", pessoas: 4 }, agora);
confere("limite de 20 pessoas: 10+8+4 = 22 não cabe", !p.ok && p.motivo === "lotado_pessoas", p);
confere("limite de 20 pessoas: 10+8+2 = 20 cabe", avaliarReserva(porPessoas, [r("19:00", 10), r("19:30", 8)], { data: SAB, hora: "20:00", pessoas: 2 }, agora).ok);

// ── Recusas por regra ──
const motivo = (pedido: { data: string; hora: string; pessoas: number }, ag = agora) => {
  const x = avaliarReserva(config, [], pedido, ag);
  return x.ok ? "ok" : x.motivo;
};
confere("grupo de 15 (máx 12) = grupo_grande", motivo({ data: SAB, hora: "20:00", pessoas: 15 }) === "grupo_grande");
confere("segunda = dia_sem_reserva", motivo({ data: "2026-11-23", hora: "20:00", pessoas: 2 }) === "dia_sem_reserva");
confere("sábado 23:00 = fora_do_horario", motivo({ data: SAB, hora: "23:00", pessoas: 2 }) === "fora_do_horario");
confere("19:45 (fora da grade, dentro da faixa) vale", motivo({ data: SAB, hora: "19:45", pessoas: 2 }) === "ok");
confere("ontem = passou", motivo({ data: "2026-11-18", hora: "20:00", pessoas: 2 }) === "passou");
confere("sábado 18:00 visto às 17:30 do sábado = antecedencia (mín. 1h)", motivo({ data: SAB, hora: "18:00", pessoas: 2 }, { data: SAB, minutos: 17 * 60 + 30 }) === "antecedencia");
confere("daqui a 40 dias = longe_demais", motivo({ data: somarDias(agora.data, 40), hora: "20:00", pessoas: 2 }) === "longe_demais");
confere("0 pessoas = pessoas_invalidas", motivo({ data: SAB, hora: "20:00", pessoas: 0 }) === "pessoas_invalidas");

// ── Sugestões quando lotado ──
const sab = cheio;
const sug = sugerirHorarios(config, (d) => (d === SAB ? sab : []), { data: SAB, hora: "20:00", pessoas: 2 }, agora, 3);
confere("lotado às 20:00: sugere o mais perto livre no mesmo dia (21:00, 21:30…)", sug[0]?.data === SAB && sug[0]?.hora === "21:00", sug);
const tudoCheio = horariosDoDia(config, SAB).map((h) => r(h, 2));
const tudoCheio3 = [...tudoCheio, ...tudoCheio, ...tudoCheio];
const sug2 = sugerirHorarios(config, (d) => (d === SAB ? tudoCheio3 : []), { data: SAB, hora: "20:00", pessoas: 2 }, agora, 3);
confere("sábado inteiro lotado: sugere domingo (o horário mais perto das 20:00)", sug2[0]?.data === "2026-11-22" && sug2[0]?.hora === "20:00", sug2);

// ── Linha do tempo ──
const dia = disponibilidadeDoDia(config, cheio, SAB, agora);
const h2000 = dia.find((h) => h.hora === "20:00")!;
confere("linha do tempo: 20:00 com 3/3 ocupadas e não livre", h2000.ocupacao.reservas === 3 && !h2000.livre && h2000.capacidade.reservas === 3, h2000);
confere("linha do tempo: 21:30 livre (só a das 20:00 na mesa)", dia.find((h) => h.hora === "21:30")!.livre && dia.find((h) => h.hora === "21:30")!.ocupacao.reservas === 1);

// ── Configuração torta não derruba ──
const torta = lerConfig({ dias: "x", duracaoMin: -5, maxReservasSimultaneas: "abc", intervaloMin: 7, maxPessoasSimultaneas: 0 });
confere("config torta volta ao padrão (duração mínima 30, simultâneas padrão, intervalo 30, pessoas sem limite)",
  torta.duracaoMin === 30 && torta.maxReservasSimultaneas === CONFIG_PADRAO.maxReservasSimultaneas && torta.intervaloMin === 30 && torta.maxPessoasSimultaneas === null && torta.dias.length === 7, torta);
const faixaInvertida = lerConfig({ dias: [{ ativo: true, faixas: [{ de: "22:00", ate: "18:00" }] }] });
confere("faixa invertida é descartada e o dia sem faixa fica desligado", faixaInvertida.dias[0].ativo === false);

// ── Números do mês ──
const lista: ReservaParaNumeros[] = [
  { data: "2026-11-07", hora: "20:00", pessoas: 4, status: "CHEGOU", origem: "ROBO", consumo: 312.5 },
  { data: "2026-11-07", hora: "20:30", pessoas: 2, status: "NAO_VEIO", origem: "PAINEL" },
  { data: "2026-11-14", hora: "19:00", pessoas: 6, status: "CHEGOU", origem: "ROBO", consumo: null },
  { data: "2026-11-14", hora: "19:30", pessoas: 3, status: "CANCELADA", origem: "ROBO" },
  { data: "2026-11-21", hora: "20:00", pessoas: 5, status: "CONFIRMADA", origem: "BILL" },
];
const n = numerosDasReservas(lista);
confere("números: 4 reservas (cancelada fora), 17 pessoas", n.reservas === 4 && n.pessoas === 17, n);
confere("números: comparecimento 2 de 3 resolvidas = 66,7%", Math.abs((n.comparecimento ?? 0) - 2 / 3) < 1e-9, n.comparecimento);
confere("números: 2 pelo robô, 1 painel, 1 Bill; consumo R$ 312,50 em 1 mesa", n.peloRobo === 2 && n.peloPainel === 1 && n.peloBill === 1 && n.consumo === 312.5 && n.mesasComConsumo === 1, n);
confere("números: por hora e por dia da semana (sábado = 4)", n.porHora["20:00"] === 3 && n.porDiaDaSemana[5] === 4, { porHora: n.porHora, sem: n.porDiaDaSemana });

// ── O robô: marcas ──
const t1 = extrairMarcasDeReserva(`Perfeito!\n[[RESERVA_MESA: {"nome":"João Silva","data":"2026-11-21","hora":"20h","pessoas":4,"obs":"aniversário"}]]`);
confere("marca de reserva: lida e tirada do texto", t1.reserva?.nome === "João Silva" && t1.reserva.hora === "20h" && t1.reserva.pessoas === 4 && t1.reserva.obs === "aniversário" && !/\[\[/.test(t1.texto), t1);
const t2 = extrairMarcasDeReserva(`[[reserva mesa: {nome:'Ana', data:'2026-11-21', hora:'19:30', pessoas:2}]]`);
confere("marca torta (minúscula, sem aspas duplas) ainda é lida", t2.reserva?.nome === "Ana" && t2.reserva.pessoas === 2, t2);
const t3 = extrairMarcasDeReserva(`[[CANCELAR_RESERVA: {"data":"2026-11-21","hora":"20:00"}]] [[RESERVA_MESA: {"nome":"Ana","data":"2026-11-21","hora":"21:00","pessoas":2}]]`);
confere("mudança de horário: as duas marcas", t3.cancelar?.data === SAB && t3.cancelar.hora === "20:00" && t3.reserva?.hora === "21:00", t3);
confere("texto sem marca: nada", extrairMarcasDeReserva("Oi, tudo bem?").tinhaMarca === false);
confere("faltou o dia na marca: pergunta só o dia", perguntaDoQueFalta({ nome: "Ana", data: "", hora: "20:00", pessoas: 2, obs: null, telefone: null }) === "Para eu fazer a reserva, me diz o dia?");

// ── O robô: o que o cliente lê ──
const conf = confirmacaoParaOCliente({ nome: "João", data: SAB, hora: "20:00", pessoas: 4 }, { ...config, toleranciaMin: 15, mensagemDeConfirmacao: "Área kids grátis!" });
confere("confirmação: dia por extenso, hora, pessoas, tolerância e o texto da loja",
  conf.includes("Sábado, 21/11 às 20:00") && conf.includes("4 pessoas, no nome de João") && conf.includes("15 minutos") && conf.includes("Área kids grátis!"), conf);
const lot = respostaDeNaoCabe({ data: SAB, hora: "20:00", pessoas: 2 }, "lotado", "", sug);
confere("lotado: 'já estamos lotados' + horários livres", /lotados/.test(lot) && lot.includes("21:00") && /Qual fica melhor/.test(lot), lot);
confere("grupo grande: chama a equipe", /\[\[CHAMAR_ATENDENTE\]\]/.test(respostaDeNaoCabe({ data: SAB, hora: "20:00", pessoas: 30 }, "grupo_grande", "Até 12.", [])));
const aviso = avisoDeReservaAoDono("nova", { nome: "João", telefone: "5522999990000", data: SAB, hora: "20:00", pessoas: 4, observacao: "aniversário" }, { reservas: 3 }, config);
confere("aviso do dono: título, telefone sem 55, ocupação e link do painel",
  aviso.startsWith("📅 *Reserva nova pelo robô*") && aviso.includes("(22999990000)") && aviso.includes("3 de 3 reservas") && aviso.includes("/store/reservas"), aviso);

// ── O robô: o prompt ──
const sistema = blocoDasReservasNoSistema(config);
confere("prompt do sistema: dias/faixas, duração e a marca", sistema.includes("sáb 18:00 às 22:00") && sistema.includes("2 horas") && sistema.includes("[[RESERVA_MESA:"), sistema);
const conversa = blocoDasReservasNaConversa(config, (d) => (d === SAB ? cheio : []), agora, [{ data: SAB, hora: "19:00", pessoas: 4, nome: "Ana" }]);
const linhaSab = conversa.split("\n").find((l) => l.includes(SAB)) || "";
confere("contexto: sábado mostra livres e lotados (20:00 lotado, 21:00 livre)", /livres .*21:00/.test(linhaSab) && /lotados .*20:00/.test(linhaSab), linhaSab);
confere("contexto: a reserva deste cliente aparece", conversa.includes("Sábado, 21/11 (2026-11-21) às 19:00, 4 pessoas, no nome de Ana"));
confere("contexto: segunda não aceita reserva", conversa.includes("seg 2026-11-23 (segunda): não aceita reserva"), conversa);

// ── Pizzaria 17: com o módulo a ficha não vai mais para a equipe; sem ele, tudo igual ──
const p17 = lerRespostasProntas({ respostasProntas: RESPOSTAS });
const comModulo = semFichaDeReserva(p17);
confere("sem o módulo: a ficha de reserva continua (comportamento de hoje)", regraDaReservaPelaFicha(p17).includes("RESPOSTA_PRONTA:reserva-festa") && /FICHA PREENCHIDA/.test(blocoDasRespostasProntas(p17)));
confere("com o módulo: a resposta pronta segue (regras e fotos), sem a ficha para a equipe",
  comModulo.some((x) => x.id === "reserva-festa" && !x.fichaParaALoja && x.imagens?.length) && !/FICHA PREENCHIDA/.test(blocoDasRespostasProntas(comModulo)));
const ctxBase = {
  storeLink: "https://x", cardapioArquivoUrl: null, cardapioArquivoNoInicio: false, temCupomParaCitar: false, regraDoPrazo: "", personalidade: "",
  diaDeHoje: "quinta", codigoDoDia: "QUI", diaDeAmanha: "sexta", lojaFisica: true, enderecoDaLoja: "Rua A", fazReservaDeMesa: true, modoDaArea: "BAIRRO", ehRota: false, regraDoPix: "",
  anotaPedido: true, soReferencia: false, notaFiscal: null, regraDoMinimo: "", lembreteDoMinimo: "",
} as any;
const regras = regrasDoRobo({ ...ctxBase, regraDaReserva: REGRA_DA_RESERVA_COM_MODULO });
confere("regras do robô com o módulo: 'você reserva de verdade', sem 'chamo alguém da equipe'", regras.includes("você reserva de verdade") && !regras.includes("eu chamo alguém da equipe pra confirmar"));

// ── Cobrança (a dos módulos pagos) ──
const nov = [new Date("2026-11-01T03:00:00Z"), new Date("2026-12-01T03:00:00Z")] as const;
const trecho = (de: string, ate: string | null) => ({ de, ate, valor: 49.9 });
confere("ligou dia 10 com teste até 17: novembro cobra R$ 49,90", valorDasReservasNoMes([trecho("2026-11-10T12:00:00Z", null)], "2026-11-17T12:00:00Z", nov[0], nov[1], new Date("2026-11-25T12:00:00Z")) === 49.9);
confere("desligou dentro do teste: nada", valorDasReservasNoMes([trecho("2026-11-10T12:00:00Z", "2026-11-12T12:00:00Z")], "2026-11-17T12:00:00Z", nov[0], nov[1], new Date("2026-11-25T12:00:00Z")) === 0);
confere("teste invade o mês seguinte inteiro: o mês do teste não cobra",
  valorDasReservasNoMes([trecho("2026-11-28T12:00:00Z", null)], "2026-12-05T12:00:00Z", nov[0], nov[1], new Date("2026-11-30T12:00:00Z")) === 0);

console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo.");
if (falhas) process.exit(1);
