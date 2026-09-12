/**
 * Status do FireHub → status da Wabiz.
 *
 * A Wabiz não tem escada de avisos como o Open Delivery: o status é absoluto
 * (1 a 7) e cada mudança pode notificar o cliente no app. Então aqui é um mapa
 * direto, sem reenviar etapas.
 *
 *   ACEITO/CONFIRMADO → 2 Confirmado
 *   PREPARANDO        → 3 Em produção
 *   PRONTO            → 4 Pronto para retirar   (só em retirada: numa entrega,
 *                                                "pronto para retirar" manda o
 *                                                cliente até a loja)
 *   SAIU_ENTREGA      → 5 Saiu para entrega
 *   ENTREGUE          → 6 Finalizado            sem notificação, como a doc pede
 *   CANCELADO         → 7 Cancelado             motivo vai na mensagem
 */
import { mudarStatusWabiz, WABIZ_STATUS } from "@/lib/wabiz-api";

/** Canal decide — `openDeliveryOrderId` é compartilhado com JotaJá, 99Food e Brendi. */
export function ehPedidoWabiz(pedido: {
  source?: string | null;
  openDeliveryChannel?: string | null;
  openDeliveryOrderId?: string | null;
}): boolean {
  if (!pedido.openDeliveryOrderId) return false;
  const canal = String(pedido.openDeliveryChannel || "").toUpperCase().trim();
  return canal === "WABIZ" || String(pedido.source || "").toUpperCase().trim() === "WABIZ";
}

export function statusWabizDoFireHub(status: string, deliveryType?: string | null): number | null {
  switch (String(status || "").toUpperCase()) {
    case "ACEITO":
    case "CONFIRMADO":
      return WABIZ_STATUS.CONFIRMADO;
    case "PREPARANDO":
    case "EM_PREPARO":
    case "EM_ANDAMENTO":
      return WABIZ_STATUS.EM_PRODUCAO;
    case "PRONTO":
      return String(deliveryType || "").toUpperCase() === "DELIVERY" ? null : WABIZ_STATUS.PRONTO_PARA_RETIRAR;
    case "SAIU_ENTREGA":
    case "SAIU_PARA_ENTREGA":
      return WABIZ_STATUS.SAIU_PARA_ENTREGA;
    case "ENTREGUE":
    case "FINALIZADO":
      return WABIZ_STATUS.FINALIZADO;
    case "CANCELADO":
      return WABIZ_STATUS.CANCELADO;
    default:
      return null;
  }
}

export interface ResultadoSyncWabiz {
  ok: boolean;
  ignorado?: boolean;
  acoes: string[];
  erros: string[];
}

export async function sincronizarWabiz(
  pedido: {
    openDeliveryOrderId: string;
    openDeliveryReference?: string | null;
    franchiseeId: string;
    deliveryType?: string | null;
  },
  novoStatus: string,
  opts: { motivo?: string | null } = {}
): Promise<ResultadoSyncWabiz> {
  const alvo = statusWabizDoFireHub(novoStatus, pedido.deliveryType);
  if (alvo == null) return { ok: true, ignorado: true, acoes: [], erros: [] };

  const internalKey = pedido.openDeliveryOrderId.replace(/_recovered$/, "");
  const orderNumber = String(pedido.openDeliveryReference || "").trim();
  if (!orderNumber) {
    return { ok: false, acoes: [], erros: [`pedido ${internalKey} sem número da Wabiz (openDeliveryReference)`] };
  }

  const r = await mudarStatusWabiz(pedido.franchiseeId, { orderNumber, internalKey }, alvo, {
    notificar: alvo !== WABIZ_STATUS.FINALIZADO,
    mensagem: alvo === WABIZ_STATUS.CANCELADO ? String(opts.motivo || "").slice(0, 250) : "",
    processado: true,
  });

  return r.ok
    ? { ok: true, acoes: [`status ${alvo}`], erros: [] }
    : { ok: false, acoes: [], erros: [r.erro || `status ${alvo} recusado`] };
}
