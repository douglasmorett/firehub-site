/**
 * RESERVAS DE MESA — a regra pura: que horários a loja aceita, quanto cada
 * horário já está ocupado, se cabe uma reserva nova e, quando não cabe, quais
 * são os horários livres mais perto. Sem banco e sem relógio do processo: quem
 * chama passa a configuração, as reservas e o "agora" já no relógio da loja.
 * O teste é scripts/teste-reservas.ts.
 *
 * Douglas, 19/11/2026: "o robô hoje já faz reserva pra Pizzaria 17 … quero um
 * módulo de reserva onde ele consiga enxergar as reservas, colocar quantas
 * reservas simultâneas, entender os horários das reservas para fazer essa
 * gestão". Até aqui a reserva era uma ficha que o robô passava para a equipe
 * (lib/respostas-prontas.ts) — nada ficava gravado nem havia capacidade.
 *
 * Datas são "AAAA-MM-DD" e horas "HH:MM" no relógio da LOJA, como o dono fala
 * ("sábado às 20h"): não há fuso a converter, e a reserva das 20h continua
 * sendo das 20h se o servidor mudar de fuso.
 *
 * Uma reserva ocupa o lugar de `hora` até `hora + duracaoMin`. "Simultâneas" é
 * quantas reservas (e, se a loja quiser, quantas pessoas) cabem ao mesmo tempo
 * no salão: a reserva das 19:00 com 2 h de duração ainda ocupa às 20:30.
 */

export type FaixaDeHorario = {
  /** Primeiro horário de chegada aceito ("18:00"). */
  de: string;
  /** Último horário de chegada aceito ("21:30"). */
  ate: string;
};
export type DiaDeReserva = { ativo: boolean; faixas: FaixaDeHorario[] };

export type ConfigDasReservas = {
  /** Segunda = 0 … Domingo = 6 (a ordem do horário da loja e de relogioDaLoja). */
  dias: DiaDeReserva[];
  /** De quantos em quantos minutos o horário é oferecido (18:00, 18:30…). */
  intervaloMin: number;
  /** Quanto tempo, em média, uma reserva fica com a mesa. */
  duracaoMin: number;
  /** Quantas reservas cabem AO MESMO TEMPO no salão. */
  maxReservasSimultaneas: number;
  /** Quantas pessoas de reserva cabem ao mesmo tempo (null = só conta reservas). */
  maxPessoasSimultaneas: number | null;
  /** Antecedência mínima para reservar (minutos). */
  antecedenciaMinimaMin: number;
  /** Até quantas pessoas numa reserva só (mais que isso, a equipe trata). */
  maxPessoasPorReserva: number;
  /** Até quantos dias à frente aceita reserva. */
  diasNoFuturo: number;
  /** Tolerância de atraso, em minutos (vai na confirmação). 0 = não fala. */
  toleranciaMin: number;
  /** Texto da loja que vai no fim da confirmação (regras, o que pode levar…). */
  mensagemDeConfirmacao: string;
};

export type StatusDaReserva = "CONFIRMADA" | "CHEGOU" | "NAO_VEIO" | "CANCELADA";
export type OrigemDaReserva = "ROBO" | "PAINEL" | "BILL";

/** O mínimo de uma reserva para as contas. */
export type ReservaParaConta = { id?: string; hora: string; pessoas: number; status: StatusDaReserva };

/** O "agora" no relógio da loja. */
export type Agora = { data: string; minutos: number };

export const NOMES_DOS_DIAS = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];
export const DIAS_CURTOS = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];

/**
 * O que vem marcado na primeira vez: jantar de quinta a domingo, das 18:00 às
 * 21:30, 2 h por reserva, 10 reservas ao mesmo tempo. O dono muda na tela.
 */
export const CONFIG_PADRAO: ConfigDasReservas = {
  dias: [0, 1, 2, 3, 4, 5, 6].map((i) => ({
    ativo: i >= 3,
    faixas: i >= 5 ? [{ de: "11:30", ate: "14:30" }, { de: "18:00", ate: "21:30" }] : [{ de: "18:00", ate: "21:30" }],
  })),
  intervaloMin: 30,
  duracaoMin: 120,
  maxReservasSimultaneas: 10,
  maxPessoasSimultaneas: null,
  antecedenciaMinimaMin: 60,
  maxPessoasPorReserva: 20,
  diasNoFuturo: 30,
  toleranciaMin: 15,
  mensagemDeConfirmacao: "",
};

// ─── Hora e data ──────────────────────────────────────────────────────────

const HORA = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** "19:30" → 1170. Inválida → NaN. Aceita "19h", "19h30" e "19". */
export function minutos(hora: string): number {
  const t = String(hora || "").trim().toLowerCase().replace(/\s+/g, "").replace(/h$/, ":00").replace("h", ":");
  const m = (/^\d{1,2}$/.test(t) ? `${t}:00` : t).match(HORA);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
}

/** 1170 → "19:30". */
export function hhmm(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** A hora escrita do jeito do sistema ("19h" → "19:00"); inválida → null. */
export function normalizarHora(hora: string): string | null {
  const m = minutos(hora);
  return Number.isFinite(m) ? hhmm(m) : null;
}

export const dataValida = (data: string) => DATA.test(String(data || "")) && !Number.isNaN(Date.parse(`${data}T12:00:00Z`));

const utc = (data: string) => Date.parse(`${data}T00:00:00Z`);

/** Dias de `de` até `ate` (pode ser negativo). */
export function diasEntre(de: string, ate: string): number {
  return Math.round((utc(ate) - utc(de)) / 86_400_000);
}

/** A data `n` dias depois. */
export function somarDias(data: string, n: number): string {
  return new Date(utc(data) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Segunda = 0 … Domingo = 6. */
export function diaDaSemana(data: string): number {
  return (new Date(utc(data)).getUTCDay() + 6) % 7;
}

/** "Sábado, 21/11". */
export function dataPorExtenso(data: string): string {
  return `${NOMES_DOS_DIAS[diaDaSemana(data)]}, ${data.slice(8, 10)}/${data.slice(5, 7)}`;
}

// ─── Configuração ─────────────────────────────────────────────────────────

const inteiro = (v: unknown, min: number, max: number, padrao: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : padrao;
};

/** A configuração gravada, conferida: o que vier torto volta ao padrão, nunca derruba a tela nem o robô. */
export function lerConfig(bruto: unknown): ConfigDasReservas {
  const o = (bruto && typeof bruto === "object" ? bruto : {}) as Record<string, any>;
  const p = CONFIG_PADRAO;
  const dias: DiaDeReserva[] = [0, 1, 2, 3, 4, 5, 6].map((i) => {
    const d = Array.isArray(o.dias) ? o.dias[i] : null;
    if (!d || typeof d !== "object") return p.dias[i];
    const faixas = (Array.isArray(d.faixas) ? d.faixas : [])
      .map((f: any) => ({ de: normalizarHora(f?.de), ate: normalizarHora(f?.ate) }))
      .filter((f: any): f is FaixaDeHorario => !!f.de && !!f.ate && minutos(f.ate) >= minutos(f.de))
      .slice(0, 4);
    return { ativo: d.ativo === true && faixas.length > 0, faixas };
  });
  // Vazio ou zero = a loja só conta reservas, não pessoas.
  const maxP = Number(o.maxPessoasSimultaneas) > 0 ? inteiro(o.maxPessoasSimultaneas, 1, 2000, 1) : null;
  return {
    dias,
    intervaloMin: [15, 20, 30, 60].includes(Number(o.intervaloMin)) ? Number(o.intervaloMin) : p.intervaloMin,
    duracaoMin: inteiro(o.duracaoMin, 30, 360, p.duracaoMin),
    maxReservasSimultaneas: inteiro(o.maxReservasSimultaneas, 1, 500, p.maxReservasSimultaneas),
    maxPessoasSimultaneas: maxP,
    antecedenciaMinimaMin: inteiro(o.antecedenciaMinimaMin, 0, 7 * 1440, p.antecedenciaMinimaMin),
    maxPessoasPorReserva: inteiro(o.maxPessoasPorReserva, 1, 500, p.maxPessoasPorReserva),
    diasNoFuturo: inteiro(o.diasNoFuturo, 0, 365, p.diasNoFuturo),
    toleranciaMin: inteiro(o.toleranciaMin, 0, 120, p.toleranciaMin),
    mensagemDeConfirmacao: String(o.mensagemDeConfirmacao ?? "").trim().slice(0, 600),
  };
}

/** Os horários de chegada do dia, em ordem ("18:00", "18:30" …). Dia sem reserva → []. */
export function horariosDoDia(config: ConfigDasReservas, data: string): string[] {
  const dia = config.dias[diaDaSemana(data)];
  if (!dia?.ativo) return [];
  const passo = Math.max(5, config.intervaloMin);
  const vistos = new Set<number>();
  for (const f of dia.faixas) {
    for (let t = minutos(f.de); t <= minutos(f.ate); t += passo) vistos.add(t);
  }
  return [...vistos].sort((a, b) => a - b).map(hhmm);
}

/** A hora cai dentro de alguma faixa do dia (mesmo fora da grade: 19:45 numa grade de 30 vale). */
function dentroDeUmaFaixa(config: ConfigDasReservas, data: string, hora: string): boolean {
  const dia = config.dias[diaDaSemana(data)];
  const m = minutos(hora);
  return !!dia?.ativo && dia.faixas.some((f) => m >= minutos(f.de) && m <= minutos(f.ate));
}

// ─── Ocupação ─────────────────────────────────────────────────────────────

export const ocupaLugar = (s: StatusDaReserva) => s === "CONFIRMADA" || s === "CHEGOU";

export type Ocupacao = { reservas: number; pessoas: number };

/** Quantas reservas (e pessoas) estão no salão no minuto `m`. */
export function ocupacaoEm(reservas: ReservaParaConta[], m: number, duracaoMin: number, ignorarId?: string): Ocupacao {
  let n = 0, p = 0;
  for (const r of reservas) {
    if (!ocupaLugar(r.status) || (ignorarId && r.id === ignorarId)) continue;
    const ini = minutos(r.hora);
    if (ini <= m && m < ini + duracaoMin) { n++; p += Math.max(0, r.pessoas || 0); }
  }
  return { reservas: n, pessoas: p };
}

/**
 * O pico de ocupação durante [inicio, inicio + duração): é o que decide se a
 * reserva nova cabe. O pico só muda onde uma reserva começa, então basta olhar
 * o próprio início e o início de cada reserva que cai dentro do intervalo.
 */
export function picoNoIntervalo(reservas: ReservaParaConta[], inicio: number, duracaoMin: number, ignorarId?: string): Ocupacao {
  const pontos = [inicio];
  for (const r of reservas) {
    const m = minutos(r.hora);
    if (m > inicio && m < inicio + duracaoMin) pontos.push(m);
  }
  let pico: Ocupacao = { reservas: 0, pessoas: 0 };
  for (const t of pontos) {
    const o = ocupacaoEm(reservas, t, duracaoMin, ignorarId);
    pico = { reservas: Math.max(pico.reservas, o.reservas), pessoas: Math.max(pico.pessoas, o.pessoas) };
  }
  return pico;
}

// ─── Cabe ou não cabe ─────────────────────────────────────────────────────

export type MotivoDeRecusa =
  | "data_invalida" | "hora_invalida" | "pessoas_invalidas" | "grupo_grande"
  | "dia_sem_reserva" | "fora_do_horario" | "passou" | "antecedencia" | "longe_demais"
  | "lotado" | "lotado_pessoas";

export type Avaliacao = { ok: true; pico: Ocupacao } | { ok: false; motivo: MotivoDeRecusa; explicacao: string };

export type PedidoDeReserva = { data: string; hora: string; pessoas: number; ignorarId?: string };

/**
 * Cabe esta reserva? `reservasDoDia` são as do MESMO dia (qualquer status: só
 * as confirmadas e as que chegaram ocupam lugar). `ignorarId` é a própria
 * reserva quando se está mudando o horário dela.
 */
export function avaliarReserva(config: ConfigDasReservas, reservasDoDia: ReservaParaConta[], pedido: PedidoDeReserva, agora: Agora): Avaliacao {
  const nao = (motivo: MotivoDeRecusa, explicacao: string): Avaliacao => ({ ok: false, motivo, explicacao });
  if (!dataValida(pedido.data)) return nao("data_invalida", "Data inválida.");
  const hora = normalizarHora(pedido.hora);
  if (!hora) return nao("hora_invalida", "Horário inválido.");
  const pessoas = Math.round(Number(pedido.pessoas));
  if (!Number.isFinite(pessoas) || pessoas < 1) return nao("pessoas_invalidas", "Informe quantas pessoas.");
  if (pessoas > config.maxPessoasPorReserva) {
    return nao("grupo_grande", `A reserva pelo sistema vai até ${config.maxPessoasPorReserva} pessoas; grupo maior a equipe combina direto.`);
  }

  const m = minutos(hora);
  const antecedencia = diasEntre(agora.data, pedido.data) * 1440 + m - agora.minutos;
  if (antecedencia < 0) return nao("passou", "Esse horário já passou.");
  if (diasEntre(agora.data, pedido.data) > config.diasNoFuturo) {
    return nao("longe_demais", `A loja aceita reserva até ${config.diasNoFuturo} dias antes.`);
  }
  if (!config.dias[diaDaSemana(pedido.data)]?.ativo) return nao("dia_sem_reserva", `A loja não aceita reserva às ${NOMES_DOS_DIAS[diaDaSemana(pedido.data)].toLowerCase()}s.`);
  if (!dentroDeUmaFaixa(config, pedido.data, hora)) return nao("fora_do_horario", "Fora dos horários de reserva desse dia.");
  if (antecedencia < config.antecedenciaMinimaMin) {
    return nao("antecedencia", `A reserva precisa de pelo menos ${textoDeMinutos(config.antecedenciaMinimaMin)} de antecedência.`);
  }

  const pico = picoNoIntervalo(reservasDoDia, m, config.duracaoMin, pedido.ignorarId);
  if (pico.reservas + 1 > config.maxReservasSimultaneas) return nao("lotado", "Esse horário está lotado.");
  if (config.maxPessoasSimultaneas != null && pico.pessoas + pessoas > config.maxPessoasSimultaneas) {
    return nao("lotado_pessoas", `Esse horário não tem mais lugar para ${pessoas} pessoas.`);
  }
  return { ok: true, pico };
}

export function textoDeMinutos(min: number): string {
  if (min < 60) return `${min} min`;
  if (min % 1440 === 0) return `${min / 1440} dia${min / 1440 > 1 ? "s" : ""}`;
  const h = Math.floor(min / 60), r = min % 60;
  return r ? `${h}h${String(r).padStart(2, "0")}` : `${h} hora${h > 1 ? "s" : ""}`;
}

// ─── O dia na linha do tempo ──────────────────────────────────────────────

export type HorarioDoDia = {
  hora: string;
  /** Ocupação no instante (reservas que estão no salão nesse horário). */
  ocupacao: Ocupacao;
  /** Reservas que CHEGAM nesse horário. */
  chegam: number;
  capacidade: { reservas: number; pessoas: number | null };
  /** Cabe uma reserva nova de `pessoas` chegando nesse horário? */
  livre: boolean;
  motivo?: MotivoDeRecusa;
};

/** Cada horário de chegada do dia com a ocupação e se ainda aceita (para a tela e para o robô). */
export function disponibilidadeDoDia(
  config: ConfigDasReservas, reservasDoDia: ReservaParaConta[], data: string, agora: Agora, pessoas = 2,
): HorarioDoDia[] {
  return horariosDoDia(config, data).map((hora) => {
    const m = minutos(hora);
    const a = avaliarReserva(config, reservasDoDia, { data, hora, pessoas }, agora);
    return {
      hora,
      ocupacao: ocupacaoEm(reservasDoDia, m, config.duracaoMin),
      chegam: reservasDoDia.filter((r) => ocupaLugar(r.status) && minutos(r.hora) === m).length,
      capacidade: { reservas: config.maxReservasSimultaneas, pessoas: config.maxPessoasSimultaneas },
      livre: a.ok,
      ...(a.ok ? {} : { motivo: a.motivo }),
    };
  });
}

export type Sugestao = { data: string; hora: string };

/**
 * Lotado (ou fora do horário)? Os horários livres mais perto do pedido: primeiro
 * no mesmo dia, do mais perto para o mais longe; faltando, os primeiros dos
 * dias seguintes. `reservasDe(data)` devolve as reservas daquele dia.
 */
export function sugerirHorarios(
  config: ConfigDasReservas, reservasDe: (data: string) => ReservaParaConta[], pedido: PedidoDeReserva, agora: Agora,
  quantas = 3, diasParaFrente = 7,
): Sugestao[] {
  const alvo = minutos(normalizarHora(pedido.hora) || "20:00");
  const cabe = (data: string, hora: string) =>
    avaliarReserva(config, reservasDe(data), { data, hora, pessoas: pedido.pessoas, ignorarId: pedido.ignorarId }, agora).ok;
  const saida: Sugestao[] = [];
  if (dataValida(pedido.data)) {
    const doDia = horariosDoDia(config, pedido.data)
      .filter((h) => minutos(h) !== alvo && cabe(pedido.data, h))
      .sort((a, b) => Math.abs(minutos(a) - alvo) - Math.abs(minutos(b) - alvo) || minutos(a) - minutos(b));
    for (const hora of doDia.slice(0, quantas)) saida.push({ data: pedido.data, hora });
  }
  const inicio = dataValida(pedido.data) && diasEntre(agora.data, pedido.data) >= 0 ? pedido.data : agora.data;
  for (let d = 1; d <= diasParaFrente && saida.length < quantas; d++) {
    const data = somarDias(inicio, d);
    // No outro dia, o horário mais perto do que o cliente queria.
    const h = horariosDoDia(config, data)
      .filter((x) => cabe(data, x))
      .sort((a, b) => Math.abs(minutos(a) - alvo) - Math.abs(minutos(b) - alvo))[0];
    if (h) saida.push({ data, hora: h });
  }
  return saida.slice(0, quantas);
}

/** "19:30 ou 21:00" / "sábado 21/11 às 20:00". */
export function textoDasSugestoes(sugestoes: Sugestao[], dataDoPedido: string): string {
  const partes = sugestoes.map((s) =>
    s.data === dataDoPedido ? s.hora : `${NOMES_DOS_DIAS[diaDaSemana(s.data)].toLowerCase()} (${s.data.slice(8, 10)}/${s.data.slice(5, 7)}) às ${s.hora}`);
  if (partes.length <= 1) return partes.join("");
  return `${partes.slice(0, -1).join(", ")} ou ${partes[partes.length - 1]}`;
}

// ─── Números do mês (a seção de valor da tela) ───────────────────────────

export type ReservaParaNumeros = ReservaParaConta & { data: string; origem: OrigemDaReserva; consumo?: number | null };

export type NumerosDasReservas = {
  reservas: number;
  pessoas: number;
  chegaram: number;
  naoVieram: number;
  canceladas: number;
  /** Chegaram ÷ (chegaram + não vieram). null sem reserva já resolvida. */
  comparecimento: number | null;
  pessoasQueVieram: number;
  peloRobo: number;
  peloPainel: number;
  peloBill: number;
  /** Soma do consumo das mesas ligadas a reservas que vieram. */
  consumo: number;
  mesasComConsumo: number;
  /** Pessoas dessas mesas (o divisor do consumo por pessoa). */
  pessoasComConsumo: number;
  porDia: Record<string, { reservas: number; pessoas: number }>;
  /** Reservas por hora de chegada ("19:00": 12). */
  porHora: Record<string, number>;
  /** Segunda = 0 … Domingo = 6. */
  porDiaDaSemana: number[];
};

/** Os números de um período. Canceladas não contam como reserva feita (ficam só no total delas). */
export function numerosDasReservas(lista: ReservaParaNumeros[]): NumerosDasReservas {
  const n: NumerosDasReservas = {
    reservas: 0, pessoas: 0, chegaram: 0, naoVieram: 0, canceladas: 0, comparecimento: null, pessoasQueVieram: 0,
    peloRobo: 0, peloPainel: 0, peloBill: 0, consumo: 0, mesasComConsumo: 0, pessoasComConsumo: 0, porDia: {}, porHora: {}, porDiaDaSemana: [0, 0, 0, 0, 0, 0, 0],
  };
  for (const r of lista) {
    if (r.status === "CANCELADA") { n.canceladas++; continue; }
    n.reservas++;
    n.pessoas += r.pessoas;
    if (r.status === "CHEGOU") { n.chegaram++; n.pessoasQueVieram += r.pessoas; }
    if (r.status === "NAO_VEIO") n.naoVieram++;
    if (r.origem === "ROBO") n.peloRobo++; else if (r.origem === "BILL") n.peloBill++; else n.peloPainel++;
    if (r.status === "CHEGOU" && r.consumo && r.consumo > 0) { n.consumo += r.consumo; n.mesasComConsumo++; n.pessoasComConsumo += r.pessoas; }
    const d = (n.porDia[r.data] ||= { reservas: 0, pessoas: 0 });
    d.reservas++; d.pessoas += r.pessoas;
    const h = `${normalizarHora(r.hora)?.slice(0, 2) ?? "??"}:00`;
    n.porHora[h] = (n.porHora[h] || 0) + 1;
    n.porDiaDaSemana[diaDaSemana(r.data)]++;
  }
  const resolvidas = n.chegaram + n.naoVieram;
  n.comparecimento = resolvidas ? n.chegaram / resolvidas : null;
  n.consumo = Math.round(n.consumo * 100) / 100;
  return n;
}
