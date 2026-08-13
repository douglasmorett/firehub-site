import { prisma } from "@/lib/prisma";

export async function generateDailyOrderNumber(franchiseeId: string): Promise<number> {
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

  // Busca o último pedido do dia para esta loja que tenha dailyOrderNumber
  const lastOrder = await prisma.customerOrder.findFirst({
    where: { 
      franchiseeId, 
      createdAt: { gte: startOfDay },
      dailyOrderNumber: { not: null }
    },
    orderBy: { createdAt: "desc" },
    select: { dailyOrderNumber: true }
  });

  if (lastOrder && lastOrder.dailyOrderNumber !== null) {
    return lastOrder.dailyOrderNumber + 1;
  }

  // Se for o primeiro do dia
  return 1;
}

