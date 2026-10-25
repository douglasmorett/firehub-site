/**
 * O acréscimo de marketplace (pedido colado, `parentOrderId`) anda junto com o
 * pedido principal: mesmo status. O entregador NÃO vai junto de propósito: o
 * app do motoboy lista pelo entregador, e o acréscimo apareceria lá como uma
 * segunda entrega.
 *
 * No banco ele é um pedido à parte por causa do repasse e do caixa (ver
 * api/store/orders/[id]/itens), mas para a loja é o MESMO pedido — o quadro
 * nem desenha o card dele (StoreOrdersDashboard). Parado em "aceito" enquanto
 * o principal saía e era entregue, ele ficava como pedido em aberto e podia
 * virar uma segunda entrega (Lucas/Frangoso, 24/10/2026).
 *
 * Nunca lança: falhar aqui não pode desfazer a mudança do pedido principal.
 */
import { prisma } from "@/lib/prisma";

const CANCELADOS = ["CANCELADO", "CANCELLED", "CANCELED"];
const MOTIVO_DO_PAI = "Pedido principal cancelado";

export async function acrescimosSeguemOPai(
  paiId: string,
  status: string,
): Promise<void> {
  try {
    const vivos = { parentOrderId: paiId, status: { notIn: CANCELADOS } };
    if (status === "CANCELADO") {
      await prisma.customerOrder.updateMany({
        where: vivos,
        data: { status, cancelledAt: new Date(), cancelledBy: "LOJA", cancelReason: MOTIVO_DO_PAI },
      });
      return;
    }
    // Principal reaberto depois de cancelado: volta junto só o acréscimo que
    // caiu POR CAUSA dele, não o que a loja cancelou de propósito.
    await prisma.customerOrder.updateMany({
      where: { parentOrderId: paiId, status: "CANCELADO", cancelReason: MOTIVO_DO_PAI },
      data: { status, cancelledAt: null, cancelledBy: null, cancelReason: null },
    });
    await prisma.customerOrder.updateMany({
      where: vivos,
      data: { status, ...(status === "ENTREGUE" ? { deliveredAt: new Date() } : {}) },
    });
  } catch (err: any) {
    console.error(`[Acréscimo] não acompanhou o pedido ${paiId}:`, err?.message || err);
  }
}
