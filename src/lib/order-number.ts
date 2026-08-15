import { prisma } from "@/lib/prisma";

/**
 * Gera o próximo dailyOrderNumber sequencial para uma loja.
 * 
 * REGRA DE OURO:
 * - Conta TODOS os pedidos do dia (não apenas os com dailyOrderNumber preenchido)
 * - Usa o MAIOR entre: total de pedidos e max dailyOrderNumber existente
 * - Roda em transação Serializable para evitar race conditions
 * - Se a transação falhar por conflito, faz retry automático
 */
export async function generateDailyOrderNumber(franchiseeId: string): Promise<number> {
  const MAX_RETRIES = 3;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const now = new Date();

        // Format current date in America/Sao_Paulo (YYYY-MM-DD)
        const spDateStr = new Intl.DateTimeFormat("en-CA", {
          timeZone: "America/Sao_Paulo",
          year: "numeric",
          month: "2-digit",
          day: "2-digit"
        }).format(now);

        // Start of day in Sao Paulo (-03:00)
        const startOfDay = new Date(`${spDateStr}T00:00:00-03:00`);

        // 1. Contar TODOS os pedidos do dia (incluindo os sem dailyOrderNumber)
        const totalToday = await tx.customerOrder.count({
          where: {
            franchiseeId,
            createdAt: { gte: startOfDay },
            // Excluir pedidos em rascunho que não devem contar na fila
            status: { notIn: ["CRIANDO_IA", "AGUARDANDO_PAGAMENTO"] },
          },
        });

        // 2. Buscar o MAIOR dailyOrderNumber do dia (proteção contra gaps)
        const maxOrder = await tx.customerOrder.findFirst({
          where: {
            franchiseeId,
            createdAt: { gte: startOfDay },
            dailyOrderNumber: { not: null },
          },
          orderBy: { dailyOrderNumber: "desc" },
          select: { dailyOrderNumber: true },
        });

        // 3. Próximo número = MAX(totalPedidos, maxDailyOrderNumber) + 1
        const maxExisting = maxOrder?.dailyOrderNumber || 0;
        return Math.max(totalToday, maxExisting) + 1;
      }, {
        isolationLevel: "Serializable" as any,
        timeout: 5000,
      });
    } catch (err: any) {
      // Serialization failure (PostgreSQL 40001) — retry
      if (attempt < MAX_RETRIES && (err.code === "P2034" || err.message?.includes("could not serialize"))) {
        await new Promise(r => setTimeout(r, 100 * attempt)); // backoff
        continue;
      }
      throw err;
    }
  }

  // Fallback seguro — nunca deveria chegar aqui
  throw new Error("generateDailyOrderNumber: max retries exceeded");
}

