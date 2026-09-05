/**
 * As grafias de status de pedido, num lugar só.
 *
 * O sistema grava "CANCELADO" (156 ocorrências na base), mas caminhos antigos
 * gravaram "CANCELLED" (15x) e "CANCELED" (18x). Toda lista repetida à mão
 * esquecia uma das três — o GET do app do motoboy filtrava só as grafias
 * inglesas, e um pedido cancelado com motoboy atribuído era reenviado ao
 * celular do entregador a cada 10 segundos, para sempre.
 */
export const STATUS_CANCELADOS = ["CANCELADO", "CANCELLED", "CANCELED"] as const;

export const STATUS_FINALIZADOS = ["ENTREGUE", "ENCERRADO"] as const;

/**
 * Status em que um pedido ainda aceita entregador. WHITELIST de propósito:
 * o que não está aqui não é puxável — status novo entra fechado, não aberto.
 * AGUARDANDO_PAGAMENTO e CRIANDO_IA ficam fora (mesma regra da fila de
 * impressão): pedido que ainda não é pedido não vai para a rua.
 */
export const STATUS_PUXAVEIS = [
  "NOVO", "CONFIRMADO", "RECEBIDO", "PENDENTE", "ACEITO",
  "PREPARANDO", "EM_PREPARO", "EM_ANDAMENTO", "PRONTO",
  "SAIU_ENTREGA", "SAIU_PARA_ENTREGA", "EM_ROTA",
] as const;
