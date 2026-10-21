import { prisma } from "@/lib/prisma";
import { isStoreOpen } from "@/lib/store-hours";
import { STATUS_CANCELADOS, STATUS_FINALIZADOS } from "@/lib/status-pedido";

/**
 * O GPS do entregador só roda no horário da loja.
 *
 * Com a localização obrigatória (App Motoboys › "Localização do entregador"),
 * o serviço do app ficava ligado o dia inteiro: os entregadores da Hakim
 * reclamaram de o celular mandar a posição fora do expediente (21/10/2026).
 * Fora do horário o servidor responde `foraDoHorario` e o app desliga o
 * serviço sozinho — inclusive no bolso, pela própria tarefa do GPS.
 *
 * Folga de 30 min antes de abrir (o entregador chega antes) e depois de fechar
 * (a última entrega sai depois). Entrega na mão dele nunca perde o mapa.
 * Loja sem horário cadastrado segue como antes: sempre.
 */
const FOLGA_MS = 30 * 60_000;
/** Pedido esquecido aberto há dias não pode manter o GPS ligado para sempre. */
const ENTREGA_RECENTE_MS = 12 * 60 * 60_000;

type HorarioDaLoja = { storeHours: unknown; storePause: unknown; storeTimezone: string | null };

export function horarioPedeGps(loja: HorarioDaLoja, agora: Date = new Date()): boolean {
  if (loja.storeHours == null) return true;
  return [0, FOLGA_MS, -FOLGA_MS].some(
    (d) => isStoreOpen(loja.storeHours, loja.storePause, loja.storeTimezone, new Date(agora.getTime() + d)).open,
  );
}

export async function gpsForaDoHorario(franchiseeId: string, motoboyId: string): Promise<boolean> {
  const loja = await prisma.user.findUnique({
    where: { id: franchiseeId },
    select: { storeHours: true, storePause: true, storeTimezone: true },
  });
  if (!loja || horarioPedeGps(loja)) return false;
  const emAndamento = await prisma.customerOrder.findFirst({
    where: {
      motoboyId,
      status: { notIn: [...STATUS_FINALIZADOS, ...STATUS_CANCELADOS] },
      createdAt: { gte: new Date(Date.now() - ENTREGA_RECENTE_MS) },
    },
    select: { id: true },
  });
  return !emAndamento;
}
