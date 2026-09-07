/**
 * src/lib/fuso.ts
 *
 * "Começo do dia" ancorado no fuso DA LOJA, não no fuso do processo.
 *
 * POR QUE ISTO EXISTE. O padrão espalhado pelo código era:
 *
 *     const startOfToday = new Date();
 *     startOfToday.setHours(0, 0, 0, 0);
 *
 * `setHours` usa o fuso do PROCESSO. O container de produção é `node:20-alpine`
 * sem `tzdata` e sem `TZ` — ou seja, **UTC**. Em Brasília (UTC-3) isso faz o
 * "dia" começar às 21:00 da véspera.
 *
 * O estrago medido em 28/08/2026: um cliente pediu às 20:36, recebeu o aviso de
 * "saiu para entrega", e às 21:06 perguntou do pedido. O robô respondeu "não
 * achei nenhum pedido ativo nesse número de WhatsApp hoje" e **começou a montar
 * o pedido de novo** — porque às 21:00 o UTC virou o dia e a busca
 * (`createdAt >= startOfToday`) passou a excluir tudo que veio antes. O jantar
 * inteiro some do robô às nove da noite, todo dia.
 *
 * O `billing.ts` já tinha aprendido essa lição — o comentário do `intervaloDoMes`
 * descreve o mesmo defeito ("o mês virava às 21h de Brasília"). Este arquivo é
 * aquela correção transformada em peça reutilizável, para o resto do sistema
 * parar de repetir o erro.
 */

/** Quanto o fuso `timeZone` está deslocado do UTC no instante `data`, em ms. */
function offsetDoFuso(data: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const parte of dtf.formatToParts(data)) {
    if (parte.type !== "literal") p[parte.type] = parte.value;
  }
  const comoSeFosseUtc = Date.UTC(
    Number(p.year), Number(p.month) - 1, Number(p.day),
    Number(p.hour) % 24, Number(p.minute), Number(p.second),
  );
  return data.getTime() - comoSeFosseUtc;
}

export const FUSO_PADRAO = "America/Sao_Paulo";

/** "YYYY-MM-DD" de hoje **no fuso da loja** — para comparar com datas de pausa, promoção, agenda. */
export function dataDaLoja(timeZone: string | null | undefined = FUSO_PADRAO, agora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone || FUSO_PADRAO, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(agora);
}

/**
 * Hora (minutos desde 00:00) e dia da semana (Segunda = 0, como a lista de
 * `normalizeStoreHours`) **no fuso da loja**, não no do processo.
 *
 * É a ÚNICA forma certa de perguntar "que horas são na loja?" em código que
 * pode rodar no servidor. `new Date().getHours()` responde no fuso do
 * container (UTC): às 20:28 de Brasília ele diz 23:28, e uma loja que fecha
 * às 23:15 aparece fechada no meio do jantar — foi assim que o checkout do
 * site recusou pedidos de todas as lojas, das 20:15 às 23:15, de 27/08 a
 * 06/09/2026.
 */
export function relogioDaLoja(timeZone: string | null | undefined, agora: Date = new Date()): { minutos: number; diaIdx: number } {
  const tz = timeZone || FUSO_PADRAO;
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false,
  }).formatToParts(agora);

  const pega = (tipo: string) => partes.find((p) => p.type === tipo)?.value || "";
  const hora = Number(pega("hour"));
  const minuto = Number(pega("minute"));
  const SEMANA: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

  return {
    // "24" aparece em algumas engines para meia-noite; vira 0.
    minutos: ((Number.isFinite(hora) ? hora : 0) % 24) * 60 + (Number.isFinite(minuto) ? minuto : 0),
    diaIdx: SEMANA[pega("weekday")] ?? 0,
  };
}

/**
 * O instante em que começou o dia corrente **no fuso da loja**.
 *
 * Use no lugar de `setHours(0,0,0,0)` em qualquer consulta com
 * `createdAt >= inicioDoDia`. Passe `user.storeTimezone` quando tiver; sem ele,
 * cai em Brasília, que é onde estão as lojas hoje.
 */
export function inicioDoDiaDaLoja(timeZone: string | null | undefined = FUSO_PADRAO, agora: Date = new Date()): Date {
  const tz = timeZone || FUSO_PADRAO;

  // Que dia é hoje NAQUELE fuso (não no do processo).
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(agora).split("-").map(Number);
  const [ano, mes, dia] = partes;

  // Duas passadas, igual ao billing: a primeira acha o offset aproximado, a
  // segunda confirma no instante corrigido. Só importa na virada de horário de
  // verão, mas é barato e evita uma hora errada uma vez por ano.
  const chute = Date.UTC(ano, mes - 1, dia, 0, 0, 0);
  const off1 = offsetDoFuso(new Date(chute), tz);
  const off2 = offsetDoFuso(new Date(chute + off1), tz);
  return new Date(chute + off2);
}

/**
 * Quantos dias atrás, ancorado na meia-noite da loja. `diasAtras(0)` é hoje.
 */
export function inicioDoDiaDaLojaAtras(dias: number, timeZone?: string | null, agora: Date = new Date()): Date {
  const hoje = inicioDoDiaDaLoja(timeZone, agora);
  return new Date(hoje.getTime() - dias * 24 * 60 * 60 * 1000);
}

/** Antes desta hora local, ainda é o expediente da noite anterior. */
export const HORA_DE_VIRADA_DO_EXPEDIENTE = 5;

/**
 * O começo do DIA OPERACIONAL da loja — que não é o dia do calendário.
 *
 * Restaurante que atende até de madrugada trabalha um turno só, atravessando a
 * meia-noite. Para o cliente que pediu 23:30 e pergunta 00:10, o pedido é
 * "de hoje"; para o calendário, é de ontem.
 *
 * Isto importou de verdade: corrigir só o fuso (meia-noite de Brasília em vez de
 * meia-noite UTC) consertava a janela das 21:00 às 24:00 — a maior — mas
 * QUEBRAVA a madrugada, que o bug antigo cobria por acidente (o "dia" em UTC
 * começava às 21:00 de Brasília). Trocar um buraco por outro não é conserto.
 *
 * Regra: antes das 5 da manhã no fuso da loja, o expediente é o do dia anterior.
 * A janela nunca passa de ~29h, e a consulta que a usa já limita a 5 pedidos.
 */
export function inicioDoExpedienteDaLoja(timeZone: string | null | undefined = FUSO_PADRAO, agora: Date = new Date()): Date {
  const tz = timeZone || FUSO_PADRAO;
  const horaLocal = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", hour12: false }).format(agora),
  ) % 24;
  const hoje = inicioDoDiaDaLoja(tz, agora);
  if (horaLocal < HORA_DE_VIRADA_DO_EXPEDIENTE) {
    return new Date(hoje.getTime() - 24 * 60 * 60 * 1000);
  }
  return hoje;
}
