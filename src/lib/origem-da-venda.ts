/**
 * De onde veio a venda: BALCÃO, MESA, DELIVERY ou RETIRADA — a régua num lugar só.
 *
 * ── Por que não é `canalDoPedido` ───────────────────────────────────────────
 *
 * `canalDoPedido` responde "por qual PLATAFORMA" (iFood, 99Food, site, PDV) e
 * decide mesa por `tableNumber`, que o pedido de mesa nem sempre carrega. O
 * relatório de mesas responde outra pergunta — "onde o cliente estava" — e o
 * que prova isso é `tableSessionId` (sentou numa mesa), `deliveryType`
 * (saiu para a rua) e `source` (foi lançado no caixa). As duas réguas se
 * complementam: aqui decide-se o lugar, e `canalDoPedido` dá o nome da
 * plataforma dentro do delivery.
 *
 * A RETIRADA existe como quarta linha de propósito. O dono pediu "balcão,
 * mesa e delivery", mas o pedido do site que o cliente vem buscar não é
 * nenhum dos três: não sentou, não saiu para a rua e não foi lançado no caixa.
 * Jogá-lo em "balcão" inflaria o balcão com venda que a loja não atendeu no
 * balcão; escondê-lo faria o total das linhas não bater com o total da loja.
 */

import { canalDoPedido } from "@/lib/canal-do-pedido";

export type OrigemDaVenda = "MESA" | "BALCAO" | "DELIVERY" | "RETIRADA";

export type PedidoParaOrigem = {
  tableSessionId?: string | null;
  deliveryType?: string | null;
  source?: string | null;
  ifoodOrderId?: string | null;
  ifoodReference?: string | null;
  openDeliveryOrderId?: string | null;
  openDeliveryChannel?: string | null;
  status?: string | null;
};

/** Os `source` que a venda de balcão grava (api/store/orders/presencial, totem, PDV). */
const FONTES_DE_BALCAO = new Set(["PRESENCIAL", "PDV", "TOTEM", "BALCAO", "MANUAL", "CAIXA"]);

export function origemDaVenda(pedido: PedidoParaOrigem): OrigemDaVenda {
  // Sentou numa mesa: é mesa, venha o lançamento de onde vier (garçom pelo
  // link, painel, QR da mesa).
  if (pedido.tableSessionId) return "MESA";

  const tipo = String(pedido.deliveryType || "").toUpperCase();
  if (tipo === "DELIVERY") return "DELIVERY";

  // "MESA" no deliveryType sem sessão é o lançamento antigo de mesa pelo PDV,
  // antes do módulo de mesas existir: continua sendo mesa.
  if (tipo === "MESA") return "MESA";

  const fonte = String(pedido.source || "").toUpperCase();
  if (FONTES_DE_BALCAO.has(fonte)) return "BALCAO";

  // Sobrou o pedido de app/site/marketplace que o cliente vem buscar.
  return "RETIRADA";
}

export const ROTULO_DA_ORIGEM: Record<OrigemDaVenda, string> = {
  MESA: "Mesa",
  BALCAO: "Balcão",
  DELIVERY: "Delivery",
  RETIRADA: "Retirada",
};

/**
 * O nome da plataforma DENTRO do delivery ("iFood", "99Food", "Online"...), para
 * o relatório abrir o delivery por canal. Reaproveita a régua oficial.
 */
export function canalDentroDoDelivery(pedido: PedidoParaOrigem): string {
  return canalDoPedido(pedido as any).nome;
}
