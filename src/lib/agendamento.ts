/**
 * PEDIDO AGENDADO NO SITE PRÓPRIO — a regra única.
 *
 * O cliente escolhe, no checkout do cardápio, "Agora" ou "📅 Agendar" (dia e
 * horário). Os horários oferecidos e a conferência do servidor saem DESTE
 * arquivo, para a tela e a rota nunca discordarem (o caso clássico: a tela
 * mostra 19:30 e o POST recusa, ou o POST direto aceita 03:00 de domingo).
 *
 * A loja configura no painel, em Pedidos › Agendamentos (Douglas, 11/10/2026:
 * "se ele aceita agendamento, quais dias, quais horários, com quanto tempo de
 * antecedência"). Nasceu do Pedro (Pizza Vedana), que só trabalha por
 * encomenda com retirada no sábado das 19h às 21h e não tinha como receber.
 *
 * Os horários são no RELÓGIO DA LOJA (`storeTimezone`), nunca no do processo
 * (o servidor roda em UTC — ver lib/fuso.ts) nem no do navegador (cliente em
 * outro fuso). O instante gravado é o real (ISO).
 *
 * SEM IMPORTS de servidor: roda no navegador (checkout) e no servidor (rota).
 */
import { normalizeStoreHours } from "@/lib/store-hours";
import { FUSO_PADRAO } from "@/lib/fuso";

/** Segunda = 0 … Domingo = 6 — a mesma ordem de `normalizeStoreHours`. */
export const DIAS_DA_SEMANA = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"] as const;

export type ConfigDeAgendamento = {
  /** A loja aceita pedido agendado no site próprio. Nasce DESLIGADO. */
  ativo: boolean;
  /** Para quais tipos de pedido. */
  entrega: boolean;
  retirada: boolean;
  /** Dias aceitos (0 = Segunda … 6 = Domingo). */
  dias: number[];
  /** "LOJA" = dentro do horário de funcionamento; "PROPRIO" = a janela abaixo, em todos os dias aceitos. */
  horario: "LOJA" | "PROPRIO";
  de: string;
  ate: string;
  /** Tempo mínimo entre o pedido e o horário escolhido. */
  antecedenciaMin: number;
  /** Até quantos dias à frente o cliente pode agendar (0 = só hoje). */
  diasAFrente: number;
  /** De quanto em quanto tempo os horários aparecem para o cliente. */
  intervaloMin: number;
  /** Encomenda: o site só aceita pedido agendado, nunca "para agora". */
  soAgendado: boolean;
  /** Quanto tempo antes do horário o pedido sai de Agendamentos e vai para a cozinha. */
  liberarAntesMin: number;
};

export const CONFIG_DE_AGENDAMENTO_PADRAO: ConfigDeAgendamento = {
  ativo: false,
  entrega: true,
  retirada: true,
  dias: [0, 1, 2, 3, 4, 5, 6],
  horario: "LOJA",
  de: "18:00",
  ate: "22:00",
  antecedenciaMin: 60,
  diasAFrente: 7,
  intervaloMin: 30,
  soAgendado: false,
  liberarAntesMin: 60,
};

export const OPCOES_DE_ANTECEDENCIA = [30, 60, 120, 240, 720, 1440, 2880];
export const OPCOES_DE_DIAS_A_FRENTE = [0, 1, 2, 3, 7, 14, 30];
export const OPCOES_DE_INTERVALO = [15, 30, 60];
export const OPCOES_DE_LIBERACAO = [30, 60, 90, 120, 180];

const HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;

function inteiroEntre(v: unknown, min: number, max: number, padrao: number): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= min && n <= max ? n : padrao;
}

/**
 * A configuração gravada (`User.agendamentoConfig`), sempre completa e dentro
 * dos limites. Lixo, campo faltando ou valor fora da faixa cai no padrão — a
 * tela e a rota nunca precisam conferir campo por campo.
 */
export function lerConfigDeAgendamento(raw: unknown): ConfigDeAgendamento {
  let r: any = raw;
  if (typeof r === "string") {
    try { r = JSON.parse(r); } catch { r = null; }
  }
  if (!r || typeof r !== "object" || Array.isArray(r)) return { ...CONFIG_DE_AGENDAMENTO_PADRAO, dias: [...CONFIG_DE_AGENDAMENTO_PADRAO.dias] };
  const P = CONFIG_DE_AGENDAMENTO_PADRAO;
  const dias = Array.isArray(r.dias)
    ? [...new Set(r.dias.map((d: unknown) => Math.round(Number(d))).filter((d: number) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() as number[]
    : [...P.dias];
  let entrega = r.entrega !== false;
  let retirada = r.retirada !== false;
  if (!entrega && !retirada) { entrega = true; retirada = true; }
  return {
    ativo: r.ativo === true,
    entrega,
    retirada,
    dias,
    horario: r.horario === "PROPRIO" ? "PROPRIO" : "LOJA",
    de: typeof r.de === "string" && HORA.test(r.de) ? r.de : P.de,
    ate: typeof r.ate === "string" && HORA.test(r.ate) ? r.ate : P.ate,
    antecedenciaMin: inteiroEntre(r.antecedenciaMin, 0, 30 * 24 * 60, P.antecedenciaMin),
    diasAFrente: inteiroEntre(r.diasAFrente, 0, 60, P.diasAFrente),
    intervaloMin: inteiroEntre(r.intervaloMin, 5, 240, P.intervaloMin),
    soAgendado: r.soAgendado === true,
    liberarAntesMin: inteiroEntre(r.liberarAntesMin, 0, 24 * 60, P.liberarAntesMin),
  };
}

/** O tipo do pedido (DELIVERY / PICKUP / RETIRADA…) aceita agendamento nesta loja? */
export function aceitaAgendamentoPara(config: ConfigDeAgendamento, deliveryType: unknown): boolean {
  if (!config.ativo) return false;
  const t = String(deliveryType || "DELIVERY").toUpperCase();
  const ehRetirada = t === "PICKUP" || t.includes("RETIRADA") || t === "TAKEOUT";
  return ehRetirada ? config.retirada : config.entrega;
}

// ── Relógio da loja ─────────────────────────────────────────────────────────

const emMinutos = (h: string): number => {
  const m = HORA.exec(String(h || "").trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};
const hhmm = (min: number): string => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/** "AAAA-MM-DD" no fuso da loja. */
function dataNoFuso(instante: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(instante);
}

/** "AAAA-MM-DD" + "HH:MM" no relógio da loja → o instante real. O offset é medido no próprio fuso. */
export function instanteDaHoraLocal(data: string, hora: string, tz: string): Date | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(data);
  const h = HORA.exec(hora);
  if (!d || !h) return null;
  const comoUtc = Date.UTC(+d[1], +d[2] - 1, +d[3], +h[1], +h[2]);
  const corrigir = (t: number) => {
    const p = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    }).formatToParts(new Date(t));
    const v = (k: string) => Number(p.find((x) => x.type === k)?.value || 0);
    return Date.UTC(v("year"), v("month") - 1, v("day"), v("hour") % 24, v("minute")) - t;
  };
  const off1 = corrigir(comoUtc);
  const off2 = corrigir(comoUtc - off1);
  return new Date(comoUtc - off2);
}

/** Dia da semana (Segunda = 0) de uma data "AAAA-MM-DD" — calendário, sem fuso. */
function diaDaSemana(data: string): number {
  const [a, m, d] = data.split("-").map(Number);
  return (new Date(Date.UTC(a, m - 1, d)).getUTCDay() + 6) % 7;
}

/** A data "AAAA-MM-DD" n dias depois — calendário, sem fuso. */
function somarDias(data: string, n: number): string {
  const [a, m, d] = data.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}

/** As janelas [início, fim) do dia, em minutos, conforme a configuração. */
function janelasDoDia(config: ConfigDeAgendamento, storeHours: unknown, diaIdx: number): [number, number][] {
  if (config.horario === "PROPRIO") {
    const de = emMinutos(config.de);
    let ate = emMinutos(config.ate);
    if (!Number.isFinite(de) || !Number.isFinite(ate)) return [];
    if (ate <= de) ate = 24 * 60; // "das 18h à 01h": no dia, até a meia-noite
    return [[de, ate]];
  }
  const dia = normalizeStoreHours(storeHours)[diaIdx];
  if (!dia || !dia.active) return [];
  const janelas: [number, number][] = [];
  for (const t of dia.shifts || []) {
    if ((t as any).active === false) continue;
    const de = emMinutos(t.open);
    let ate = emMinutos(t.close);
    if (!Number.isFinite(de) || !Number.isFinite(ate)) continue;
    if (ate <= de) ate = 24 * 60; // turno que vira a noite: o resto é madrugada, fora do agendamento
    janelas.push([de, ate]);
  }
  return janelas;
}

/** A loja está em pausa (férias) nesta data? */
function emPausa(storePause: unknown, data: string): boolean {
  const p = storePause as any;
  return Boolean(p?.active && p.from && p.to && data >= String(p.from) && data <= String(p.to));
}

export type HorarioDeAgendamento = { hora: string; iso: string };
export type DiaDeAgendamento = { data: string; rotulo: string; horarios: HorarioDeAgendamento[] };

/** "Hoje", "Amanhã" ou "Sáb 18/10". */
export function rotuloDoDia(data: string, hoje: string): string {
  if (data === hoje) return "Hoje";
  if (data === somarDias(hoje, 1)) return "Amanhã";
  const [, m, d] = data.split("-");
  return `${DIAS_DA_SEMANA[diaDaSemana(data)]} ${d}/${m}`;
}

/**
 * Os dias e horários que o cliente pode escolher AGORA, no relógio da loja.
 * Horário = quando o pedido fica pronto (retirada) ou chega (entrega).
 * Dia sem nenhum horário livre não aparece.
 */
export function horariosParaAgendar(opts: {
  config: ConfigDeAgendamento;
  storeHours: unknown;
  storePause?: unknown;
  timezone?: string | null;
  agora?: Date;
}): DiaDeAgendamento[] {
  const { config } = opts;
  if (!config.ativo) return [];
  const tz = opts.timezone || FUSO_PADRAO;
  const agora = opts.agora || new Date();
  const primeiroInstante = agora.getTime() + config.antecedenciaMin * 60_000;
  const hoje = dataNoFuso(agora, tz);
  const passo = Math.max(5, config.intervaloMin);
  const saida: DiaDeAgendamento[] = [];
  for (let n = 0; n <= config.diasAFrente; n++) {
    const data = somarDias(hoje, n);
    const diaIdx = diaDaSemana(data);
    if (!config.dias.includes(diaIdx)) continue;
    if (emPausa(opts.storePause, data)) continue;
    const horarios: HorarioDeAgendamento[] = [];
    const vistos = new Set<string>();
    for (const [de, ate] of janelasDoDia(config, opts.storeHours, diaIdx)) {
      // Primeiro horário: o início da janela, arredondado para o passo.
      for (let min = Math.ceil(de / passo) * passo; min < ate; min += passo) {
        const hora = hhmm(min);
        if (vistos.has(hora)) continue;
        const instante = instanteDaHoraLocal(data, hora, tz);
        if (!instante || instante.getTime() < primeiroInstante) continue;
        vistos.add(hora);
        horarios.push({ hora, iso: instante.toISOString() });
      }
    }
    horarios.sort((a, b) => a.hora.localeCompare(b.hora));
    if (horarios.length) saida.push({ data, rotulo: rotuloDoDia(data, hoje), horarios });
  }
  return saida;
}

/**
 * O SERVIDOR confere o horário que chegou no pedido. Devolve a frase para o
 * cliente quando não vale, ou null quando vale. A regra é a mesma da tela:
 * o instante tem que ser um dos horários que `horariosParaAgendar` ofereceria
 * agora (com 2 min de folga para quem demorou no checkout).
 */
export function conferirAgendamento(opts: {
  config: ConfigDeAgendamento;
  deliveryType: unknown;
  instante: unknown;
  storeHours: unknown;
  storePause?: unknown;
  timezone?: string | null;
  agora?: Date;
}): string | null {
  const { config } = opts;
  if (!config.ativo) return "Esta loja não está aceitando pedidos agendados no momento.";
  if (!aceitaAgendamentoPara(config, opts.deliveryType)) {
    const t = String(opts.deliveryType || "").toUpperCase();
    return t === "PICKUP" || t.includes("RETIRADA")
      ? "Esta loja não aceita agendamento para retirada. Escolha entrega ou peça para agora."
      : "Esta loja não aceita agendamento para entrega. Escolha retirada ou peça para agora.";
  }
  const quando = opts.instante instanceof Date ? opts.instante : new Date(String(opts.instante || ""));
  if (!Number.isFinite(quando.getTime())) return "Escolha o dia e o horário do agendamento.";
  const agora = opts.agora || new Date();
  // Folga de 2 min: o horário que o cliente viu pode ter "vencido" enquanto ele preenchia.
  const dias = horariosParaAgendar({ ...opts, agora: new Date(agora.getTime() - 2 * 60_000) });
  const vale = dias.some((d) => d.horarios.some((h) => Math.abs(new Date(h.iso).getTime() - quando.getTime()) < 60_000));
  if (vale) return null;
  if (quando.getTime() < agora.getTime() + config.antecedenciaMin * 60_000 - 2 * 60_000) {
    return `Esse horário já não dá: a loja pede ${textoDaAntecedencia(config.antecedenciaMin)} de antecedência. Escolha outro horário.`;
  }
  return "Esse horário não está disponível para agendamento. Escolha outro horário.";
}

/** "1 hora", "30 minutos", "2 dias". */
export function textoDaAntecedencia(min: number): string {
  if (min <= 0) return "nenhuma";
  if (min % 1440 === 0) return min === 1440 ? "1 dia" : `${min / 1440} dias`;
  if (min % 60 === 0) return min === 60 ? "1 hora" : `${min / 60} horas`;
  return `${min} minutos`;
}

/** "sáb 18/10 às 19:30" no relógio da loja — para o card, a comanda e a mensagem. */
export function textoDoAgendamento(instante: Date | string, timezone?: string | null): string {
  const d = new Date(instante);
  if (!Number.isFinite(d.getTime())) return "";
  const tz = timezone || FUSO_PADRAO;
  const data = dataNoFuso(d, tz);
  const hora = new Intl.DateTimeFormat("pt-BR", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  const [, m, dia] = data.split("-");
  return `${DIAS_DA_SEMANA[diaDaSemana(data)].toLowerCase()} ${dia}/${m} às ${hora}`;
}

/**
 * O pedido agendado ainda está "guardado" (em Agendamentos, fora da cozinha)?
 * Sai quando falta `liberarAntesMin` para o horário.
 */
export function aindaGuardado(
  pedido: { agendado?: boolean | null; scheduledDatetime?: Date | string | null },
  liberarAntesMin: number,
  agora: Date = new Date(),
): boolean {
  if (!pedido.agendado || !pedido.scheduledDatetime) return false;
  const quando = new Date(pedido.scheduledDatetime).getTime();
  return Number.isFinite(quando) && quando - agora.getTime() > liberarAntesMin * 60_000;
}
