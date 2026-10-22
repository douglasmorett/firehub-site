/**
 * O chip "🤖 Rota #7 · 2/3 prontos" no card do painel de pedidos (Fase 3 do
 * plano, vault "FireHub - Plano despacho automático").
 *
 * O poll (api/customer-order/poll) manda em cada pedido de rota AUTOMÁTICA o
 * `rotaAuto` { numero, chamadaEm, saiu }; os prontos a tela conta pelos
 * pedidos do mesmo `routeId` que ela já tem — sem consulta a mais por rodada.
 * "Pronto" é o `prontoNaCozinha` do quadro (o mesmo selo da coluna Prontos).
 *
 * SEM SERVIDOR: roda no navegador (StoreOrdersDashboard) e no teste.
 */
import { prontoNaCozinha } from "@/lib/pedidos-na-cozinha";
import { STATUS_CANCELADOS } from "@/lib/status-pedido";

export type RotaAutoDoPedido = { numero: string; chamadaEm: string | Date | null; saiu: boolean };

type PedidoDaRota = { id: string; routeId?: string | null; status: string; deliveryType?: string | null; kdsStage?: string | null; rotaAuto?: RotaAutoDoPedido | null };

const cancelado = (status: string) => (STATUS_CANCELADOS as readonly string[]).includes(status);
const NA_RUA = new Set(["SAIU_ENTREGA", "SAIU_PARA_ENTREGA", "ENTREGUE"]);

/**
 * O texto do chip de cada rota automática na tela, por `routeId`. Os pedidos
 * da mesma rota podem ter chegado em rodadas diferentes (modo `desde`): vale o
 * mais adiantado — chamada por um, chamada; saiu por um, saiu.
 */
export function chipsDasRotasAutomaticas(pedidos: PedidoDaRota[]): Map<string, string> {
  const rotas = new Map<string, { numero: string; chamada: boolean; saiu: boolean; prontos: number; total: number }>();
  for (const p of pedidos) {
    if (!p.routeId || !p.rotaAuto) continue;
    const r = rotas.get(p.routeId) ?? { numero: p.rotaAuto.numero, chamada: false, saiu: false, prontos: 0, total: 0 };
    r.chamada ||= !!p.rotaAuto.chamadaEm;
    r.saiu ||= p.rotaAuto.saiu || NA_RUA.has(p.status);
    rotas.set(p.routeId, r);
  }
  // Contados à parte: pedido da rota que veio sem `rotaAuto` (carga inicial
  // da página, antes do 1º poll) também é da rota.
  for (const p of pedidos) {
    const r = p.routeId ? rotas.get(p.routeId) : undefined;
    if (!r || cancelado(p.status)) continue;
    r.total++;
    if (prontoNaCozinha(p)) r.prontos++;
  }
  const chips = new Map<string, string>();
  for (const [id, r] of rotas) {
    const estado = r.saiu ? "saiu" : r.chamada ? "chamada" : `${r.prontos}/${r.total} pronto${r.total === 1 ? "" : "s"}`;
    chips.set(id, `🤖 ${r.numero} · ${estado}`);
  }
  return chips;
}
