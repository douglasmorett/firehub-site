/**
 * /src/lib/pagamento-online.ts
 *
 * Interruptor único do pagamento online (Pix e cartão pelo cardápio).
 *
 * DESLIGADO por padrão, de propósito. Motivo, verificado em produção:
 *
 *   - a credencial do Mercado Pago em uso é de CONTA DE TESTE
 *     (TESTUSER3392833288207419405 / test_user_…@testuser.com), então cartão
 *     real é recusado e o QR do Pix não é pagável por banco nenhum;
 *   - nenhuma loja tem conta de recebimento conectada, então qualquer cobrança
 *     que passasse cairia na conta do FireHub — receber em nome de terceiros é
 *     vedado pelos Termos do Mercado Pago;
 *   - o fluxo de saque do lojista não grava nem transfere nada.
 *
 * Enquanto isso, as formas de pagamento online não aparecem para o cliente no
 * cardápio, e as rotas de cobrança recusam. O cardápio continua funcionando
 * normalmente com pagamento na entrega.
 *
 * PARA RELIGAR: definir NEXT_PUBLIC_PAGAMENTO_ONLINE=true no Coolify e fazer
 * novo build (variável NEXT_PUBLIC_ é embutida em tempo de build). Antes de
 * religar, confirme os três pontos acima — o interruptor não conserta nenhum
 * deles, só para de esconder.
 */
export const PAGAMENTO_ONLINE_ATIVO =
  process.env.NEXT_PUBLIC_PAGAMENTO_ONLINE === "true";

/** Resposta padrão das rotas de cobrança enquanto o pagamento online está off. */
export const MOTIVO_PAGAMENTO_ONLINE_OFF =
  "Pagamento online indisponível no momento. Finalize o pedido escolhendo pagamento na entrega.";
