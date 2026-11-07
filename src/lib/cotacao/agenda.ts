/**
 * A AGENDA DA COTAÇÃO — em que dias e horas a loja pede os preços aos
 * fornecedores. Puro (sem banco): a tela, o cron e o teste importam.
 *
 * Douglas, 07/11/2026: "ele vai clicar, deixar agendado o dia e a hora". O
 * "segunda e quinta" das anotações dele era só exemplo: não há dia padrão. A
 * agenda nasce VAZIA e cada loja marca os dias e a hora que quiser, com mais de
 * um horário por semana se precisar (ex.: segunda e quinta às 8h, sábado às 14h).
 *
 * As horas são as do relógio da LOJA (storeTimezone): o servidor roda em UTC,
 * e "8h" no servidor seria 5h em Brasília.
 */

/** Um horário: os dias da semana (0 = domingo … 6 = sábado) e a hora "HH:MM". */
export type HorarioDaCotacao = { dias: number[]; hora: string };

export const NOMES_DOS_DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
export const DIAS_CURTOS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

/** Até quantos horários uma loja marca: mais que isso já é disparo, não cotação. */
export const MAX_HORARIOS = 7;
/**
 * Quanto tempo depois da hora marcada a rodada ainda sai. O cron roda a cada
 * minuto; a folga cobre um servidor reiniciando na hora H — e não manda às 15h
 * o "bom dia" das 8h de um servidor que ficou fora a manhã inteira.
 */
export const JANELA_DO_HORARIO_MIN = 60;

const HORA_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export function horaValida(h: unknown): string | null {
  const m = HORA_RE.exec(String(h ?? "").trim());
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
}

/** A agenda como veio do banco ou da tela, limpa: dias válidos, hora válida, sem repetir. */
export function normalizarAgenda(bruto: unknown): HorarioDaCotacao[] {
  if (!Array.isArray(bruto)) return [];
  const saida: HorarioDaCotacao[] = [];
  for (const h of bruto) {
    const hora = horaValida((h as any)?.hora);
    const dias = Array.isArray((h as any)?.dias)
      ? [...new Set((h as any).dias.map((d: unknown) => Number(d)).filter((d: number) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() as number[]
      : [];
    if (!hora || dias.length === 0) continue;
    const igual = saida.find((x) => x.hora === hora);
    // Dois horários na mesma hora viram um só, com os dias somados.
    if (igual) igual.dias = [...new Set([...igual.dias, ...dias])].sort();
    else saida.push({ dias, hora });
    if (saida.length >= MAX_HORARIOS) break;
  }
  return saida.sort((a, b) => a.hora.localeCompare(b.hora));
}

/** "08:00" → "8h"; "14:30" → "14h30". */
export function horaFalada(hora: string): string {
  const [h, m] = hora.split(":");
  return `${Number(h)}h${m && m !== "00" ? m : ""}`;
}

/** [1, 4] → "toda segunda e quinta"; [1,2,3,4,5] → "de segunda a sexta"; os 7 → "todo dia". */
export function diasFalados(dias: number[]): string {
  const d = [...new Set(dias)].sort();
  if (d.length === 7) return "todo dia";
  if (d.join() === "1,2,3,4,5") return "de segunda a sexta";
  if (d.join() === "1,2,3,4,5,6") return "de segunda a sábado";
  const juntar = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} e ${xs[xs.length - 1]}`);
  // "segunda" … "sexta" são femininos; sábado e domingo, masculinos.
  const fem = d.filter((x) => x >= 1 && x <= 5).map((x) => NOMES_DOS_DIAS[x]);
  const masc = [6, 0].filter((x) => d.includes(x)).map((x) => NOMES_DOS_DIAS[x]);
  const partes: string[] = [];
  if (fem.length) partes.push(`toda ${juntar(fem)}`);
  if (masc.length) partes.push(`todo ${juntar(masc)}`);
  return partes.join(" e ");
}

/**
 * A frase da tela: "Toda segunda e quinta às 8h a Pizzaria X pede os preços
 * aos fornecedores." Vazia: diz que só sai pelo botão.
 */
export function resumoDaAgenda(agenda: HorarioDaCotacao[], nomeDaLoja: string): string {
  const a = normalizarAgenda(agenda);
  const loja = nomeDaLoja.trim() || "a sua loja";
  if (a.length === 0) return "Nenhum horário marcado ainda: a cotação só sai quando você tocar em “Pedir cotação agora”.";
  const partes = a.map((h) => `${diasFalados(h.dias)} às ${horaFalada(h.hora)}`);
  const juntas = partes.length === 1 ? partes[0] : `${partes.slice(0, -1).join(", ")} e ${partes[partes.length - 1]}`;
  return `${juntas.charAt(0).toUpperCase()}${juntas.slice(1)} a ${loja} pede os preços aos fornecedores.`;
}

/** O relógio da loja agora: dia "YYYY-MM-DD", dia da semana e minutos desde a meia-noite. */
export function relogioDaLoja(agora: Date, tz: string): { dia: string; diaDaSemana: number; minutos: number } {
  const ler = (zona: string) => {
    const p = new Intl.DateTimeFormat("en-CA", {
      timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short",
    }).formatToParts(agora);
    const v = (t: string) => p.find((x) => x.type === t)?.value || "";
    const dia = `${v("year")}-${v("month")}-${v("day")}`;
    const diaDaSemana = new Date(`${dia}T12:00:00Z`).getUTCDay();
    return { dia, diaDaSemana, minutos: Number(v("hour")) * 60 + Number(v("minute")) };
  };
  try {
    return ler(tz || "America/Sao_Paulo");
  } catch {
    // Fuso inválido no cadastro: Brasília, em vez de derrubar o cron inteiro.
    return ler("America/Sao_Paulo");
  }
}

const minutosDa = (hora: string) => Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3, 5));

/**
 * O horário da agenda que está valendo AGORA (já passou da hora, dentro da
 * janela), como chave da rodada: "2026-11-09 08:00". Nulo = nada a fazer.
 * A chave é única por loja no banco: o cron rodando de novo no mesmo minuto,
 * ou dois servidores, não criam a mesma rodada duas vezes.
 */
export function horarioDevido(agenda: HorarioDaCotacao[], agora: Date, tz: string, janelaMin = JANELA_DO_HORARIO_MIN): string | null {
  const r = relogioDaLoja(agora, tz);
  let melhor: string | null = null;
  for (const h of normalizarAgenda(agenda)) {
    if (!h.dias.includes(r.diaDaSemana)) continue;
    const passou = r.minutos - minutosDa(h.hora);
    if (passou >= 0 && passou < janelaMin && (!melhor || h.hora > melhor)) melhor = h.hora;
  }
  return melhor ? `${r.dia} ${melhor}` : null;
}

/** Soma dias a um "YYYY-MM-DD" (sem fuso: é só o calendário). */
export function somarDiasAoDia(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** O próximo horário da agenda depois de agora, para a tela: { dia, diaDaSemana, hora }. */
export function proximoHorario(agenda: HorarioDaCotacao[], agora: Date, tz: string): { dia: string; diaDaSemana: number; hora: string } | null {
  const a = normalizarAgenda(agenda);
  if (!a.length) return null;
  const r = relogioDaLoja(agora, tz);
  for (let n = 0; n <= 7; n++) {
    const dia = somarDiasAoDia(r.dia, n);
    const sem = (r.diaDaSemana + n) % 7;
    const horas = a.filter((h) => h.dias.includes(sem)).map((h) => h.hora).sort();
    const hora = horas.find((h) => n > 0 || minutosDa(h) > r.minutos);
    if (hora) return { dia, diaDaSemana: sem, hora };
  }
  return null;
}
