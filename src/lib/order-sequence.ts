/**
 * src/lib/order-sequence.ts
 *
 * Algoritmo Definitivo de Numeração Sequencial do FireHub:
 * 1. A numeração do pedido é GERADA NA CRIAÇÃO DO PEDIDO e gravada no banco (`dailyOrderNumber`).
 * 2. Essa numeração JAMAIS muda.
 * 3. Fallbacks matemáticos pseudo-aleatórios e caches locais mutáveis foram removidos.
 */

export function getDisplayOrderNumber(order: any): string {
  if (!order) return "—";

  // 1. Fonte da verdade absoluta (banco de dados)
  if (order.dailyOrderNumber != null && typeof order.dailyOrderNumber === "number") {
    return String(order.dailyOrderNumber);
  }

  // 2. Fallbacks para pedidos antigos pré-atualização ou integrações que não passaram pelo gerador
  if (order.ifoodReference) return String(order.ifoodReference);
  if (order.openDeliveryReference) return String(order.openDeliveryReference);

  // 3. Último recurso seguro visual (nunca armazenado, apenas exibido)
  return order.id ? order.id.slice(-4).toUpperCase() : "—";
}

