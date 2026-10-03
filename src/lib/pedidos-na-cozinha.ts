/**
 * QUANTOS PEDIDOS A LOJA TEM PARA DESPACHAR — o número da extensão de prazo.
 *
 * A extensão (firehub-ifood-extension) ajusta o prazo do iFood por este
 * número, e ele chega por dois caminhos:
 *
 *   • o PAINEL aberto: o bridge lê `#firehub-em-producao-count-badge` e
 *     escuta o postMessage FIREHUB_EM_PRODUCAO_COUNT;
 *   • a API `/api/store/dynamic-eta`, que o alarme da extensão chama a cada
 *     minuto quando o painel não deu sinal nos últimos 30 s — o que acontece
 *     sempre que a aba do painel fica em segundo plano (o Chrome segura os
 *     timers dela a 1 por minuto).
 *
 * Até 02/10/2026 cada caminho contava de um jeito, e a extensão pulava de um
 * para o outro (Douglas: "não tava marcando a quantidade na cozinha"):
 *
 *   • o painel mandava o tamanho da coluna Em Produção — que, com a coluna
 *     Prontos ligada, já não tem o pronto esperando o motoboy, e que obedece
 *     ao filtro de canal, ao de tipo e à busca (quadro filtrado em "iFood" =
 *     prazo de um pedaço da loja);
 *   • a API contava o pronto esperando o motoboy. Na Hakim, a noite toda, de
 *     1 a 5 pedidos de diferença: quadro 4, API 9, prazo de 28 para 58 min e
 *     de volta, conforme a aba estava na frente ou não.
 *
 * O certo era a API (Douglas, 03/10/2026: "pedido pronto continua contando no
 * prazo, tá esperando o motoboy ainda") — a tabela é por motoboy. Agora as
 * duas pontas usam estas funções: pedido aceito que ainda não saiu, pronto
 * ou não, sem filtro de tela, na mesma janela do quadro.
 */

/** Agendamento "de verdade" (e não o horário estimado que o canal manda). */
const AGENDAMENTO_DE_VERDADE_MS = 3 * 60 * 60 * 1000;

type PedidoDaContagem = {
  status: string;
  deliveryType?: string | null;
  kdsStage?: string | null;
  createdAt: Date | string;
  scheduledDatetime?: Date | string | null;
};

/** A data que o quadro usa para o pedido: o agendamento, se for de verdade. */
export function dataDoPedido(o: { createdAt: Date | string; scheduledDatetime?: Date | string | null }): Date {
  const criado = new Date(o.createdAt);
  if (!o.scheduledDatetime) return criado;
  const agendado = new Date(o.scheduledDatetime);
  if (!Number.isFinite(agendado.getTime())) return criado;
  return agendado.getTime() - criado.getTime() > AGENDAMENTO_DE_VERDADE_MS ? agendado : criado;
}

/** "Pronto na cozinha": o selo dentro de Em Produção, ou a coluna Prontos. */
export function prontoNaCozinha(o: Pick<PedidoDaContagem, "status" | "deliveryType" | "kdsStage">): boolean {
  return o.kdsStage === "FINISHED" || o.kdsStage === "READY" || (o.deliveryType === "DELIVERY" && o.status === "PRONTO");
}

/**
 * Pedido aceito que ainda não saiu — na chapa ou pronto esperando o motoboy.
 * A retirada pronta já é Finalizado no quadro (não espera motoboy) e não
 * conta. NOVO também não: ainda não é da loja (e, sem a coluna Novos, o
 * aceite automático o carimba no tique seguinte).
 */
export function contaNoPrazo(o: Pick<PedidoDaContagem, "status" | "deliveryType">): boolean {
  return o.status === "ACEITO" || o.status === "PREPARANDO" || (o.deliveryType === "DELIVERY" && o.status === "PRONTO");
}

/**
 * Desde quando um pedido em aberto ainda está no quadro: o mais antigo entre
 * a abertura do caixa, 12 h atrás e o começo do dia (StoreOrdersDashboard,
 * `filteredOrders`). Fora disso é pedido esquecido, não fila da loja.
 */
export function inicioDaJanelaDoQuadro(agora: Date, inicioDoDia: Date, caixaAbertoEm?: Date | null): Date {
  const candidatos = [agora.getTime() - 12 * 60 * 60 * 1000, inicioDoDia.getTime()];
  if (caixaAbertoEm && Number.isFinite(caixaAbertoEm.getTime())) candidatos.push(caixaAbertoEm.getTime());
  return new Date(Math.min(...candidatos));
}

export function contarPedidosDoPrazo(pedidos: PedidoDaContagem[], desde: Date): number {
  let n = 0;
  for (const o of pedidos) {
    if (dataDoPedido(o) < desde) continue;
    if (contaNoPrazo(o)) n++;
  }
  return n;
}
