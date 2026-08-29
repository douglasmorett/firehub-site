/**
 * Utilitários para manipular fusos horários de forma nativa sem depender de bibliotecas pesadas.
 * Útil para calcular inícios e fins de dia em timezones dinâmicos de restaurantes (ex: America/Manaus, America/Sao_Paulo).
 */

/**
 * Retorna o offset em milissegundos para um timezone em uma data específica.
 */
export function getOffsetMs(date: Date, timeZone: string): number {
  const tzStr = date.toLocaleString('en-US', { timeZone, timeZoneName: 'shortOffset' });
  const match = tzStr.match(/GMT([+-]\d+)(?::(\d+))?/);
  
  if (match) {
    const hours = parseInt(match[1], 10);
    const mins = parseInt(match[2] || "0", 10);
    return ((hours * 60) + (hours < 0 ? -mins : mins)) * 60 * 1000;
  }
  
  // Fallback seguro caso shortOffset falhe (padrão Brasília -3h)
  return -3 * 60 * 60 * 1000;
}

/**
 * Converte uma data (YYYY-MM-DD) para um objeto Date UTC representando 00:00:00 local daquele timezone.
 */
export function getStartOfDayUTC(dateStr: string, timeZone: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  // O palpite não importa muito, usamos meio-dia UTC para evitar pular de dia caso o offset seja grande
  const guess = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const offsetMs = getOffsetMs(guess, timeZone);
  
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - offsetMs);
}

/**
 * Converte uma data (YYYY-MM-DD) para um objeto Date UTC representando 23:59:59.999 local daquele timezone.
 */
export function getEndOfDayUTC(dateStr: string, timeZone: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const offsetMs = getOffsetMs(guess, timeZone);
  
  return new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999) - offsetMs);
}

/**
 * Retorna o "Início do Mês" UTC para um mês e ano relativos ao timezone local daquele momento
 */
export function getStartOfMonthUTC(now: Date, timeZone: string): Date {
  const tzStr = now.toLocaleString('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const [m, d, y] = tzStr.split('/');
  
  const guess = new Date(Date.UTC(Number(y), Number(m) - 1, 1, 12, 0, 0));
  const offsetMs = getOffsetMs(guess, timeZone);
  
  return new Date(Date.UTC(Number(y), Number(m) - 1, 1, 0, 0, 0) - offsetMs);
}

/**
 * Formata um objeto Date em YYYY-MM-DD respeitando o fuso horário destino.
 */
export function toLocalISODate(date: Date, timeZone: string): string {
  const tzStr = date.toLocaleString('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const [m, d, y] = tzStr.split('/');
  return `${y}-${m}-${d}`;
}

/**
 * Lê um limite de período vindo da tela e devolve o instante certo.
 *
 * A tela manda dia puro ("2026-08-29"), que `new Date()` interpreta como
 * MEIA-NOITE EM UTC — 21:00 da véspera em Brasília. Era isso que quebrava os
 * filtros de data: o começo pegava a noite do dia anterior e o fim cortava o
 * dia escolhido antes de ele acontecer, então "de hoje até hoje" vinha vazio.
 *
 * Aqui o dia puro é ancorado no fuso da loja (`inicio` = 00:00, `fim` =
 * 23:59:59.999). Se vier um instante ISO completo — de telas antigas que ainda
 * mandam `.toISOString()` — ele é respeitado como está.
 */
export function limiteDeDia(
  valor: string | null | undefined,
  timeZone: string,
  borda: "inicio" | "fim",
): Date | undefined {
  const v = String(valor ?? "").trim();
  if (!v) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    return borda === "inicio" ? getStartOfDayUTC(v, timeZone) : getEndOfDayUTC(v, timeZone);
  }
  const d = new Date(v);
  return isNaN(d.getTime()) ? undefined : d;
}
