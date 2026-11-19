/**
 * OS MOTIVOS DE CANCELAMENTO QUE A JANELA "CANCELAR PEDIDO" OFERECE — o corpo
 * do GET /api/customer-order/cancellation-reasons, tirado da rota em
 * 19/11/2026 para o Bill (lib/assessor/modulos/pedidos.ts) oferecer os mesmos
 * códigos da tela. Pedido do iFood: os motivos que o iFood devolve para ele;
 * os outros (e o iFood que não respondeu): a lista padrão. O código escolhido
 * vai como `cancellationCode` para lib/mudar-status-do-pedido.ts.
 */
import type { PedidoIfood } from "@/lib/ifood-pedido";

export type MotivoDoCancelamento = { cancelCodeId: string; description: string };

export async function motivosDoCancelamento(order: PedidoIfood): Promise<MotivoDoCancelamento[]> {
  const defaultReasons = [
    { cancelCodeId: "501", description: "Área de risco / Sem segurança" },
    { cancelCodeId: "502", description: "Estabelecimento sem motoboy" },
    { cancelCodeId: "503", description: "Item indisponível no cardápio" },
    { cancelCodeId: "504", description: "Pedido em duplicidade" },
    { cancelCodeId: "505", description: "Cliente desistiu do pedido" },
    { cancelCodeId: "506", description: "Cardápio com preço incorreto" },
    { cancelCodeId: "507", description: "Outros motivos" },
  ];

  if (order.ifoodOrderId) {
    try {
      // Com a credencial do dono do pedido (o token central só alcança a Hakim).
      const { chamarPeloPedido } = await import("@/lib/ifood-pedido");
      const res = await chamarPeloPedido(
        order,
        `/order/v1.0/orders/${order.ifoodOrderId}/cancellationReasons`,
        { method: "GET", idempotente: true },
        "iFood cancellationReasons",
      );
      if (res.ok) {
        const data = res.data;
        console.log(`[iFood cancellationReasons] Received data:`, JSON.stringify(data));

        let reasons: any[] = [];
        if (Array.isArray(data)) {
          reasons = data;
        } else if (data && Array.isArray(data.reasons)) {
          reasons = data.reasons;
        } else if (data && typeof data === "object") {
          const arrayVal = Object.values(data).find(Array.isArray);
          if (arrayVal) {
            reasons = arrayVal;
          }
        }

        if (reasons.length > 0) {
          const formatted = reasons.map((r: any) => ({
            cancelCodeId: String(r.cancelCodeId || r.code || r.cancelCode || "501"),
            description: String(r.description || r.reason || "Outros")
          }));
          return formatted;
        }
      } else {
        console.warn(`[iFood cancellationReasons] Failed to fetch. Status: ${res.status}`);
      }
    } catch (err: any) {
      console.error(`[iFood cancellationReasons] Error:`, err?.message);
    }
  }

  // Fallback if not iFood order or if API fetch failed/returned empty
  return defaultReasons;
}
