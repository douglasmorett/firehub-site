/**
 * /src/lib/telas-sem-widget.ts
 *
 * Regra única de "aqui nenhum botão flutuante pode aparecer".
 *
 * São as telas de OPERAÇÃO: alguém trabalhando com o cliente na frente, ou o
 * próprio cliente comprando. Todas usam o canto inferior direito para o que
 * importa — o Total da mesa, o "Enviar Pedido", o "Ver carrinho" do totem — e
 * um widget fixo com z-index alto fica exatamente por cima disso. O dedo mira o
 * total e abre um chat.
 *
 * Por que virou arquivo: a lista existia dentro do FloatingContactWidget e o
 * widget de suporte não conhecia nenhuma delas. Resultado: o mesmo botão que
 * sumia no balcão continuava tapando o total da mesa, e ninguém tinha como
 * saber que havia duas regras diferentes para a mesma decisão.
 */

/** Prefixos de rota onde nenhum widget flutuante deve ser montado. */
export const TELAS_SEM_WIDGET = [
  /** Mesa do garçom: o widget tapava o Total e o "Fechar Conta". */
  "/store/mesas",
  /** A mesma tela de mesa, pelo link próprio do garçom. */
  "/garcom",
  /** Balcão (PDV presencial). */
  "/store/venda-presencial",
  /** KDS: tela de cozinha, ninguém conversa por ali. */
  "/store/kds",
  /** Totem: é o CLIENTE na frente, e o widget é a venda do FireHub ao lojista. */
  "/totem",
];

export function ehTelaSemWidget(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return TELAS_SEM_WIDGET.some((rota) => pathname.startsWith(rota));
}
