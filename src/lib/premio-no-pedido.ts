/**
 * Quem tem prêmio a receber — a única parte da Trilha Premiada que fala com
 * o banco.
 *
 * A regra (quanto vale, se cabe no pedido) mora em lib/trilha-premiada.ts,
 * sem Prisma, e por isso pode ser provada em scripts/teste-trilha-premiada.mjs
 * sem subir banco nenhum.
 *
 * ── O cliente não escolhe o prêmio, e não manda o valor ──────────────────────
 *
 * /api/customer-order é rota PÚBLICA: tudo que vem no corpo é palpite do
 * navegador. Quem descobre qual prêmio está valendo é o servidor, relendo os
 * pedidos do telefone. O corpo da requisição só serve para o cliente DISPENSAR
 * o prêmio ("guarda para a próxima"), nunca para criar um.
 */

import { prisma } from "./prisma";
import { lerTrilha, premioDaVez, trilhaValida, type ParadaDaTrilha } from "./trilha-premiada";

/** O prêmio que este telefone tem a receber nesta loja, ou `null`. */
export async function premioDoCliente(
  franchiseeId: string,
  storeLoyalty: unknown,
  telefone: string,
): Promise<ParadaDaTrilha | null> {
  const trilha = lerTrilha(storeLoyalty);
  if (!trilhaValida(trilha)) return null;

  const digitos = String(telefone || "").replace(/\D/g, "");
  if (digitos.length < 8) return null;

  const pedidos = await prisma.customerOrder.findMany({
    where: {
      franchiseeId,
      OR: [{ customerPhone: { contains: digitos.slice(-8) } }, { customerPhone: digitos }],
    },
    orderBy: { createdAt: "desc" },
    take: 120,
    // O canal sai de lib/canal-do-pedido.ts, que precisa destes campos: sem
    // eles todo pedido viraria SITE e o filtro de canais da trilha não teria
    // o que filtrar.
    select: {
      id: true, createdAt: true, status: true, source: true, trilhaPremio: true,
      ifoodOrderId: true, openDeliveryChannel: true, openDeliveryOrderId: true,
      tableSessionId: true,
    },
  });

  return premioDaVez(trilha, pedidos);
}
