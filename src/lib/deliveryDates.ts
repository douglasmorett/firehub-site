import { prisma } from "./prisma";
import { FUSO_PADRAO } from "./fuso";

/**
 * Toda a conta abaixo é feita em "hora de parede" de Brasília: um Date cujos
 * campos UTC carregam o ano/mês/dia/hora que o relógio da distribuidora
 * mostra. Só os getters e setters UTC daqui para baixo — assim o resultado não depende
 * do fuso do processo. Antes era getDay()/getHours() no container (UTC): das
 * 21:00 às 23:59 o dia da semana já era o de amanhã e a rota pulava uma
 * semana; das 13:00 às 16:00 o corte "das 16h" já aparecia fechado.
 */
function paredeDeBrasilia(instante: Date): Date {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: FUSO_PADRAO, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(instante);
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value);
  return new Date(Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute")));
}

function formatDateTime(date: Date) {
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${date.getUTCFullYear()}`;
}

// Retorna o próximo dia X na semana (0 = Domingo, 1 = Segunda, etc.)
function getNextDayOfWeek(date: Date, targetDayOfWeek: number, pushToNextWeek: boolean = false): Date {
  const result = new Date(date);
  let diff = (7 + targetDayOfWeek - date.getUTCDay()) % 7;
  if (diff === 0 && pushToNextWeek) {
    diff = 7;
  }
  result.setUTCDate(result.getUTCDate() + diff);
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

  const instante = new Date();
  const now = paredeDeBrasilia(instante);
  // Quanto a parede está deslocada do instante real — para devolver o ISO
  // do corte como instante de verdade (16:00 de Brasília = 19:00Z).
  const deslocamento = instante.getTime() - now.getTime();
  const day = now.getUTCDay();
  const hour = now.getUTCHours();

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
      
      limitDate.setUTCHours(limitHour, 0, 0, 0);

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
    limitDateIso: new Date(nextRoute.limitDate.getTime() + deslocamento).toISOString()
  };
}
