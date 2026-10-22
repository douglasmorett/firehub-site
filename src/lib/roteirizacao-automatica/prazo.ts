/**
 * O prazo do pedido para a Rota 100% automatizada — o "Entregar até".
 *
 * D5 do plano (vault "FireHub - Plano despacho automático"): não inventar um
 * terceiro relógio. Vale o que a comanda e o app do motoboy já mostram
 * (lib/previsao-da-entrega.ts): o agendamento ou o prazo do parceiro em
 * `scheduledDatetime`, senão criação + `tempoEntregaMin` (o tempo que o
 * cliente viu no checkout). Sem nenhum dos dois, criação + o maior tempo das
 * áreas de entrega da loja (`prazoDeEntregaMin`, o mesmo do alerta de pedido
 * atrasado — padrão 45 min). Aqui sempre sai uma data: o planejador precisa
 * ordenar todo pedido, e a comanda é que pode ficar sem a linha.
 */
import { previsaoDaEntrega } from "@/lib/previsao-da-entrega";
import { prazoDeEntregaMin } from "@/lib/painel-do-dono";

export type PedidoDoPrazo = {
  createdAt: Date | string;
  scheduledDatetime?: Date | string | null;
  tempoEntregaMin?: number | null;
  deliveryType?: string | null;
  agendado?: boolean | null;
};

export function prazoDoPedido(pedido: PedidoDoPrazo, deliveryZones: unknown): Date {
  const previsao = previsaoDaEntrega(pedido);
  if (previsao) return new Date(previsao.em);
  return new Date(new Date(pedido.createdAt).getTime() + prazoDeEntregaMin(deliveryZones) * 60_000);
}

/**
 * O pedido é para DEPOIS e ainda não chegou a hora de ir para a cozinha (D4):
 * agendado de verdade (o cliente agendou, ou o parceiro mandou um horário mais
 * de 3 h depois da criação) e faltando mais que `liberarAntesMin` para o
 * horário. É o mesmo corte de Pedidos › Agendamentos (lib/agendamento.ts,
 * `aindaGuardado`), estendido ao agendamento dos parceiros.
 */
export function agendadoParaDepois(pedido: PedidoDoPrazo, liberarAntesMin: number, agora: Date): boolean {
  const previsao = previsaoDaEntrega(pedido);
  if (!previsao || previsao.tipo !== "AGENDADO") return false;
  return new Date(previsao.em).getTime() - agora.getTime() > liberarAntesMin * 60_000;
}
