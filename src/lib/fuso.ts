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
