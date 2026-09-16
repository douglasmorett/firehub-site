/**
 * Editar um pedido JÁ LANÇADO: tirar item, mudar quantidade, acrescentar item.
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 *
 * O cliente liga depois de fechar o pedido: "tira a batata", "manda mais uma
 * Coca". Até aqui a loja só tinha duas saídas, as duas ruins — cancelar o
 * pedido inteiro, ou entregar do jeito errado e acertar na boca do caixa.
 *
 * O painel de MESAS já resolvia isso desde antes (a API em
 * api/store/table-sessions/[id]/orders/[orderId]), e as regras aqui são as
 * mesmas de lá. O que muda no delivery, e é o motivo deste arquivo existir em
 * vez de um import:
 *
 *   1. O TOTAL NÃO É A SOMA DOS ITENS. Na mesa é, porque mesa não tem taxa de
 *      entrega nem cupom. No delivery `totalAmount` nasce de
 *      `itens - desconto + taxa` (api/customer-order/route.ts:444) — copiar a
 *      conta da mesa apagaria a taxa de entrega, que existe em 35,6% dos
 *      pedidos próprios. Ver `recalcularTotal`.
 *
 *   2. EXISTE MARKETPLACE. 80,6% do volume vem de iFood, 99Food, Jotajá,
 *      Brendi e Wabiz, e lá quem manda é o parceiro: o cliente pagou lá e o
 *      repasse é calculado lá. Mexer nos itens do lado do FireHub só faria o
 *      valor divergir do que vai ser depositado. Nesses o modo é
 *      `SO_ACRESCIMO` — ver `MODOS` abaixo.
 *
 * ── A regra mora aqui, não nas telas ────────────────────────────────────────
 *
 * Mesmo motivo de lib/canal-do-pedido.ts: cadeia de `?:` copiada em cada tela
 * é como o selo do 99Food virou "Online" no painel. Quem decide se o botão
 * aparece (a tela) e quem decide se a escrita passa (a API) leem a MESMA
 * função — `avaliarEdicao`. Tela e servidor divergirem aqui significa botão
 * que existe e não funciona, ou pior: escrita que a tela não deixaria passar.
 */

import { STATUS_CANCELADOS, STATUS_FINALIZADOS } from "@/lib/status-pedido";
import { canalDoPedido } from "@/lib/canal-do-pedido";

/** A chave da permissão no CSV de `User.permissions` (ver lib/permissions.ts). */
export const PERMISSAO_EDITAR_PEDIDOS = "editar_pedidos";

/**
 * Status em que o pedido ainda aceita edição. WHITELIST de propósito, igual a
 * STATUS_PUXAVEIS: status novo entra FECHADO, não aberto. Um status que
 * aparecer amanhã e ninguém lembrar de classificar vira "não edita" — o lado
 * seguro.
 *
 * SAIU_ENTREGA e os irmãos ficam de fora por decisão do dono (15/09/2026): a
 * comida já saiu com o motoboy, editar ali é acerto de caixa, não edição. Isso
 * fecha de quebra a porta de mexer em pedido antigo — a mensalidade do FireHub
 * é calculada sobre o valor dos pedidos (lib/billing.ts), então poder editar
 * pedido ENTREGUE seria poder baixar a própria conta no fim do mês.
 *
 * AGUARDANDO_PAGAMENTO e CRIANDO_IA também ficam fora: pedido que ainda não é
 * pedido não se edita (mesma régua da fila de impressão e do app do motoboy).
 */
export const STATUS_EDITAVEIS = [
  "NOVO", "CONFIRMADO", "RECEBIDO", "PENDENTE", "ACEITO",
  "PREPARANDO", "EM_PREPARO", "EM_ANDAMENTO", "PRONTO",
] as const;

export type ModoDeEdicao =
  /** Tira item, muda quantidade e acrescenta. O dinheiro é todo da loja. */
  | "COMPLETO"
  /** Só acrescenta, e o acréscimo vira pedido colado. Pedido de marketplace. */
  | "SO_ACRESCIMO"
  /** Não edita aqui. `motivo` diz o que o lojista tem que fazer. */
  | "BLOQUEADO";

export type Avaliacao = {
  modo: ModoDeEdicao;
  /** Frase pronta para a tela. Escrita para o lojista, não para o log. */
  motivo?: string;
};

export type PedidoParaEdicao = {
  status?: string | null;
  source?: string | null;
  tableSessionId?: string | null;
  ifoodOrderId?: string | null;
  openDeliveryOrderId?: string | null;
  openDeliveryChannel?: string | null;
};

export type OperadorDaEdicao = {
  role?: string | null;
  /** O CSV cru de `User.permissions`. */
  permissions?: string | null;
};

/**
 * Quem pode editar. O dono da loja sempre pode; o funcionário só com a
 * permissão marcada no cadastro dele (decisão do dono, 15/09/2026 — quem
 * atende o telefone costuma ser o funcionário, mas apagar item de venda mexe
 * no caixa, então é escolha por pessoa).
 *
 * A permissão NASCE DESMARCADA, inclusive para quem já estava cadastrado: o
 * CSV de um funcionário antigo não contém a chave nova, e `includes` devolve
 * false. É de propósito — ligar isso sozinho daria a ~30 lojas em operação um
 * funcionário capaz de apagar venda sem ninguém ter escolhido isso.
 */
export function podeEditarPedidos(operador: OperadorDaEdicao): boolean {
  const role = (operador.role || "").toUpperCase();
  if (role === "ADMIN" || role === "FRANCHISEE") return true;
  return (operador.permissions || "").split(",").includes(PERMISSAO_EDITAR_PEDIDOS);
}

/**
 * A decisão inteira, num lugar só: a tela chama para saber se desenha o botão,
 * a API chama para saber se aceita a escrita.
 */
export function avaliarEdicao(
  pedido: PedidoParaEdicao | null | undefined,
  operador: OperadorDaEdicao
): Avaliacao {
  if (!pedido) return { modo: "BLOQUEADO", motivo: "Pedido não encontrado." };

  if (!podeEditarPedidos(operador)) {
    return {
      modo: "BLOQUEADO",
      motivo: "Você não tem permissão para editar pedidos. O dono da loja libera em Configurações → Equipe.",
    };
  }

  // Pedido de mesa tem tela própria, com regra própria (a conta é da SESSÃO,
  // não do pedido) e é lá que o estoque e o rateio por pessoa são tratados.
  // Dois lugares editando a mesma coisa com contas diferentes é como a conta
  // da mesa passaria a divergir do que foi lançado.
  if (pedido.tableSessionId) {
    return {
      modo: "BLOQUEADO",
      motivo: "Este pedido é de uma mesa. Edite pelo painel de Mesas, onde fica a conta.",
    };
  }

  const status = (pedido.status || "").toUpperCase();

  if ((STATUS_CANCELADOS as readonly string[]).includes(status)) {
    return { modo: "BLOQUEADO", motivo: "Este pedido já foi cancelado." };
  }
  if ((STATUS_FINALIZADOS as readonly string[]).includes(status)) {
    return {
      modo: "BLOQUEADO",
      motivo: "Este pedido já foi entregue. Ajuste agora é acerto de caixa — fale com o financeiro.",
    };
  }
  if (!(STATUS_EDITAVEIS as readonly string[]).includes(status)) {
    // Cai aqui SAIU_ENTREGA e irmãos, AGUARDANDO_PAGAMENTO, CRIANDO_IA e
    // qualquer status que apareça depois sem ser classificado.
    return {
      modo: "BLOQUEADO",
      motivo: ehStatusDeRua(status)
        ? "O pedido já saiu para entrega — não dá mais para mudar o que vai na sacola."
        : "Este pedido ainda não está pronto para ser editado.",
    };
  }

  const canal = canalDoPedido(pedido as any);
  if (canal.ehMarketplace) {
    return {
      modo: "SO_ACRESCIMO",
      motivo: `Pedido do ${canal.nome}: os itens e o valor de lá não mudam aqui — para tirar item, use o app do ${canal.nome}. Aqui você acrescenta o que o cliente pediu por fora.`,
    };
  }

  return { modo: "COMPLETO" };
}

function ehStatusDeRua(status: string): boolean {
  return status.startsWith("SAIU") || status === "EM_ROTA";
}

/**
 * O total do pedido depois da edição.
 *
 * `itens - desconto + taxa` é a mesma conta que monta `finalTotal` no
 * nascimento do pedido (api/customer-order/route.ts:444), e foi conferida
 * contra 400 pedidos próprios reais em 15/09/2026: bate em 399. O único fora
 * é um pedido antigo sem item nenhum, que não é editável de qualquer forma.
 *
 * O DESCONTO É PRESERVADO EM REAIS, não recalculado. Um cupom de 10% aplicado
 * sobre o pedido original continua valendo os mesmos R$ 4,50 depois de tirar
 * um item — e não os 10% do que sobrou. É a escolha conservadora: recalcular
 * um cupom percentual exigiria revalidar valor mínimo, e um cupom que deixa de
 * valer no meio da edição vira preço que muda sozinho na mão do cliente.
 * Desconto aparece em 0,4% dos pedidos próprios, então o caso é raro; a tela
 * mostra a linha do desconto para o atendente ver que ela ficou de pé.
 */
export function recalcularTotal(entrada: {
  itens: { price: number; quantity: number }[];
  deliveryFee?: number | null;
  discountTotal?: number | null;
}): number {
  const centavos = (n: number) => Math.round(n * 100) / 100;
  const soma = entrada.itens.reduce(
    (acc, i) => acc + Number(i.price || 0) * Number(i.quantity || 0),
    0
  );
  return centavos(
    Math.max(0, soma - Number(entrada.discountTotal || 0) + Number(entrada.deliveryFee || 0))
  );
}

/** Uma linha do rastro gravado em `CustomerOrder.editHistory`. */
export type RegistroDeEdicao = {
  /** ISO. Quem lê é humano, e o servidor roda em UTC (ver lib/fuso.ts). */
  quando: string;
  quem: string;
  acao: "REMOVEU" | "MUDOU_QTD" | "ACRESCENTOU" | "CANCELOU";
  /** O que mudou, em texto pronto: "Coca 2L (2x → 1x)". */
  descricao: string;
  totalAntes: number;
  totalDepois: number;
};

/**
 * Empilha o rastro sem nunca perder o que já estava lá.
 *
 * Auditoria é o contrapeso de deixar a loja apagar item de venda: quando o
 * dono perguntar por que o pedido 47 fechou R$ 12 a menos, a resposta está no
 * pedido, não na memória de quem estava no caixa.
 */
export function empilharEdicao(
  historicoAtual: unknown,
  registro: RegistroDeEdicao
): RegistroDeEdicao[] {
  const anterior = Array.isArray(historicoAtual) ? (historicoAtual as RegistroDeEdicao[]) : [];
  // Teto para o JSONB não crescer sem fim num pedido que alguém edite em loop.
  return [...anterior, registro].slice(-50);
}
