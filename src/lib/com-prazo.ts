/**
 * Esperar uma promessa até um prazo — SEM jogar fora o que chegar depois.
 *
 * ── Por que isto existe ─────────────────────────────────────────────────────
 *
 * O webhook do WhatsApp dava 25 s para a IA com um `Promise.race`. Estourou o
 * prazo, o cliente lia "instabilidade técnica, faça seu pedido pelo cardápio" —
 * mas a promessa original CONTINUAVA rodando, e podia terminar de gravar o
 * pedido e mandar imprimir na cozinha segundos depois. O cliente, que leu que
 * deu erro, refazia o pedido pelo site: dois pedidos, uma comanda que ninguém
 * esperava. Quatro auditores acharam isso de forma independente em 18/09/2026.
 *
 * `race` não cancela nada: só para de ESCUTAR. Aqui o prazo continua valendo
 * para quem espera (o webhook não pode ficar pendurado — a Evolution desiste),
 * mas quem chama recebe um gancho para o resultado tardio e decide o que fazer
 * com ele: avisar o cliente de que o pedido entrou, por exemplo.
 *
 * Arquivo puro, sem imports: tem teste que o carrega sozinho
 * (scripts/teste-com-prazo.mjs).
 */

export type ResultadoComPrazo<T> =
  | { noPrazo: true; valor: T }
  | { noPrazo: false };

/**
 * @param promessa      O trabalho. NÃO é cancelado quando o prazo vence.
 * @param ms            Quanto esperar.
 * @param aoChegarTarde Chamado com o resultado se ele chegar DEPOIS do prazo.
 *                      Erros dele e da promessa tardia são engolidos de
 *                      propósito: ninguém mais está esperando, e uma rejeição
 *                      solta derrubaria o processo (unhandledRejection).
 * @param aoFalharTarde Chamado se a promessa REJEITAR depois do prazo.
 */
export function comPrazo<T>(
  promessa: Promise<T>,
  ms: number,
  aoChegarTarde?: (valor: T, atrasoMs: number) => void | Promise<void>,
  aoFalharTarde?: (erro: unknown, atrasoMs: number) => void,
): Promise<ResultadoComPrazo<T>> {
  return new Promise<ResultadoComPrazo<T>>((resolve, reject) => {
    let venceu = false;
    const inicio = Date.now();
    const relogio = setTimeout(() => {
      venceu = true;
      resolve({ noPrazo: false });
    }, ms);

    promessa.then(
      (valor) => {
        if (!venceu) {
          clearTimeout(relogio);
          resolve({ noPrazo: true, valor });
          return;
        }
        try {
          const r = aoChegarTarde?.(valor, Date.now() - inicio - ms);
          if (r && typeof (r as Promise<void>).catch === "function") (r as Promise<void>).catch(() => {});
        } catch {
          /* ninguém esperando: não há a quem devolver o erro */
        }
      },
      (erro) => {
        if (!venceu) {
          clearTimeout(relogio);
          reject(erro);
          return;
        }
        try {
          aoFalharTarde?.(erro, Date.now() - inicio - ms);
        } catch {
          /* idem */
        }
      },
    );
  });
}
