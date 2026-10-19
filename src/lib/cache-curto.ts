/**
 * Cache CURTO em memória, para leitura de CONFIGURAÇÃO que as rotas de poll
 * repetiam a cada chamada (quem é o usuário do e-mail, se a loja tem JotaJá,
 * a config do KDS…).
 *
 * Medido no pico de 18/10/2026: o servidor gastava a CPU em consultas ao banco
 * — cada consulta custa CPU no processo do Node (motor do Prisma), mesmo
 * quando o banco responde rápido — e a maior parte delas relia, a cada 3–8 s,
 * um dado que muda uma vez por semana.
 *
 * A REGRA de quem usa: só dado de configuração, com validade de segundos. O
 * pior caso é a mudança valer alguns segundos depois. NUNCA pedido novo,
 * status, pausa de item ou fila de impressão — isso é sempre lido na hora.
 * Também vale com duas instâncias: cada uma tem o seu, e nenhuma depende de
 * avisar a outra.
 *
 * A promessa fica guardada (duas chamadas ao mesmo tempo fazem UMA consulta);
 * se ela falhar, sai do cache na hora — erro não é guardado.
 */

const guardados = new Map<string, { ate: number; valor: Promise<unknown> }>();
const TETO_DE_CHAVES = 5000;

export function lembrarPor<T>(chave: string, validadeMs: number, buscar: () => Promise<T>): Promise<T> {
  const agora = Date.now();
  const guardado = guardados.get(chave);
  if (guardado && guardado.ate > agora) return guardado.valor as Promise<T>;

  if (guardados.size >= TETO_DE_CHAVES) {
    for (const [k, v] of guardados) if (v.ate <= agora) guardados.delete(k);
    if (guardados.size >= TETO_DE_CHAVES) guardados.clear();
  }

  const valor = buscar();
  const entrada = { ate: agora + validadeMs, valor };
  guardados.set(chave, entrada);
  valor.catch(() => {
    if (guardados.get(chave) === entrada) guardados.delete(chave);
  });
  return valor;
}

/** Esquece uma chave (quem acabou de gravar o dado). */
export function esquecer(chave: string): void {
  guardados.delete(chave);
}

/** Esquece tudo — para teste que troca a config e quer o efeito "passou a validade". */
export function esquecerTudo(): void {
  guardados.clear();
}
