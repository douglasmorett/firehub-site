/**
 * PEDIDO CANCELADO QUE FOI ENTREGUE MESMO ASSIM
 *
 * Allan (Delícias de Casa, Rio das Ostras), decidido pelo Douglas em
 * 17/10/2026: o cliente cancela, mas o motoboy já tinha saído — chega na
 * porta, o cliente recebe e paga. No FireHub o pedido ficava cancelado para
 * sempre: o dinheiro que o motoboy trouxe não entrava no caixa nem no acerto
 * dele, e a loja fechava o dia com uma sobra sem explicação. O Allan mostrou
 * o pedido cancelado na Conferência do motoboy, sem ter o que fazer com ele.
 *
 * A saída é UMA ação, com a forma de pagamento: "Entregue mesmo depois de
 * cancelado". O pedido passa a ENTREGUE e conta como qualquer entregue — a
 * régua das vendas, o caixa e o acerto do motoboy decidem pelo STATUS
 * (lib/relatorios/regua-da-venda.ts, lib/resumo-do-entregador.ts), então não
 * há conta nova em lugar nenhum. O que fica do cancelamento:
 *
 *   - `cancelledAt`, `cancelReason` e `cancelledBy` continuam gravados. O
 *     `cancelledAt` é o que faz a baixa de estoque (lib/stock.ts,
 *     `deductStockForOrder`) desfazer o desperdício em vez de baixar de novo;
 *   - o rastro (`editHistory`) ganha o registro desta ação, com quem marcou,
 *     a forma, e quando e por quê o pedido tinha sido cancelado.
 *
 * ── Só pedido da própria loja ───────────────────────────────────────────────
 *
 * Site, robô do WhatsApp, balcão/telefone (PDV) e totem. Pedido de iFood, 99,
 * Keeta, Brendi, Wabiz, JotaJá ou CardápioWeb cancelado está cancelado LÁ: o
 * parceiro já estornou o cliente e não repassa nada, e marcar entregue aqui
 * poria no caixa um dinheiro que nunca vem (e o status não volta no app
 * dele). Canal que não se reconhece também fica de fora — na dúvida, não
 * inventa venda. Mesa se acerta na conta da mesa; lanche da equipe e
 * reposição não são venda; o pago pelo site teve a cobrança estornada ou
 * excluída no cancelamento (lib/pix-online-pedido.ts), então o que o cliente
 * pagou na porta não é aquele Pix.
 *
 * Puro de propósito: a tela (painel, Conferência do motoboy) e o servidor
 * chamam a MESMA função para decidir se o botão aparece e se a gravação vale.
 * A gravação mora em lib/entregue-depois-de-cancelado-no-banco.ts.
 */
import { canalDoPedido } from "@/lib/canal-do-pedido";
import { ehPedidoCancelado } from "@/lib/desperdicio-do-cancelado";
import type { RegistroDeEdicao } from "@/lib/edicao-de-pedido";

/** A ação no rastro do pedido (`RegistroDeEdicao.acao`). */
export const ACAO_ENTREGUE_DEPOIS_DE_CANCELADO = "ENTREGUE_DEPOIS_DE_CANCELADO" as const;

/**
 * As formas que se recebem na porta, com os rótulos que todo classificador do
 * caixa e do acerto já lê (lib/pagamento-na-entrega.ts,
 * FORMAS_DE_PAGAMENTO_NA_ENTREGA). As quatro que o Douglas pediu.
 */
export const FORMAS_DO_ENTREGUE_DEPOIS_DE_CANCELADO = ["Dinheiro", "Cartão Crédito", "Cartão Débito", "Pix"] as const;
export type FormaDoEntregueDepoisDeCancelado = (typeof FORMAS_DO_ENTREGUE_DEPOIS_DE_CANCELADO)[number];

/** Os canais da própria loja (lib/canal-do-pedido.ts). */
const CANAIS_DA_LOJA = new Set(["SITE", "WHATSAPP_IA", "PDV", "TOTEM"]);

type Instante = Date | string | null | undefined;

export type PedidoParaEntregueDepoisDeCancelado = {
  status?: string | null;
  source?: string | null;
  openDeliveryChannel?: string | null;
  openDeliveryOrderId?: string | null;
  ifoodOrderId?: string | null;
  ifoodReference?: string | number | null;
  tableNumber?: string | number | null;
  tableSessionId?: string | null;
  deliveryType?: string | null;
  kind?: string | null;
  gatewayProvider?: string | null;
  gatewayPaymentId?: string | null;
  reposicao?: unknown;
  cancelledAt?: Instante;
  cancelReason?: string | null;
  cancelledBy?: string | null;
  editHistory?: unknown;
  totalAmount?: number | null;
};

export type Avaliacao = { pode: true } | { pode: false; motivo: string };

/**
 * Este pedido cancelado pode ser dado como entregue? A tela chama para saber
 * se mostra o botão; o servidor, para aceitar a gravação.
 */
export function podeMarcarEntregueDepoisDeCancelado(pedido: PedidoParaEntregueDepoisDeCancelado | null | undefined): Avaliacao {
  if (!pedido) return { pode: false, motivo: "Pedido não encontrado." };
  if (!ehPedidoCancelado(pedido.status)) return { pode: false, motivo: "Este pedido não está cancelado." };

  const canal = canalDoPedido(pedido as Parameters<typeof canalDoPedido>[0]);
  if (canal.ehMarketplace) {
    return {
      pode: false,
      motivo: `Pedido do ${canal.nome} cancelado continua cancelado: o ${canal.nome} já cancelou do lado dele e não repassa este valor.`,
    };
  }
  if (pedido.tableSessionId || pedido.kind === "CONTA_DA_MESA" || String(pedido.deliveryType || "").toUpperCase() === "MESA") {
    return { pode: false, motivo: "Pedido de mesa se acerta na conta da mesa." };
  }
  if (String(pedido.source || "").toUpperCase() === "EQUIPE") {
    return { pode: false, motivo: "Lanche da equipe não é venda." };
  }
  if (pedido.reposicao) {
    return { pode: false, motivo: "Pedido de reposição não é venda." };
  }
  if (pedido.gatewayProvider || pedido.gatewayPaymentId) {
    return {
      pode: false,
      motivo: "Pedido pago online pelo site: o cancelamento já estornou ou excluiu a cobrança. Lance a venda de novo pelo balcão.",
    };
  }
  if (!CANAIS_DA_LOJA.has(canal.chave)) {
    return { pode: false, motivo: "Não reconheci o canal deste pedido — só pedido da própria loja (site, robô, balcão) volta como entregue." };
  }
  return { pode: true };
}

/** A forma que chegou da tela, só entre as quatro. Outra coisa → null. */
export function lerFormaDoEntregue(texto: unknown): FormaDoEntregueDepoisDeCancelado | null {
  const t = String(texto ?? "").trim();
  return (FORMAS_DO_ENTREGUE_DEPOIS_DE_CANCELADO as readonly string[]).includes(t) ? (t as FormaDoEntregueDepoisDeCancelado) : null;
}

/**
 * A nota que o cliente deu (a convenção de `changeAmount` em todo o FireHub:
 * é a NOTA, não o troco). Só em dinheiro e só se for maior que o total —
 * nota igual ao total não tem troco.
 */
export function lerTrocoPara(forma: FormaDoEntregueDepoisDeCancelado, valor: unknown, total: number): number | null {
  if (forma !== "Dinheiro") return null;
  const n = Number(String(valor ?? "").replace(",", "."));
  return Number.isFinite(n) && n > total ? Math.round(n * 100) / 100 : null;
}

const dinheiro = (v: number) => `R$ ${(Number(v) || 0).toFixed(2).replace(".", ",")}`;

function quandoNaLoja(v: Instante, tz: string): string {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "";
  const dia = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: tz });
  const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: tz });
  return `${dia} às ${hora}`;
}

/** Quem cancelou, como o lojista fala (o `cancelledBy` grava LOJA/CLIENTE/IFOOD…). */
function quemCancelou(p: PedidoParaEntregueDepoisDeCancelado): string {
  const porRastro = Array.isArray(p.editHistory)
    ? [...(p.editHistory as RegistroDeEdicao[])].reverse().find((r) => r && r.acao === "CANCELOU")?.quem
    : null;
  if (porRastro) return porRastro;
  const c = String(p.cancelledBy || "").toUpperCase();
  if (!c) return "";
  if (c === "LOJA" || c === "RESTAURANT" || c === "MERCHANT") return "a loja";
  if (c === "CLIENTE" || c === "CUSTOMER") return "o cliente";
  if (c === "SISTEMA" || c === "SYSTEM") return "o sistema";
  return p.cancelledBy || "";
}

/**
 * O registro no rastro do pedido. Total de 0 → total: o registro CANCELOU do
 * cancelamento à mão grava total depois 0, e este devolve o valor — o
 * histórico lido em ordem conta a história certa.
 */
export function registroDoEntregueDepoisDeCancelado(opts: {
  pedido: PedidoParaEntregueDepoisDeCancelado;
  forma: FormaDoEntregueDepoisDeCancelado;
  trocoPara: number | null;
  quem: string;
  agora?: Date;
  tz?: string;
}): RegistroDeEdicao {
  const { pedido, forma, trocoPara, quem } = opts;
  const agora = opts.agora ?? new Date();
  const tz = opts.tz || "America/Sao_Paulo";
  const total = Number(pedido.totalAmount) || 0;
  const quando = quandoNaLoja(pedido.cancelledAt, tz);
  const por = quemCancelou(pedido);
  const motivo = String(pedido.cancelReason || "").trim();
  const descricao =
    `Entregue mesmo depois de cancelado — pago em ${forma}` +
    (trocoPara ? ` (troco para ${dinheiro(trocoPara)})` : "") +
    `. Tinha sido cancelado${quando ? ` em ${quando}` : ""}${por ? ` por ${por}` : ""}` +
    (motivo ? ` (motivo: ${motivo})` : "") +
    ".";
  return {
    quando: agora.toISOString(),
    quem: String(quem || "Loja").slice(0, 120),
    acao: ACAO_ENTREGUE_DEPOIS_DE_CANCELADO,
    descricao,
    totalAntes: 0,
    totalDepois: total,
  };
}

/**
 * O pedido está entregue e passou por esta ação — para as telas marcarem
 * "entregue depois de cancelado". Cancelado de novo depois disso, deixa de ser.
 */
export function foiEntregueDepoisDeCancelado(pedido: { status?: string | null; editHistory?: unknown } | null | undefined): boolean {
  if (!pedido || ehPedidoCancelado(pedido.status)) return false;
  return Array.isArray(pedido.editHistory) && (pedido.editHistory as { acao?: string }[]).some((r) => r?.acao === ACAO_ENTREGUE_DEPOIS_DE_CANCELADO);
}
