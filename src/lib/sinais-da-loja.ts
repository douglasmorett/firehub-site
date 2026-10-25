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
 *
 * ── E a OUTRA instância? ────────────────────────────────────────────────────
 *
 * Com dois servidores atrás do balanceador, o painel do dono (com o cookie de
 * afinidade) pode falar só com B enquanto o cron roda em A: A não vê painel
 * nenhum e, com o Assistente fechado, pausaria o iFood da loja de quem está
 * olhando o painel. Então o sinal também vai ao banco ("SinalDaLoja", gravado
 * pelo laço de lib/laco-entre-instancias.ts) — no máximo UMA escrita a cada
 * `INTERVALO_DO_SINAL_NO_BANCO_MS` por loja, tipo e instância, nunca uma por
 * consulta. O cron lê a linha das OUTRAS instâncias (a própria memória já é
 * mais fresca) e soma com `sinalDeOutraInstancia`.
 */

/** Uma escrita no banco por loja, tipo e instância, no máximo a cada isto. */
export const INTERVALO_DO_SINAL_NO_BANCO_MS = 30_000;

export type TipoDoSinal = "painel" | "assistente";

type SinaisNaMemoria = {
  painel: Map<string, number>;
  assistente: Map<string, number>;
  /** "tipo|loja" → quando foi posto na fila do banco pela última vez. */
  paraOBancoEm?: Map<string, number>;
  /** O que o laço ainda vai gravar ("tipo|loja"). */
  paraOBanco?: Map<string, { lojaId: string; tipo: TipoDoSinal }>;
};

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

/** Sem o laço rodando (teste, script), a fila do banco não cresce para sempre. */
const TETO_DA_FILA_DO_BANCO = 5_000;

function paraOBanco(lojaId: string, tipo: TipoDoSinal, agora: number): void {
  const s = sinais();
  const em = (s.paraOBancoEm ??= new Map());
  const fila = (s.paraOBanco ??= new Map());
  const chave = `${tipo}|${lojaId}`;
  const ultima = em.get(chave);
  if (ultima !== undefined && agora - ultima < INTERVALO_DO_SINAL_NO_BANCO_MS && agora >= ultima) return;
  em.set(chave, agora);
  if (fila.size >= TETO_DA_FILA_DO_BANCO) fila.clear();
  fila.set(chave, { lojaId, tipo });
}

/** Um painel aberto acabou de pedir o feed destas lojas (a da sessão, ou o grupo em "Todas"). */
export function marcarPainelAberto(lojaIds: Iterable<string | null | undefined>, agora: number = Date.now()): void {
  const mapa = sinais().painel;
  for (const id of lojaIds) {
    if (!id) continue;
    mapa.set(id, agora);
    paraOBanco(id, "painel", agora);
  }
}

/** O Assistente acabou de consultar a fila desta loja. */
export function marcarAssistente(lojaId: string | null | undefined, agora: number = Date.now()): void {
  if (!lojaId) return;
  sinais().assistente.set(lojaId, agora);
  paraOBanco(lojaId, "assistente", agora);
}

/** O que o laço deve gravar agora (e sai da fila). */
export function tirarSinaisParaOBanco(): { lojaId: string; tipo: TipoDoSinal }[] {
  const fila = sinais().paraOBanco;
  if (!fila || fila.size === 0) return [];
  const lista = [...fila.values()];
  fila.clear();
  return lista;
}

/** A gravação falhou: volta para a fila (a próxima volta do laço tenta de novo). */
export function devolverSinaisParaOBanco(lista: { lojaId: string; tipo: TipoDoSinal }[]): void {
  const fila = (sinais().paraOBanco ??= new Map());
  for (const s of lista) {
    if (fila.size >= TETO_DA_FILA_DO_BANCO) break;
    fila.set(`${s.tipo}|${s.lojaId}`, s);
  }
}

/**
 * O sinal que OUTRA instância gravou há `haMs` (medido no relógio do banco),
 * no relógio daqui — com a folga do intervalo de escrita: aquela instância
 * pode ter visto a loja até 30 s DEPOIS da linha (não grava de novo antes
 * disso). Somar a folga deixa as duas decisões do cron do lado seguro:
 *   • "apagou" (2 min sem painel) só com a linha velha de 2,5 min — nunca
 *     pausar o iFood antes do que faria com um servidor só;
 *   • "voltou" (sinal nos últimos 30 s) aceita linha de até 60 s — e a
 *     primeira consulta depois de um silêncio vai ao banco na hora.
 * Nunca no futuro. null = nenhuma outra instância viu a loja.
 */
export function sinalDeOutraInstancia(haMs: number | null | undefined, agora: number = Date.now()): number | null {
  if (haMs === null || haMs === undefined || !Number.isFinite(haMs)) return null;
  return Math.min(agora, agora - Math.max(0, haMs) + INTERVALO_DO_SINAL_NO_BANCO_MS);
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
  for (const mapa of [sinais().painel, sinais().assistente, sinais().paraOBancoEm]) {
    if (!mapa) continue;
    for (const [id, em] of mapa) if (agora - em > idadeMaxMs) mapa.delete(id);
  }
}
