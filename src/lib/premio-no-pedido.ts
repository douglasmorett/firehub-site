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
 *
 * ── Uma lista de pedidos para os três lados ──────────────────────────────────
 *
 * O prêmio do pedido (premioDoCliente), o progresso que o cardápio mostra
 * (api/store-customer) e a trilha na ficha do cliente no painel (aba Clientes)
 * leem os pedidos por `pedidosDaTrilhaDoTelefone`. Três consultas iguais
 * copiadas eram três números que um dia deixariam de bater.
 */

import { prisma } from "./prisma";
import { ondeEstaoOsPedidosDoTelefone, PEDIDOS_DA_TRILHA } from "./pedidos-do-telefone";
import {
  lerTrilha,
  premioDaVez,
  resumoDaTrilha,
  trilhaValida,
  type ParadaDaTrilha,
  type PedidoDaTrilha,
  type ResumoDaTrilha,
} from "./trilha-premiada";

/** Os pedidos deste telefone que a trilha lê, do mais novo para o mais velho. */
export async function pedidosDaTrilhaDoTelefone(franchiseeId: string, telefone: string): Promise<PedidoDaTrilha[]> {
  return prisma.customerOrder.findMany({
    where: ondeEstaoOsPedidosDoTelefone(franchiseeId, telefone),
    orderBy: { createdAt: "desc" },
    take: PEDIDOS_DA_TRILHA,
    // O canal sai de lib/canal-do-pedido.ts, que precisa destes campos: sem
    // eles todo pedido viraria SITE e o filtro de canais da trilha não teria
    // o que filtrar.
    select: {
      id: true, createdAt: true, status: true, source: true, trilhaPremio: true,
      ifoodOrderId: true, openDeliveryChannel: true, openDeliveryOrderId: true,
      tableSessionId: true,
    },
  });
}

const digitosDe = (telefone: string) => String(telefone || "").replace(/\D/g, "");

/** O prêmio que este telefone tem a receber nesta loja, ou `null`. */
export async function premioDoCliente(
  franchiseeId: string,
  storeLoyalty: unknown,
  telefone: string,
): Promise<ParadaDaTrilha | null> {
  const trilha = lerTrilha(storeLoyalty);
  if (!trilhaValida(trilha)) return null;
  if (digitosDe(telefone).length < 8) return null;
  return premioDaVez(trilha, await pedidosDaTrilhaDoTelefone(franchiseeId, telefone));
}

/**
 * Onde este telefone está na trilha desta loja — o que o cardápio recebe
 * (api/store-customer GET). `null` quando a loja não tem trilha no ar.
 */
export async function trilhaDoTelefone(
  franchiseeId: string,
  storeLoyalty: unknown,
  telefone: string,
  agora: Date = new Date(),
): Promise<ResumoDaTrilha | null> {
  const trilha = lerTrilha(storeLoyalty);
  if (!trilhaValida(trilha)) return null;
  if (digitosDe(telefone).length < 8) return null;
  return resumoDaTrilha(trilha, await pedidosDaTrilhaDoTelefone(franchiseeId, telefone), agora);
}
