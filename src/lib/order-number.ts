import { prisma } from "@/lib/prisma";
import { formatInTimeZone } from "date-fns-tz";

export async function generateDailyOrderNumber(franchiseeId: string): Promise<number> {
  const now = new Date();
  
  // Pegamos o início do dia atual considerando o fuso de São Paulo
  const startOfDayString = formatInTimeZone(now, "America/Sao_Paulo", "yyyy-MM-dd'T'00:00:00.000XXX");
  const startOfDay = new Date(startOfDayString);

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
