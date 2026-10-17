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
import { PEDIDOS_DA_TRILHA, PEDIDOS_DOS_CARIMBOS } from "./pedidos-do-telefone";
import { ondeEstaoOsPedidosDoTelefone } from "./pedidos-do-telefone-no-banco";
import {
  carimbosNoAr,
  contarCarimbos,
  efeitoDosCarimbos,
  lerCarimbos,
  type CartaoDeCarimbos,
  type EfeitoDosCarimbos,
  type PedidoDoCarimbo,
  type RegraDosCarimbos,
} from "./carimbos";
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
    where: await ondeEstaoOsPedidosDoTelefone(franchiseeId, telefone, PEDIDOS_DA_TRILHA),
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

// ── Cartão de carimbos ──────────────────────────────────────────────────────
//
// A mesma ideia da trilha: o servidor reconta o cartão dos pedidos do telefone
// (o histórico, não os 10 de "Meus pedidos") e decide se há prêmio a receber.
// O cardápio, a ficha do cliente, o checkout do site e o robô leem por aqui.

/** Os pedidos deste telefone que o cartão lê, do mais novo para o mais velho. */
export async function pedidosDosCarimbosDoTelefone(
  franchiseeId: string,
  telefone: string,
  excetoIds: string[] = [],
): Promise<PedidoDoCarimbo[]> {
  return prisma.customerOrder.findMany({
    where: await ondeEstaoOsPedidosDoTelefone(franchiseeId, telefone, PEDIDOS_DOS_CARIMBOS, excetoIds),
    orderBy: { createdAt: "desc" },
    take: PEDIDOS_DOS_CARIMBOS,
    // O canal sai de lib/canal-do-pedido.ts (marketplace não ganha carimbo).
    select: {
      id: true, createdAt: true, status: true, source: true, totalAmount: true, carimboPremio: true,
      ifoodOrderId: true, ifoodReference: true, openDeliveryChannel: true, openDeliveryOrderId: true,
      tableSessionId: true,
    },
  });
}

/**
 * O cartão deste telefone nesta loja, ou `null` quando o cartão não está no ar
 * (desligado, prêmio R$ 0, produto não escolhido). `excetoIds`: o pedido que
 * está sendo regravado (o rascunho do robô) fica fora da conta, senão o prêmio
 * que ele já leva contaria como usado e sumiria dele.
 */
export async function carimbosDoTelefone(
  franchiseeId: string,
  storeLoyalty: unknown,
  telefone: string,
  excetoIds: string[] = [],
): Promise<{ regra: RegraDosCarimbos; cartao: CartaoDeCarimbos } | null> {
  const regra = lerCarimbos(storeLoyalty);
  if (!carimbosNoAr(regra)) return null;
  if (digitosDe(telefone).length < 8) return null;
  const pedidos = await pedidosDosCarimbosDoTelefone(franchiseeId, telefone, excetoIds);
  return { regra, cartao: contarCarimbos(regra, pedidos) };
}

/**
 * O prêmio do cartão que entra NESTE pedido (site ou robô), ou `null`. Quem
 * chama soma o desconto (ou o item grátis) e grava `resgate` em
 * `CustomerOrder.carimboPremio` — é essa marca que impede o segundo uso.
 */
export async function premioDosCarimbosNoPedido(o: {
  franchiseeId: string;
  storeLoyalty: unknown;
  telefone: string;
  canal: "site" | "whatsapp";
  /** Produtos que ainda faltam pagar (depois de cupom e trilha). */
  produtosAPagar: number;
  excetoIds?: string[];
}): Promise<EfeitoDosCarimbos | null> {
  const doTelefone = await carimbosDoTelefone(o.franchiseeId, o.storeLoyalty, o.telefone, o.excetoIds || []);
  if (!doTelefone || doTelefone.cartao.aReceber <= 0) return null;
  const { regra, cartao } = doTelefone;
  const produto = regra.premioTipo === "product" && regra.premioProdutoId
    ? await prisma.menuProduct.findFirst({
        where: { id: regra.premioProdutoId, franchiseeId: o.franchiseeId },
        select: { id: true, name: true, price: true, active: true },
      })
    : null;
  return efeitoDosCarimbos(regra, cartao, { canal: o.canal, produtosAPagar: o.produtosAPagar, produto });
}
