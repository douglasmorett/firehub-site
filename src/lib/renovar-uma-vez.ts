import { createHash, randomUUID } from "node:crypto";
import { pegarVez, soltarVez } from "./vez";
import { idDaInstancia } from "./instancia";

/**
 * ── RENOVAR O TOKEN, UM DE CADA VEZ NO CLUSTER ──────────────────────────────
 *
 * O token do iFood vence de hora em hora, e quem precisa dele renova na hora
 * (lib/ifood-api.ts e lib/ifood-token.ts). Só que "quem precisa" são vários
 * ao mesmo tempo: o feed do painel a cada 5 s, o cron do iFood, a mudança de
 * status — e, com dois servidores, os dois. Duas renovações com o MESMO
 * refresh token ao mesmo tempo:
 *   • a segunda pode ser recusada (o refresh já foi usado) e devolver o token
 *     velho, que vence logo — a loja vira "precisa reconectar" sem ninguém ter
 *     mexido;
 *   • ou as duas passam, e a que grava por último deixa no banco o par que o
 *     iFood já trocou pelo da outra.
 *
 * Aqui a renovação de um refresh token pega a vez no banco (lib/vez.ts, chave
 * pelo hash do refresh token — a integração e o User podem guardar o mesmo).
 * Quem pega RELÊ a linha antes de renovar: se outro acabou de renovar, usa o
 * token novo e não renova de novo. Quem não pega espera (até 15 s) e relê até
 * achar o token novo; se a vez soltou e o token continua velho, a renovação do
 * outro falhou (refresh recusado = loja precisa reconectar) — quem esperou não
 * repete a mesma tentativa em fila, segue com o que tem. Banco fora: a vez
 * segue (`seFalhar`), e é como era antes.
 *
 * Custa duas consultas pequenas por renovação (uma vez por hora por loja), e
 * nada quando o token ainda vale.
 */

/** A vez de quem renova; a chamada ao iFood leva ~1 s, isto é folga. */
const VEZ_MS = 30_000;
/** Quanto quem não pegou a vez espera pelo token novo antes de seguir com o que tem. */
const ESPERA_MAX_MS = 15_000;
const PASSO_MS = 500;

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function chaveDaRenovacao(prefixo: string, refreshToken: string): string {
  return `renovar:${prefixo}:${createHash("sha256").update(refreshToken).digest("hex").slice(0, 32)}`;
}

/**
 * Renova uma vez só, mesmo com várias chamadas (e servidores) ao mesmo tempo.
 *
 *  - `ler`: relê a credencial do banco;
 *  - `jaVale`: o token, se a linha relida já tem um que vale (outro renovou);
 *  - `renovar`: renova e grava, com a linha RELIDA (o refresh token pode ter
 *    mudado). Devolve o token novo ou null.
 *
 * null = não renovou (quem chamou segue com o que tinha, como sempre seguiu).
 */
export async function renovarUmaVez<L>(
  chave: string,
  o: {
    ler: () => Promise<L | null>;
    jaVale: (linha: L) => string | null;
    renovar: (linha: L) => Promise<string | null>;
  },
): Promise<string | null> {
  const dono = `${idDaInstancia()}#${randomUUID().slice(0, 8)}`;
  const limite = Date.now() + ESPERA_MAX_MS;
  let esperou = false;
  for (;;) {
    if (await pegarVez(chave, VEZ_MS, { dono })) {
      try {
        const linha = await o.ler();
        if (!linha) return null;
        const ja = o.jaVale(linha);
        if (ja) return ja;
        if (esperou) return null;
        return await o.renovar(linha);
      } finally {
        await soltarVez(chave, dono);
      }
    }
    if (Date.now() > limite) {
      console.warn(`[Token] esperei ${ESPERA_MAX_MS / 1000}s pela renovação de outro servidor (${chave.slice(0, 40)}) — sigo com o que tenho.`);
      return null;
    }
    esperou = true;
    await espera(PASSO_MS);
    const linha = await o.ler().catch(() => null);
    const ja = linha ? o.jaVale(linha) : null;
    if (ja) return ja;
  }
}
