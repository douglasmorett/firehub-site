/**
 * TROCAR O TIPO DE UM PEDIDO JÁ LANÇADO: delivery que vira mesa ou balcão,
 * e balcão/retirada que vira entrega (com endereço e taxa).
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 *
 * O cliente está sentado no salão e faz o pedido pelo cardápio do delivery
 * (Ragnar, 01/10/2026: "Quando o cliente está no salão e acaba fazendo o
 * pedido pelo delivery. Dá pra mudar para mesa?"). Não dava: o pedido ficava
 * com a taxa de entrega, ia para a fila do motoboy e não entrava na conta da
 * mesa. A saída era cancelar e lançar tudo de novo na mesa, o que imprime a
 * comanda duas vezes.
 *
 * Fica no lápis do card, junto da edição de itens (Douglas: "na aba de editar
 * mesmo, no lápis... troca para mesa, escolhe a mesa; troca para balcão").
 *
 * ── O que a troca faz ───────────────────────────────────────────────────────
 *
 * Para os dois destinos:
 *   - a taxa de entrega sai e o total cai junto (cliente que não recebe em
 *     casa não paga entrega). Quem já pagou é avisado do que devolver, pela
 *     mesma frase da correção de taxa (`avisoDaDiferencaDeTotal`);
 *   - motoboy, rota, repasse, distância e "entrega grátis" saem: o pedido
 *     deixa de ser entrega e não pode aparecer no acerto do entregador.
 *
 * MESA: o pedido entra na conta da mesa (`tableSessionId`) e passa a ser pago
 * quando a mesa fecha (paymentMethod "N/A", igual ao lançado pelo garçom; ver
 * [[pedido-de-mesa-so-fecha-com-a-mesa]]). O fechamento soma `totalAmount`,
 * então o desconto do pedido aparece na conta como "Ajuste do pedido"
 * (lib/conta-da-mesa.ts). Os preços dos itens ficam os do delivery: foi o que
 * o cliente viu e aceitou.
 *
 * BALCÃO: vira RETIRADA, como o balcão do PDV grava (api/store/orders/presencial).
 * A forma de pagamento continua a escolhida pelo cliente.
 *
 * ── Quando NÃO troca ────────────────────────────────────────────────────────
 *
 *   - tudo o que `avaliarEdicao` barra (sem permissão, cancelado, nota fiscal
 *     autorizada, pedido de mesa, pedido que ainda não é pedido);
 *   - marketplace: o tipo do pedido é do iFood/99Food, e o app continua
 *     esperando o fluxo de entrega dele;
 *   - pedido que já saiu (ou foi entregue): aí não é mais troca, é história;
 *   - para MESA, pedido já pago (online ou confirmado): a conta da mesa
 *     cobraria de novo. Balcão continua possível.
 *
 * Regra pura: a tela (botão e opções) e a API leem a MESMA função.
 */

import { avaliarEdicao, type OperadorDaEdicao, type PedidoParaEdicao } from "@/lib/edicao-de-pedido";
import { ehPagoOnline } from "@/lib/pagamento-na-entrega";

export type TipoDeDestino = "MESA" | "BALCAO" | "DELIVERY";

/** Como o tipo de cada destino vai para o banco. Balcão é RETIRADA, como no PDV. */
export const TIPO_GRAVADO: Record<TipoDeDestino, string> = { MESA: "MESA", BALCAO: "RETIRADA", DELIVERY: "DELIVERY" };

export const ROTULO_DO_DESTINO: Record<TipoDeDestino, string> = { MESA: "Mesa", BALCAO: "Balcão / retirada", DELIVERY: "Entrega" };

/**
 * Status em que ainda dá para trocar: antes de o pedido sair. WHITELIST, como
 * STATUS_EDITAVEIS: status novo entra fechado.
 */
export const STATUS_QUE_TROCAM = [
  "NOVO", "CONFIRMADO", "RECEBIDO", "PENDENTE", "ACEITO",
  "PREPARANDO", "EM_PREPARO", "EM_ANDAMENTO", "PRONTO",
] as const;

const RETIRADAS = ["PICKUP", "TAKEOUT", "RETIRADA", "BALCAO", "BALCÃO"];

export type PedidoParaTroca = PedidoParaEdicao & {
  deliveryFee?: number | null;
  paymentPaidAt?: Date | string | null;
  dispatchedAt?: Date | string | null;
};

/** O tipo atual em palavras, para a tela: "Delivery", "Balcão / retirada", "Mesa". */
export function tipoAtualDoPedido(pedido: { deliveryType?: string | null; tableSessionId?: string | null }): "DELIVERY" | "BALCAO" | "MESA" {
  const dt = String(pedido.deliveryType || "").trim().toUpperCase();
  if (dt === "MESA" || pedido.tableSessionId) return "MESA";
  if (RETIRADAS.includes(dt)) return "BALCAO";
  return "DELIVERY";
}

export const ROTULO_DO_TIPO = { DELIVERY: "Delivery", BALCAO: "Balcão / retirada", MESA: "Mesa" } as const;

export type AvaliacaoDaTroca =
  | { pode: false; motivo: string }
  | {
      pode: true;
      /** Para onde dá para trocar, na ordem dos botões. */
      destinos: TipoDeDestino[];
      /** Destino que existe mas está barrado, com o porquê (ex.: mesa com pedido já pago). */
      barrados: Partial<Record<TipoDeDestino, string>>;
    };

export function avaliarTrocaDeTipo(pedido: PedidoParaTroca | null | undefined, operador: OperadorDaEdicao): AvaliacaoDaTroca {
  if (!pedido) return { pode: false, motivo: "Pedido não encontrado." };

  const edicao = avaliarEdicao(pedido, operador);
  if (edicao.modo === "BLOQUEADO") return { pode: false, motivo: edicao.motivo || "Este pedido não pode ser alterado." };
  if (edicao.modo === "MARKETPLACE") {
    return {
      pode: false,
      motivo: `Pedido do ${edicao.canal || "parceiro"}: o tipo é do app, que continua esperando a entrega. Para o cliente comer aqui, cancele pelo ${edicao.canal || "app"} e lance na mesa.`,
    };
  }

  const status = String(pedido.status || "").toUpperCase();
  if (!(STATUS_QUE_TROCAM as readonly string[]).includes(status) || pedido.dispatchedAt) {
    return { pode: false, motivo: "O pedido já saiu. A troca de tipo é só antes de sair." };
  }

  const atual = tipoAtualDoPedido(pedido);
  // Balcão/retirada também vira ENTREGA: o atendente lançou "retirada no
  // local" num pedido que era para o endereço do cliente (Lapastine,
  // 09/10/2026: "não sei como editar para colocar o endereço do cara e a taxa").
  const destinos: TipoDeDestino[] = atual === "DELIVERY" ? ["MESA", "BALCAO"] : atual === "BALCAO" ? ["DELIVERY", "MESA"] : [];
  if (destinos.length === 0) return { pode: false, motivo: "Este pedido já é de mesa." };

  const barrados: Partial<Record<TipoDeDestino, string>> = {};
  if (ehPagoOnline(pedido as any) || pedido.paymentPaidAt) {
    barrados.MESA = "O cliente já pagou este pedido. Na conta da mesa ele seria cobrado de novo.";
  }
  return { pode: true, destinos, barrados };
}

const centavos = (n: number) => Math.round(n * 100) / 100;

/**
 * O total depois da troca: sai a taxa de entrega e mais nada. O desconto e os
 * itens ficam como estão (lib/edicao-de-pedido.ts, `recalcularTotal`, monta o
 * total do mesmo jeito: itens − desconto + taxa).
 */
export function totalSemATaxa(pedido: { totalAmount?: number | null; deliveryFee?: number | null }): number {
  return Math.max(0, centavos((pedido.totalAmount || 0) - (pedido.deliveryFee || 0)));
}

/**
 * O total quando o pedido VIRA entrega: sai a taxa antiga (se houver) e entra
 * a nova. Itens e desconto ficam como estão.
 */
export function totalComATaxa(pedido: { totalAmount?: number | null; deliveryFee?: number | null }, taxa: number): number {
  return Math.max(0, centavos((pedido.totalAmount || 0) - (pedido.deliveryFee || 0) + (Number(taxa) || 0)));
}

/** A observação que fica no pedido, para a loja ver no card. */
export function etiquetaDaTroca(de: string, para: string): string {
  return `[Tipo trocado: ${de} → ${para}]`;
}
