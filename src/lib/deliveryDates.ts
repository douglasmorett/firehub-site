import { prisma } from "./prisma";

function formatDateTime(date: Date) {
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// Retorna o próximo dia X na semana (0 = Domingo, 1 = Segunda, etc.)
function getNextDayOfWeek(date: Date, targetDayOfWeek: number, pushToNextWeek: boolean = false): Date {
  const result = new Date(date);
  let diff = (7 + targetDayOfWeek - date.getDay()) % 7;
  if (diff === 0 && pushToNextWeek) {
    diff = 7;
  }
  result.setDate(result.getDate() + diff);
  return result;
}

export async function getNextDeliveryInfo(city: string | null): Promise<{ limitStr: string; deliveryStr: string; limitDateIso?: string }> {
  if (!city) return { limitStr: "Consulte o suporte", deliveryStr: "A definir" };

  const schedules = await prisma.routeSchedule.findMany({
    where: { cityName: city }
  });

  if (schedules.length === 0) {
    return { limitStr: "Rota não cadastrada", deliveryStr: "A definir" };
  }

  const now = new Date();
  const day = now.getDay();
  const hour = now.getHours();

  // Calcula todas as próximas rotas disponíveis
  const upcomingDeliveries = schedules
    .filter(schedule => typeof schedule.deliveryDay === "number")
    .map(schedule => {
      const dDay = schedule.deliveryDay as number;
      let limitDay = (dDay - 2 + 7) % 7;
      const limitHour = 16;

      let limitDate = new Date(now);
      
      if (day > limitDay || (day === limitDay && hour >= limitHour)) {
        limitDate = getNextDayOfWeek(now, limitDay, true);
      } else {
        limitDate = getNextDayOfWeek(now, limitDay, false);
        if (day === limitDay) {
          limitDate = new Date(now);
        }
      }
      
      limitDate.setHours(limitHour, 0, 0, 0);

      const deliveryDate = getNextDayOfWeek(limitDate, dDay, limitDay === dDay);

      return {
        limitDay,
        limitHour,
        deliveryDay: dDay,
        limitDate,
        deliveryDate
      };
    });

  if (upcomingDeliveries.length === 0) {
    return { limitStr: "Rota não disponível", deliveryStr: "A definir" };
  }

  upcomingDeliveries.sort((a, b) => a.deliveryDate.getTime() - b.deliveryDate.getTime());
  
  const nextRoute = upcomingDeliveries[0];
  const diasSemana = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];

  return {
    limitStr: `${diasSemana[nextRoute.limitDay]} até as ${nextRoute.limitHour}h (${formatDateTime(nextRoute.limitDate)})`,
    deliveryStr: `${diasSemana[nextRoute.deliveryDay]} (${formatDateTime(nextRoute.deliveryDate)})`,
    limitDateIso: nextRoute.limitDate.toISOString()
  };
}
