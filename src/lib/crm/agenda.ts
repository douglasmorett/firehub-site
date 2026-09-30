/**
 * A AGENDA DA EQUIPE — as contas de horário, sem banco (a tela usa também).
 *
 * Cada vendedor tem uma disponibilidade semanal (faixas por dia) e uma duração
 * de demonstração. Os HORÁRIOS do dia saem dela; as VAGAS são os horários que
 * nenhuma reunião ativa ocupa e que ainda não passaram. É essa conta que
 * responde "tem vaga para marcar mais alguém com o Victor na quinta?".
 *
 * ── Fuso ────────────────────────────────────────────────────────────────────
 *
 * Tudo em Brasília, nunca no fuso do processo: o container é UTC, e "9h" em
 * `setHours(9)` lá dentro é 6h da manhã aqui (lib/fuso.ts conta a história).
 */

export const FUSO_DA_AGENDA = "America/Sao_Paulo";

export type Faixa = [string, string];
export type Disponibilidade = {
  /** Dia da semana ("0" = domingo … "6" = sábado) → faixas "HH:MM"–"HH:MM". */
  dias: Record<string, Faixa[]>;
  /** Quanto dura uma demonstração. */
  duracaoMin: number;
  /** Folga entre uma e a próxima. */
  intervaloMin: number;
};

const DIA_UTIL: Faixa[] = [["09:00", "12:00"], ["14:00", "18:00"]];

/** Quem ainda não cadastrou os próprios horários: dia útil, 9h–12h e 14h–18h. */
export const DISPONIBILIDADE_PADRAO: Disponibilidade = {
  dias: { "0": [], "1": DIA_UTIL, "2": DIA_UTIL, "3": DIA_UTIL, "4": DIA_UTIL, "5": DIA_UTIL, "6": [] },
  duracaoMin: 45,
  intervaloMin: 15,
};

export const NOMES_DOS_DIAS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

/** "09:30" → 570. Fora do formato ou do dia → null. "24:00" vale como fim do dia. */
export function minutosDoHorario(hhmm: unknown): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59 || h > 24 || (h === 24 && min > 0)) return null;
  return h * 60 + min;
}

export function horarioDosMinutos(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Lê o que veio do banco ou da tela; o que não fizer sentido cai no padrão. */
export function normalizarDisponibilidade(v: unknown): Disponibilidade {
  const bruto = (v && typeof v === "object" ? v : {}) as any;
  const duracao = Number(bruto.duracaoMin);
  const intervalo = Number(bruto.intervaloMin);
  const dias: Record<string, Faixa[]> = {};
  const temDias = bruto.dias && typeof bruto.dias === "object";
  for (let d = 0; d <= 6; d++) {
    const lista = temDias ? bruto.dias[String(d)] : DISPONIBILIDADE_PADRAO.dias[String(d)];
    const faixas: Faixa[] = [];
    if (Array.isArray(lista)) {
      for (const f of lista) {
        if (!Array.isArray(f) || f.length !== 2) continue;
        const ini = minutosDoHorario(f[0]);
        const fim = minutosDoHorario(f[1]);
        if (ini === null || fim === null || fim <= ini) continue;
        faixas.push([horarioDosMinutos(ini), horarioDosMinutos(fim)]);
      }
    }
    faixas.sort((a, b) => (minutosDoHorario(a[0]) ?? 0) - (minutosDoHorario(b[0]) ?? 0));
    dias[String(d)] = faixas;
  }
  return {
    dias,
    duracaoMin: Number.isFinite(duracao) && duracao >= 15 && duracao <= 240 ? Math.round(duracao) : DISPONIBILIDADE_PADRAO.duracaoMin,
    intervaloMin: Number.isFinite(intervalo) && intervalo >= 0 && intervalo <= 120 ? Math.round(intervalo) : DISPONIBILIDADE_PADRAO.intervaloMin,
  };
}

/** Quanto o fuso está atrás do UTC no instante dado, em ms (Brasília: +3 h). */
function deslocamento(instante: number, fuso: string): number {
  const p: Record<string, string> = {};
  for (const parte of new Intl.DateTimeFormat("en-US", {
    timeZone: fuso, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(instante))) {
    if (parte.type !== "literal") p[parte.type] = parte.value;
  }
  const comoSeFosseUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second));
  return instante - comoSeFosseUtc;
}

/** O instante de "YYYY-MM-DD" às "HH:MM" em Brasília. */
export function instanteDaAgenda(dataYmd: string, hhmm: string, fuso = FUSO_DA_AGENDA): Date {
  const [y, m, d] = dataYmd.split("-").map(Number);
  const minutos = minutosDoHorario(hhmm) ?? 0;
  const comoUtc = Date.UTC(y, m - 1, d, 0, minutos);
  let instante = comoUtc + deslocamento(comoUtc, fuso);
  // Na virada de horário de verão o deslocamento muda no meio: confere uma vez.
  const conferido = comoUtc + deslocamento(instante, fuso);
  if (conferido !== instante) instante = conferido;
  return new Date(instante);
}

/** "YYYY-MM-DD" do instante, em Brasília. */
export function dataDaAgenda(instante: Date | string | number, fuso = FUSO_DA_AGENDA): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: fuso, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(instante));
}

/** "HH:MM" do instante, em Brasília. */
export function horaDaAgenda(instante: Date | string | number, fuso = FUSO_DA_AGENDA): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: fuso, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(instante));
}

/** 0 = domingo … 6 = sábado, da data do calendário (sem fuso: a data já é local). */
export function diaDaSemana(dataYmd: string): number {
  const [y, m, d] = dataYmd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function somarDias(dataYmd: string, n: number): string {
  const [y, m, d] = dataYmd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/** "qui., 02/10" */
export function dataCurta(dataYmd: string): string {
  const [y, m, d] = dataYmd.split("-").map(Number);
  const dia = NOMES_DOS_DIAS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${dia.slice(0, 3).toLowerCase()}., ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
}

export type Horario = { inicio: Date; fim: Date };

/** Os horários de demonstração do dia, pela disponibilidade (ocupados ou não). */
export function horariosDoDia(disp: Disponibilidade, dataYmd: string, fuso = FUSO_DA_AGENDA): Horario[] {
  const faixas = disp.dias[String(diaDaSemana(dataYmd))] || [];
  const passo = disp.duracaoMin + disp.intervaloMin;
  const horarios: Horario[] = [];
  for (const [a, b] of faixas) {
    const ini = minutosDoHorario(a);
    const fim = minutosDoHorario(b);
    if (ini === null || fim === null) continue;
    for (let t = ini; t + disp.duracaoMin <= fim; t += passo) {
      horarios.push({
        inicio: instanteDaAgenda(dataYmd, horarioDosMinutos(t), fuso),
        fim: instanteDaAgenda(dataYmd, horarioDosMinutos(t + disp.duracaoMin), fuso),
      });
    }
  }
  return horarios;
}

export type ReuniaoNaAgenda = { inicio: Date | string; fim: Date | string; status: string };

/** Reunião cancelada não ocupa horário; as outras (inclusive a que já passou) ocupam. */
export function ocupaHorario(r: { status: string }): boolean {
  return r.status !== "CANCELADA";
}

export function sobrepoe(a: { inicio: Date | string; fim: Date | string }, b: { inicio: Date | string; fim: Date | string }): boolean {
  return new Date(a.inicio).getTime() < new Date(b.fim).getTime() && new Date(b.inicio).getTime() < new Date(a.fim).getTime();
}

/** Com quanto tempo de antecedência ainda dá para marcar (o robô e a tela usam a mesma). */
export const ANTECEDENCIA_MINIMA_MIN = 30;

/** As vagas: horários do dia sem reunião ativa por cima e que ainda não chegaram. */
export function vagasDoDia(
  disp: Disponibilidade,
  dataYmd: string,
  reunioes: ReuniaoNaAgenda[],
  agora: Date = new Date(),
  antecedenciaMin = ANTECEDENCIA_MINIMA_MIN,
  fuso = FUSO_DA_AGENDA,
): Horario[] {
  const limite = agora.getTime() + antecedenciaMin * 60_000;
  const ativas = reunioes.filter(ocupaHorario);
  return horariosDoDia(disp, dataYmd, fuso).filter(
    (h) => h.inicio.getTime() >= limite && !ativas.some((r) => sobrepoe(h, r)),
  );
}
