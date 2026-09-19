/**
 * A pausa do robô numa conversa, na memória do processo.
 *
 * ── Por que é um módulo ─────────────────────────────────────────────────────
 *
 * A pausa vivia num `Map` privado do webhook (`cooldownCache`, chave `paused_`).
 * A rota do painel que encerra o atendimento humano ("Encerrar & Reativar
 * Robô") não tinha como alcançá-lo: limpava a marca do banco, dizia ao cliente
 * "nosso robô continuará te ajudando por aqui" — e o robô seguia mudo por até
 * 12 horas, porque a pausa em memória é conferida antes de tudo.
 *
 * ── Esta NÃO é a trava durável ──────────────────────────────────────────────
 *
 * Memória some a cada deploy. A trava que sobrevive é a do banco
 * (`passarParaAtendimentoHumano` em lib/loop-guard.ts), e quem pausa uma
 * conversa tem que gravar AS DUAS: a daqui responde sem custo de consulta, a do
 * banco segura o robô depois de um restart. O caminho "cliente pediu atendente"
 * só gravava esta — houve noite com quinze deploys, e cada um devolvia o robô à
 * conversa de quem estava esperando uma pessoa.
 *
 * Guardada em `globalThis` porque o Next carrega cada rota num bundle próprio:
 * uma variável de módulo seria uma por rota, e é exatamente o defeito acima.
 */

export const PAUSA_PADRAO_MS = 12 * 60 * 60 * 1000;

type Pausas = Map<string, number>;

function pausas(): Pausas {
  const g = globalThis as any;
  if (!g.__firehubPausasDoRobo) g.__firehubPausasDoRobo = new Map<string, number>();
  return g.__firehubPausasDoRobo as Pausas;
}

const chave = (userId: string, remoteJid: string) => `${userId}_${remoteJid}`;

export function pausarRobo(userId: string, remoteJid: string, ms: number = PAUSA_PADRAO_MS, agora: number = Date.now()) {
  pausas().set(chave(userId, remoteJid), agora + ms);
}

export function roboEstaPausado(userId: string, remoteJid: string, agora: number = Date.now()): boolean {
  const k = chave(userId, remoteJid);
  const ate = pausas().get(k);
  if (ate === undefined) return false;
  if (agora >= ate) {
    pausas().delete(k);
    return false;
  }
  return true;
}

export function retomarRobo(userId: string, remoteJid: string) {
  pausas().delete(chave(userId, remoteJid));
}
