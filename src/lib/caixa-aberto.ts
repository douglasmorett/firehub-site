/**
 * Sem caixa aberto não se lança venda presencial.
 *
 * ── Por que a trava existe ──────────────────────────────────────────────────
 *
 * Venda de balcão, mesa e delivery lançado no PDV é dinheiro que entra pela
 * mão do atendente. Sem uma sessão de caixa aberta esse dinheiro não tem onde
 * ser registrado: o fechamento do dia não fecha, e a diferença aparece como
 * falta no relatório — o furo que ninguém explica no fim do mês.
 *
 * A mesma trava já existia no TOTEM desde antes (api/totem/order), pelo mesmo
 * motivo e com a mesma conta. O que faltava era ela valer para quem lança pelo
 * PDV, que é de onde vem a maior parte do dinheiro vivo.
 *
 * ── O que a trava NÃO faz ───────────────────────────────────────────────────
 *
 * Não fecha a loja, não bloqueia pedido do site, do WhatsApp, do iFood, do
 * 99Food nem de nenhuma integração: aquilo entra sozinho, a loja não escolheu
 * a hora, e recusar seria perder venda de verdade. Ela vale só para o que
 * alguém digita no PDV — que é exatamente o que precisa do caixa aberto.
 *
 * Também NÃO apaga o carrinho. O atendente abre o caixa em outra aba, volta e
 * finaliza o mesmo pedido: a regra do totem já era essa ("a tela não some, o
 * carrinho não se perde"), e aqui vale igual.
 *
 * ── Browser-safe de propósito ───────────────────────────────────────────────
 *
 * Só texto, sem prisma: a tela do PDV é componente de cliente e importar o
 * banco daqui o arrastaria para o pacote do navegador. Quem consulta o banco é
 * lib/caixa-aberto-servidor.ts, como em loja-de-origem / lojas-de-origem-da-conta.
 */

/** A frase que a tela e a API dizem — a MESMA, para ninguém traduzir uma na outra. */
export const MENSAGEM_CAIXA_FECHADO =
  "Seu caixa está fechado. Abra o caixa primeiro para poder lançar pedidos — sem ele o dinheiro desta venda não entra no fechamento do dia.";

/** O código que a tela reconhece para oferecer o atalho de abrir o caixa. */
export const ERRO_CAIXA_FECHADO = "caixa_fechado";

/** Onde o atendente abre o caixa. */
export const CAMINHO_DO_CAIXA = "/store/caixa";
