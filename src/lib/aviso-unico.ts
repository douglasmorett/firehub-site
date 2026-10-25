import { prisma } from "./prisma";
import { pegarVez, soltarVez } from "./vez";
import { idDaInstancia } from "./instancia";
import { faxinaDeTempoEmTempo } from "./robo-no-banco";

/**
 * ── AVISO UMA VEZ SÓ, NO CLUSTER ────────────────────────────────────────────
 *
 * O freio dos alertas do robô ("IA fora do ar" para a loja a cada 30 min, para
 * o administrador a cada hora, "cliente pediu atendente" no modo sem pausa)
 * era um Map do processo (`podeAlertarAgora`, lib/falha-da-ia.ts). Com dois
 * processos recebendo o webhook — os dois containers no meio de um deploy, ou
 * o DNS do robô trocado para o outro servidor —, cada um tinha o seu freio e o
 * dono recebia o mesmo alerta duas vezes.
 *
 * A chave vai para a tabela "Vez" (lib/vez.ts) com um dono NOVO a cada
 * tentativa: assim nem o mesmo processo "renova" a vez antes de ela vencer —
 * quem pega, pega por `ms`. O freio da memória continua na frente (é ele que
 * segura as mensagens simultâneas do mesmo processo sem ir ao banco); esta é a
 * segunda porta, só consultada quando a primeira deixa passar.
 *
 * Banco fora: o aviso sai (o comportamento de antes da vez existir).
 */

/** Pega o aviso `chave` por `ms`. Devolve o dono (para devolver se o envio falhar) ou null se outro já avisou. */
export async function pegarAvisoUnico(chave: string, ms: number): Promise<string | null> {
  const dono = `${idDaInstancia()}#${Math.random().toString(36).slice(2, 10)}`;
  if (!(await pegarVez(`aviso:${chave}`, ms, { dono }))) return null;
  faxinaDeTempoEmTempo("avisos-unicos", 60 * 60_000, () =>
    prisma.$executeRaw`DELETE FROM "Vez" WHERE "chave" LIKE 'aviso:%' AND "ate" < now() - interval '1 day'`,
  );
  return dono;
}

/** O envio falhou: o próximo (de qualquer servidor) pode tentar. Nunca lança. */
export function devolverAvisoUnico(chave: string, dono: string): Promise<void> {
  return soltarVez(`aviso:${chave}`, dono);
}
