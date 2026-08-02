/**
 * src/lib/order-sequence.ts
 *
 * Algoritmo Definitivo de Numeração Sequencial do FireHub:
 * 1. Pedidos do Caixa Atual (status OPEN): iniciam em #1, #2, #3, #4, #5... para a nova sessão.
 * 2. Pedidos Anteriores ao Caixa Atual: MANTÊM RIGOROSAMENTE SEUS NÚMEROS ORIGINAIS (ex: Kim Sá = #195, Junior = #200).
 * 3. NENHUM fechamento ou reabertura de caixa altera os números dos pedidos já criados no passado.
 */

export function buildSessionOrderNumberMap(orders: any[], cashSessions: any[] = []) {
  const map = new Map<string, number>();

  // 1. Respeita dailyOrderNumber se explicitamente gravado no objeto do pedido
  orders.forEach((o: any) => {
    if (o.dailyOrderNumber && typeof o.dailyOrderNumber === "number") {
      map.set(o.id, o.dailyOrderNumber);
    }
  });

  const sortedOrders = [...orders].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  // Encontrar a sessão ATIVA atualmente aberta (status OPEN)
  const openSession = cashSessions.find((s) => s.status === "OPEN");
  const openSessionStart = openSession ? new Date(openSession.openedAt).getTime() : null;

  // Separar pedidos em:
  // A) Pedidos passados (criados ANTES da abertura do caixa atual) -> Mantêm sequência original contínua do turno (#1 ... #195, #200)
  // B) Pedidos da sessão atual (criados DEPOIS da abertura do caixa atual) -> Iniciam em #1, #2, #3...

  const pastOrders = openSessionStart
    ? sortedOrders.filter((o) => new Date(o.createdAt).getTime() < openSessionStart)
    : sortedOrders;

  const currentSessionOrders = openSessionStart
    ? sortedOrders.filter((o) => new Date(o.createdAt).getTime() >= openSessionStart)
    : [];

  // Mapear pedidos passados continuos (respeitando o fuso horário de Brasília / turno de 5h)
  const shiftCounters = new Map<string, number>();
  pastOrders.forEach((o: any) => {
    if (!map.has(o.id)) {
      const shiftTime = new Date(new Date(o.createdAt).getTime() - 5 * 60 * 60 * 1000);
      const shiftKey = shiftTime.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }).split(",")[0];
      const nextSeq = (shiftCounters.get(shiftKey) || 0) + 1;
      shiftCounters.set(shiftKey, nextSeq);
      map.set(o.id, nextSeq);
    }
  });

  // Mapear pedidos da sessão atual a partir de #1, #2, #3...
  currentSessionOrders.forEach((o: any, idx: number) => {
    if (!map.has(o.id)) {
      map.set(o.id, idx + 1);
    }
  });

  return map;
}
