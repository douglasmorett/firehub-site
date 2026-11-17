import { MARCO_POR_STATUS } from "./order-stages";
import { ehPedidoCancelado } from "./desperdicio-do-cancelado";

/** Pedido recebido ou em operação, inclusive o que chega já pronto. */
export function pedidoDeveBaixarEstoque(status: unknown): boolean {
  if (typeof status !== "string") return false;
  const etapa = status.toUpperCase();
  return !ehPedidoCancelado(etapa) && (
    etapa === "NOVO" || etapa === "RECEBIDO" || Object.hasOwn(MARCO_POR_STATUS, etapa)
  );
}
