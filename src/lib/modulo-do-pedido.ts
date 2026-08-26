/**
 * /src/lib/modulo-do-pedido.ts
 *
 * De onde veio o pedido, do ponto de vista de QUEM IMPRIME.
 *
 * A loja pensa em dois mundos, e eles têm impressoras diferentes:
 *
 *   SALÃO     — o cliente está aqui dentro. Balcão, mesa e totem. A comanda vai
 *               para a cozinha e, muitas vezes, uma via para o caixa.
 *   DELIVERY  — o pedido chegou de fora: cardápio online (entrega ou retirada),
 *               iFood, JotaJá, 99Food, WhatsApp. Costuma precisar da via com
 *               endereço, que na mesa não faz sentido nenhum.
 *
 * Antes, a única coisa que separava impressoras era a lista de CATEGORIAS, e
 * categoria não sabe de onde o pedido veio: a mesma impressora do balcão cuspia
 * a comanda do iFood no meio do salão, e não havia como dizer "esta aqui é só
 * para o delivery".
 */

export type ModuloDePedido = "salao" | "delivery";

/**
 * Origens que significam "o cliente está aqui dentro".
 *
 * `PRESENCIAL` cobre balcão E mesa — as duas rotas gravam essa mesma palavra
 * (orders/presencial e table-sessions/[id]/add-order). `TOTEM` entra porque o
 * quiosque é autoatendimento no salão: quem monta o pedido é a mesma cozinha,
 * e não existe endereço para entregar.
 */
export const FONTES_DO_SALAO = ["PRESENCIAL", "PDV", "BALCAO", "MESA", "TOTEM"];

/**
 * Em qual mundo este pedido cai.
 *
 * O que não for reconhecido como salão vira DELIVERY de propósito: é o mundo
 * que precisa de endereço e de via do entregador, e imprimir demais é menos
 * grave do que a comanda de uma origem nova não sair de lugar nenhum.
 */
export function moduloDoPedido(source: string | null | undefined): ModuloDePedido {
  const s = (source || "").trim().toUpperCase();
  return FONTES_DO_SALAO.includes(s) ? "salao" : "delivery";
}

/**
 * Esta impressora atende este mundo?
 *
 * Lista VAZIA ou ausente = atende os dois. É o que mantém funcionando toda loja
 * que já configurou impressora antes desta opção existir: ninguém acorda com a
 * impressora muda porque um campo novo apareceu.
 */
export function impressoraAtendeModulo(
  modulos: ModuloDePedido[] | null | undefined,
  modulo: ModuloDePedido
): boolean {
  if (!Array.isArray(modulos) || modulos.length === 0) return true;
  return modulos.includes(modulo);
}

/** Nome e explicação de cada mundo, para a tela não inventar texto próprio. */
export const MODULOS: { chave: ModuloDePedido; emoji: string; nome: string; explica: string }[] = [
  {
    chave: "salao",
    emoji: "🍽️",
    nome: "Balcão e mesa",
    explica: "Pedidos feitos aqui dentro: atendimento no balcão, comanda de mesa e totem.",
  },
  {
    chave: "delivery",
    emoji: "🛵",
    nome: "Delivery e retirada",
    explica: "Pedidos que chegam de fora: seu cardápio online, iFood, JotaJá, 99Food e WhatsApp.",
  },
];
