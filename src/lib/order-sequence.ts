/**
 * src/lib/order-sequence.ts
 *
 * Algoritmo Definitivo de Numeração Sequencial do FireHub:
 * 1. Pedidos do Caixa Atual (status OPEN): iniciam em #1, #2, #3, #4, #5... para a nova sessão.
 * 2. Pedidos Anteriores ao Caixa Atual: MANTÊM RIGOROSAMENTE SEUS NÚMEROS ORIGINAIS (ex: Kim Sá = #195, Junior = #200).
 * 3. NENHUM fechamento ou reabertura de caixa altera os números dos pedidos já criados no passado.
 */

export function buildSessionOrderNumberMap(
  orders: any[],
  cashSessionsOrOpenedAt?: any[] | Date | string | null,
  timeZone: string = "America/Sao_Paulo"
) {
  const map = new Map<string, number>();

  const sortedOrders = [...orders].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  // Determinar a data de abertura da sessão de caixa ATIVA atualmente aberta (status OPEN)
  let openSessionStart: number | null = null;

  if (cashSessionsOrOpenedAt) {
    if (Array.isArray(cashSessionsOrOpenedAt)) {
      const openSession = cashSessionsOrOpenedAt.find((s) => s.status === "OPEN");
      if (openSession?.openedAt) {
        openSessionStart = new Date(openSession.openedAt).getTime();
      }
    } else {
      const parsedDate = new Date(cashSessionsOrOpenedAt).getTime();
      if (!isNaN(parsedDate)) {
        openSessionStart = parsedDate;
      }
    }
  }

  // Separar pedidos em:
  // A) Pedidos passados (criados ANTES da abertura do caixa atual) -> Mantêm sequência original contínua do turno
  // B) Pedidos da sessão atual (criados DEPOIS da abertura do caixa atual) -> Iniciam em #1, #2, #3... #20

  const isCountable = (o: any) => o.status !== "CRIANDO_IA" && o.status !== "AGUARDANDO_PAGAMENTO";

  const pastOrders = openSessionStart
    ? sortedOrders.filter((o) => new Date(o.createdAt).getTime() < openSessionStart && isCountable(o))
    : sortedOrders.filter(isCountable);

  const currentSessionOrders = openSessionStart
    ? sortedOrders.filter((o) => new Date(o.createdAt).getTime() >= openSessionStart && isCountable(o))
    : [];

  // 1. Mapear pedidos da sessão ATIVA primeiro (garante #1, #2, #3... #20 rigorosamente alinhados com a tela)
  currentSessionOrders.forEach((o: any, idx: number) => {
    map.set(o.id, idx + 1);
  });

  // 2. Mapear pedidos passados (se não estiverem no mapa, usa dailyOrderNumber ou contador do turno)
  const shiftCounters = new Map<string, number>();
  pastOrders.forEach((o: any) => {
    if (!map.has(o.id)) {
      if (o.dailyOrderNumber && typeof o.dailyOrderNumber === "number") {
        map.set(o.id, o.dailyOrderNumber);
      } else {
        const shiftTime = new Date(new Date(o.createdAt).getTime() - 5 * 60 * 60 * 1000);
        const shiftKey = shiftTime.toLocaleString("en-US", { timeZone }).split(",")[0];
        const nextSeq = (shiftCounters.get(shiftKey) || 0) + 1;
        shiftCounters.set(shiftKey, nextSeq);
        map.set(o.id, nextSeq);
      }
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
    dailyOrderNumber: seqMap.get(o.id) || o.dailyOrderNumber || null,
  }));
}

