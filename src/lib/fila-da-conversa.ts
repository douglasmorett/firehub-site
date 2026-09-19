/**
 * Rajada de mensagens: juntar o que o cliente mandou picado e atender UMA
 * conversa de cada vez.
 *
 * ── Por que isto existe ─────────────────────────────────────────────────────
 *
 * Ninguém escreve no WhatsApp em uma mensagem só. É "oi", "quero 2 x-tudo",
 * "e uma coca" — três mensagens em cinco segundos. O webhook tratava cada uma
 * como um atendimento independente, e disso saíam dois defeitos:
 *
 * 1) DESCARTE. Um cooldown de 3 s jogava fora, em silêncio, a mensagem que
 *    chegasse logo depois de uma resposta do robô — inclusive áudio. Não ia
 *    para o histórico, não era respondida, não aparecia em rastro nenhum.
 *
 * 2) ATROPELO. O cooldown só era marcado quando a resposta SAÍA. Enquanto a IA
 *    pensava na mensagem 1 (3–5 s de "leitura" + até 25 s de modelo), a 2 e a
 *    3 entravam em paralelo: três chamadas de IA, nenhuma vendo as outras no
 *    histórico, três respostas fora de ordem — e três gravações do rascunho
 *    disputando o mesmo pedido (cada uma apaga os itens e recria).
 *
 * ── Como funciona ───────────────────────────────────────────────────────────
 *
 * Cada mensagem ENTRA na rajada da conversa e espera um instante. Se chegou
 * outra depois dela, ela sai de cena: a mais nova carrega o texto de todas.
 * A última pega a VEZ da conversa (uma fila por conversa — quem está sendo
 * atendido termina antes) e só então TIRA da rajada tudo o que se acumulou,
 * inclusive o que chegou enquanto ela esperava a vez.
 *
 * A vez tem TETO: se quem está na frente travar, o próximo não espera para
 * sempre — conversa muda é pior que duas respostas.
 *
 * Arquivo puro, sem imports: tem teste que o carrega sozinho
 * (scripts/teste-fila-da-conversa.mjs). O estado mora em quem cria a fila; o
 * webhook guarda a dele em globalThis, como a pausa do robô.
 */

export type Rajadas<T> = {
  /** Põe a mensagem na rajada da conversa. Devolve a senha dela. */
  entrar(chave: string, item: T): number;
  /** Chegou mensagem mais nova nesta conversa depois da senha dada? */
  chegouOutraDepois(chave: string, senha: number): boolean;
  /**
   * Tira o que está acumulado na conversa, na ordem de chegada, para quem tem a
   * senha dada carregar. Para ANTES da primeira "barreira" que não seja a
   * própria mensagem de quem tira — o resto fica para o dono dela.
   *
   * A barreira existe por causa do ÁUDIO: o texto de um áudio é um marcador
   * igual em todos, e os bytes só existem na chamada que o recebeu. Se uma
   * mensagem de texto levasse o marcador junto, o modelo leria "o cliente
   * mandou um áudio" sem áudio nenhum, e a chamada do áudio encontraria a
   * rajada vazia: o áudio se perderia.
   */
  tirar(chave: string, senha: number, ehBarreira?: (item: T) => boolean): T[];
  /**
   * Espera a vez desta conversa e devolve a função que a libera. Chame SEMPRE
   * a liberação (use try/finally). Depois de `tetoMs` esperando, passa na
   * frente mesmo assim.
   */
  vez(chave: string, tetoMs: number): Promise<() => void>;
  /** Conversas com algo guardado (rajada ou fila) — para teste de vazamento. */
  tamanho(): number;
};

export function criarRajadas<T>(): Rajadas<T> {
  const rajadas = new Map<string, Array<{ senha: number; item: T }>>();
  const ultimaSenha = new Map<string, number>();
  const caudas = new Map<string, Promise<void>>();
  let contador = 0;

  return {
    entrar(chave, item) {
      const senha = ++contador;
      const lista = rajadas.get(chave);
      if (lista) lista.push({ senha, item });
      else rajadas.set(chave, [{ senha, item }]);
      ultimaSenha.set(chave, senha);
      return senha;
    },

    chegouOutraDepois(chave, senha) {
      return (ultimaSenha.get(chave) || 0) > senha;
    },

    tirar(chave, senha, ehBarreira) {
      const lista = rajadas.get(chave) || [];
      let corte = lista.length;
      if (ehBarreira) {
        const i = lista.findIndex((e) => e.senha !== senha && ehBarreira(e.item));
        if (i >= 0) corte = i;
      }
      const levados = lista.slice(0, corte);
      const ficam = lista.slice(corte);
      if (ficam.length > 0) rajadas.set(chave, ficam);
      else rajadas.delete(chave);
      // `ultimaSenha` fica só enquanto houver fila ou rajada para a conversa;
      // sem as duas, ninguém mais vai perguntar por ela.
      if (ficam.length === 0 && !caudas.has(chave)) ultimaSenha.delete(chave);
      return levados.map((e) => e.item);
    },

    vez(chave, tetoMs) {
      const anterior = caudas.get(chave) || Promise.resolve();
      let soltar!: () => void;
      const atendimento = new Promise<void>((r) => { soltar = r; });

      // Minha vez chega quando quem está na frente termina — OU quando o teto
      // vence. Quem vem DEPOIS de mim espera por MIM, não por quem travou: sem
      // isso, um atendimento pendurado faria toda mensagem futura desta
      // conversa esperar o teto inteiro, para sempre.
      const minhaVez = new Promise<void>((chegou) => {
        const relogio = setTimeout(chegou, Math.max(0, tetoMs));
        anterior.then(() => { clearTimeout(relogio); chegou(); });
      });
      const cauda = minhaVez.then(() => atendimento);
      caudas.set(chave, cauda);
      cauda.then(() => {
        if (caudas.get(chave) === cauda) {
          caudas.delete(chave);
          if (!rajadas.has(chave)) ultimaSenha.delete(chave);
        }
      });

      let solto = false;
      return minhaVez.then(() => () => {
        if (solto) return;
        solto = true;
        soltar();
      });
    },

    tamanho() {
      return new Set([...rajadas.keys(), ...caudas.keys(), ...ultimaSenha.keys()]).size;
    },
  };
}

/** Junta os textos de uma rajada numa mensagem só, sem repetir linha igual seguida. */
export function juntarTextos(textos: Array<string | null | undefined>): string {
  const saida: string[] = [];
  for (const t of textos) {
    const limpo = String(t ?? "").trim();
    if (!limpo) continue;
    if (saida.length > 0 && saida[saida.length - 1] === limpo) continue;
    saida.push(limpo);
  }
  return saida.join("\n");
}
