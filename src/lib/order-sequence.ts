/**
 * src/lib/order-sequence.ts
 *
 * Algoritmo Definitivo de Numeração Sequencial do FireHub (Simplificado):
 * 1. A numeração do pedido é GERADA NA CRIAÇÃO DO PEDIDO e gravada no banco (`dailyOrderNumber`).
 * 2. Essa numeração JAMAIS muda, independentemente de abertura/fechamento de caixa.
 * 3. O recálculo dinâmico baseado em sessão de caixa foi REMOVIDO para evitar mutação indesejada.
 */

export function buildSessionOrderNumberMap(
  orders: any[],
  cashSessionsOrOpenedAt?: any[] | Date | string | null,
  timeZone: string = "America/Sao_Paulo"
) {
  const map = new Map<string, number>();

  orders.forEach((o: any) => {
    if (o.dailyOrderNumber && typeof o.dailyOrderNumber === "number") {
      map.set(o.id, o.dailyOrderNumber);
    } else {
      // Fallback seguro apenas para pedidos muito antigos que não tenham dailyOrderNumber no banco
      // Usamos os últimos 4 caracteres do ID convertidos para um número (ou NaN/fallback visual)
      const fallbackNum = parseInt(o.id.slice(-4), 16) % 10000;
      map.set(o.id, fallbackNum);
    }
  });

  return map;
}

export function applyUnifiedDailyOrderNumbers(
  orders: any[],
  cashSessionsOrOpenedAt?: any[] | Date | string | null,
  timeZone: string = "America/Sao_Paulo"
) {
  const seqMap = buildSessionOrderNumberMap(orders, cashSessionsOrOpenedAt, timeZone);
  return orders.map((o: any) => ({
    ...o,
    dailyOrderNumber: o.dailyOrderNumber || seqMap.get(o.id) || null,
  }));
}


