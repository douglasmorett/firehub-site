/**
 * QUANDO a comanda sai — a regra num lugar só.
 *
 * ── O que a loja pediu ──────────────────────────────────────────────────────
 *
 * Por padrão a comanda é impressa assim que o pedido entra. Algumas cozinhas
 * querem o contrário: montar o pedido primeiro na tela do KDS e só imprimir
 * quando ele for FINALIZADO lá — o papel vira a etiqueta do que já está pronto
 * para sair, em vez da ordem de produção. É o interruptor
 * `imprimirSoNoFimDoKds` na configuração de impressoras.
 *
 * ── Por que a regra mora aqui e não em cada lugar ───────────────────────────
 *
 * Existem TRÊS caminhos que imprimem sozinhos, e eles não se conhecem:
 *
 *   1. a fila da nuvem (`GET /api/store/print-queue`), que o Assistente
 *      consulta a cada 3 s — funciona com o painel fechado;
 *   2. o `GlobalPrintListener`, em qualquer aba aberta do painel;
 *   3. o poll do próprio painel de pedidos (`StoreOrdersDashboard`).
 *
 * Se um só deles não souber da regra, a comanda sai adiantada por ali e a
 * opção não significa nada — pior, significa "às vezes". O arquivo existe para
 * que os três façam a MESMA pergunta. É o mesmo motivo de lib/canal-do-pedido.ts.
 *
 * ── O risco que esta opção carrega ──────────────────────────────────────────
 *
 * Medido em 16/09/2026: de 16 lojas com movimento, 8 NUNCA finalizaram um
 * pedido no KDS (a TAURUS tem 1.066 pedidos e 0 finalizações). Numa loja
 * assim, ligar isto faz a impressão parar por completo — e o sintoma é
 * "a impressora parou", que manda o lojista procurar defeito no lugar errado.
 *
 * Daí duas decisões deste arquivo:
 *   - o padrão é DESLIGADO, e ausente conta como desligado;
 *   - `motivoDaEspera()` devolve a frase pronta para a tela e para o log, para
 *     que "não imprimiu" sempre venha acompanhado do porquê.
 */

/** O pedaço da configuração de impressoras que interessa aqui. */
export type ConfigDeMomento = {
  imprimirSoNoFimDoKds?: boolean;
} | null | undefined;

/** O pedido, com o que basta para decidir. */
export type PedidoParaMomento = {
  kdsStage?: string | null;
  status?: string | null;
};

/** O KDS considera o pedido pronto. É o único estado que libera a impressão. */
const FINALIZADO_NO_KDS = "FINISHED";

/**
 * A loja pediu para segurar a comanda até o KDS finalizar?
 * Ausente = não, que é como toda loja funcionava antes desta opção existir.
 */
export function esperaOFimDoKds(config: ConfigDeMomento): boolean {
  return config?.imprimirSoNoFimDoKds === true;
}

/**
 * true = a comanda NÃO deve sair agora; o pedido ainda está na cozinha.
 *
 * Só olha o KDS. Cancelado, rascunho e afins continuam sendo barrados onde já
 * eram — cada caminho tem a sua lista, e duplicá-la aqui só criaria uma
 * segunda régua para ficar fora de sincronia.
 */
export function aguardandoFimDoKds(
  pedido: PedidoParaMomento | null | undefined,
  config: ConfigDeMomento
): boolean {
  if (!esperaOFimDoKds(config)) return false;
  if (!pedido) return false;
  return String(pedido.kdsStage || "").toUpperCase() !== FINALIZADO_NO_KDS;
}

/**
 * A frase que explica a espera, para a tela e para o log. Nula quando não há
 * espera nenhuma.
 *
 * "Não saiu comanda" é o tipo de sintoma que faz o lojista trocar cabo, trocar
 * impressora e ligar reclamando. Se a causa é uma opção que ele mesmo ligou,
 * isso tem que estar escrito em algum lugar que ele alcança.
 */
export function motivoDaEspera(
  pedido: PedidoParaMomento | null | undefined,
  config: ConfigDeMomento
): string | null {
  if (!aguardandoFimDoKds(pedido, config)) return null;
  return "A comanda sai quando a cozinha finalizar o pedido no KDS (opção ligada em Impressoras).";
}
