/**
 * Lê do banco o que o ranking de entregadores precisa (a conta é de
 * lib/relatorios/ranking-de-entregadores.ts). Uma leitura só para a loja
 * (Motoboys › Ranking e o relatório) e para o app do entregador — os dois
 * lados veem o mesmo número.
 *
 * Os pedidos do período pela CRIAÇÃO, na janela do dia operacional, só os que
 * têm motoboy da loja. Os motoboys inativos entram para o nome: quem saiu da
 * equipe ontem ainda fez as entregas da semana.
 */
import { prisma } from "@/lib/prisma";
import { rankingDeEntregadores, type ResultadoDoRanking } from "@/lib/relatorios/ranking-de-entregadores";

export async function lerRankingDeEntregadores(lojaIds: string[], janela: { inicio: Date; fim: Date }, tz: string | null | undefined): Promise<ResultadoDoRanking> {
  const [pedidos, motoboys] = await Promise.all([
    prisma.customerOrder.findMany({
      where: {
        franchiseeId: { in: lojaIds },
        motoboyId: { not: null },
        createdAt: { gte: janela.inicio, lt: janela.fim },
      },
      select: {
        id: true, motoboyId: true, status: true, createdAt: true, readyAt: true, dispatchedAt: true,
        deliveredAt: true, cancelledAt: true, motoboyPuxadoEm: true, routeId: true, scheduledDatetime: true,
        tempoEntregaMin: true, deliveryType: true, deliveryDistance: true, rating: true,
      },
    }),
    prisma.motoboy.findMany({ where: { franchiseeId: { in: lojaIds } }, select: { id: true, name: true } }),
  ]);
  return rankingDeEntregadores(pedidos, motoboys, tz);
}
