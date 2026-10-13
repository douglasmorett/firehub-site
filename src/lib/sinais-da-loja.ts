/**
 * Sinais de vida da loja guardados na MEMÓRIA do processo, para o cron da
 * loja sem conexão (lib/loja-sem-conexao.ts, api/cron/loja-sem-conexao).
 *
 *   • painel: toda tela aberta em /store (inclusive a TV do KDS) chama
 *     /api/customer-order/poll a cada ~5 s. Nada disso vai para o banco — seria
 *     uma gravação a cada 5 s por aba aberta.
 *   • assistente: o Assistente de Impressão consulta a fila a cada 3 s
 *     (api/store/print-queue). O banco só guarda uma vez por minuto
 *     (User.printQueuePolledAt); aqui fica a consulta de verdade, que é o que
 *     deixa a volta ser vista em segundos.
 *
 * ── Por que `globalThis` ────────────────────────────────────────────────────
 *
 * Quem grava (a rota do poll, a da fila) e quem lê (o cron) são rotas
 * diferentes, e o Next pode empacotar cada uma com a SUA cópia deste módulo:
 * um `const` aqui no topo seria um mapa por rota, e o cron nunca veria um
 * painel. O `globalThis` é um só por processo — o mesmo desenho do
 * `global.__humanSupportChats`.
 *
 * ── O que a memória NÃO sabe ────────────────────────────────────────────────
 *
 * Ela nasce vazia a cada deploy. "Não vi painel nenhum" só vale depois de o
 * servidor estar de pé há alguns minutos (CARENCIA_DO_BOOT_MS, em
 * lib/loja-sem-conexao.ts), e `servidorSubiuEm` diz quando foi isso.
 */

type SinaisNaMemoria = { painel: Map<string, number>; assistente: Map<string, number> };

declare global {
  // eslint-disable-next-line no-var
  var __firehubSinaisDaLoja: SinaisNaMemoria | undefined;
}

function sinais(): SinaisNaMemoria {
  if (!globalThis.__firehubSinaisDaLoja) {
    globalThis.__firehubSinaisDaLoja = { painel: new Map(), assistente: new Map() };
  }
  return globalThis.__firehubSinaisDaLoja;
}

/** Um painel aberto acabou de pedir o feed destas lojas (a da sessão, ou o grupo em "Todas"). */
export function marcarPainelAberto(lojaIds: Iterable<string | null | undefined>, agora: number = Date.now()): void {
  const mapa = sinais().painel;
  for (const id of lojaIds) if (id) mapa.set(id, agora);
}

/** O Assistente acabou de consultar a fila desta loja. */
export function marcarAssistente(lojaId: string | null | undefined, agora: number = Date.now()): void {
  if (lojaId) sinais().assistente.set(lojaId, agora);
}

/** Última rodada de um painel aberto desta loja que ESTE processo atendeu (ms), ou null. */
export function painelVistoEm(lojaId: string): number | null {
  return sinais().painel.get(lojaId) ?? null;
}

/** Última consulta do Assistente desta loja que ESTE processo atendeu (ms), ou null. */
export function assistenteVistoEm(lojaId: string): number | null {
  return sinais().assistente.get(lojaId) ?? null;
}

/** Quando este processo subiu (ms). `process.uptime()` é do próprio Node: sem estado para guardar. */
export function servidorSubiuEm(agora: number = Date.now()): number {
  return agora - process.uptime() * 1000;
}

/** Esquece o que não se vê há horas: loja que fechou não precisa ficar no mapa. */
export function esquecerSinaisVelhos(agora: number = Date.now(), idadeMaxMs = 6 * 60 * 60_000): void {
  for (const mapa of [sinais().painel, sinais().assistente]) {
    for (const [id, em] of mapa) if (agora - em > idadeMaxMs) mapa.delete(id);
  }
}
