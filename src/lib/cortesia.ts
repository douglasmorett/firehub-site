/**
 * CORTESIA: a loja dá um item de graça — a sobremesa do aniversariante, a
 * bebida pelo atraso, o lanche refeito que o cliente acabou levando os dois.
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 *
 * O Alex (Hambúrgueria Avenida, 11/2026) veio do SWFast, onde a venda ou o
 * item marcado como cortesia tem cliente, motivo, valor e operador, e um
 * relatório próprio. Aqui a loja só tinha dois jeitos ruins: tirar o item
 * (vira cancelamento, e a cozinha/estoque somem com ele) ou dar desconto de
 * 100% (vira desconto, misturado com o "Cliente fiel" de R$ 2). Nenhum dos
 * dois responde "quanto eu dei de cortesia este mês, e quem deu".
 *
 * ── O que a cortesia faz ────────────────────────────────────────────────────
 *
 * O item FICA no pedido, com preço R$ 0,00 (o mesmo jeito do brinde da Trilha
 * Premiada, api/customer-order). Cortesia de parte das unidades ("a segunda
 * cerveja é por conta da casa") separa a linha: as pagas continuam com o
 * preço, as dadas viram uma linha a R$ 0,00. No rastro do pedido
 * (`editHistory`) entra um registro CORTESIA com quem deu (nome e id), o
 * motivo e o valor que o item teria custado (`itensCortesia`).
 *
 * ── Como a régua de venda trata (lib/relatorios/regua-da-venda.ts) ──────────
 *
 *   • NÃO é venda: o `totalAmount` cai o valor do item, e o valor vendido é a
 *     soma dos `totalAmount`. O item a R$ 0,00 também não soma no total dos
 *     itens (`totalDosItens` = preço × quantidade). O pedido em si continua
 *     sendo venda (atendimento) se tiver sobrado algo — ou mesmo a R$ 0,00,
 *     como o pedido com desconto de 100%.
 *   • ENTRA NO CUSTO: o estoque não é devolvido (a baixa do lançamento fica),
 *     e o CMV do DRE sai das baixas (lib/financeiro/cmv-do-financeiro.ts) — o
 *     insumo da cortesia está lá. O Itens vendidos conta a unidade, a R$ 0,00.
 *   • Não é desconto: não mexe em `discountTotal`, então não entra no Cupons e
 *     descontos. O relatório dela é o Cancelamentos e cortesias.
 *
 * Quando pode: quando a cortesia chega ao bolso do cliente — a mesma régua do
 * desconto na edição (pago online ou no parceiro, o dinheiro já entrou; com
 * pagamento dividido, as partes somam o total antigo). Na mesa ABERTA pode
 * (a conta soma as rodadas e acompanha). Motivo obrigatório, a régua do
 * cancelamento (lib/motivo-do-cancelamento.ts): é dinheiro saindo da mão.
 *
 * Puro (sem Prisma): a tela usa para acender o botão e a rota
 * (api/store/orders/[id]/cortesia) para decidir. Testado em
 * scripts/teste-cancelamentos.ts.
 */
import { lerPartes } from "@/lib/pagamento-dividido";
import { ehPagoOnline } from "@/lib/pagamento-na-entrega";
import type { Avaliacao, PedidoParaEdicao } from "@/lib/edicao-de-pedido";

/** Atalhos da tela; a pessoa pode escrever outro. */
export const MOTIVOS_DE_CORTESIA = ["Cliente fiel", "Aniversário", "Pedido atrasado", "Erro da cozinha", "Combinado com o dono"] as const;

/** Um item dado de cortesia, como fica no rastro: `valor` é o que teria custado (preço × quantidade). */
export type ItemDeCortesia = { nome: string; quantidade: number; valor: number };

const centavos = (n: number) => Math.round(n * 100) / 100;

/** Pode dar cortesia neste pedido? A mesma régua do desconto na edição, com a frase da cortesia. */
export function cortesiaNaEdicao(
  pedido: PedidoParaEdicao | null | undefined,
  avaliacao: Avaliacao
): { pode: true } | { pode: false; motivo: string } {
  if (!pedido || avaliacao.modo === "BLOQUEADO") {
    return { pode: false, motivo: (pedido && avaliacao.motivo) || "Pedido não encontrado." };
  }
  // Mesa aberta: a conta soma as rodadas, então zerar o item já tira da conta.
  if (avaliacao.modo === "MESA") return { pode: true };
  if (avaliacao.totalMuda === false || avaliacao.modo === "MARKETPLACE") {
    const canal = avaliacao.canal || "parceiro";
    return { pode: false, motivo: `Pedido do ${canal}: o cliente paga lá, e a cortesia aqui não devolve nada a ele.` };
  }
  if (ehPagoOnline(pedido as any)) {
    return { pode: false, motivo: "O cliente já pagou online: a cortesia agora não devolve o dinheiro a ele." };
  }
  if (lerPartes(pedido.paymentMethods).length > 1) {
    return { pode: false, motivo: "Pagamento dividido: passe para \"Uma forma só\" em \"Como o cliente pagou\", dê a cortesia e divida de novo." };
  }
  return { pode: true };
}

export type ItemParaCortesia = { id: string; quantity: number; price: number; productName?: string | null };

export type PlanoDaCortesia =
  | { ok: false; erro: string }
  | {
      ok: true;
      item: ItemParaCortesia;
      quantidade: number;
      /** true = só parte das unidades: a linha se separa (as pagas ficam, as dadas viram outra a R$ 0,00). */
      separa: boolean;
      linha: ItemDeCortesia;
      /** "cortesia: 1x Coca-Cola Lata (R$ 6,00)". */
      descricao: string;
    };

/** Qual item, quantas unidades, quanto vale. Não toca no banco. */
export function planejarCortesia(itens: ItemParaCortesia[], pedido: { itemId?: unknown; quantidade?: unknown }): PlanoDaCortesia {
  const item = (itens || []).find((i) => i.id === String(pedido?.itemId || ""));
  if (!item) return { ok: false, erro: "Item não encontrado neste pedido." };
  const preco = Number(item.price) || 0;
  if (!(preco > 0)) return { ok: false, erro: "Este item já está a R$ 0,00." };
  const pedida = pedido?.quantidade == null ? item.quantity : Math.round(Number(pedido.quantidade));
  if (!Number.isFinite(pedida) || pedida < 1) return { ok: false, erro: "Diga quantas unidades são cortesia." };
  if (pedida > item.quantity) return { ok: false, erro: `O item tem ${item.quantity} unidade${item.quantity > 1 ? "s" : ""}.` };
  const nome = String(item.productName || "item").trim() || "item";
  const valor = centavos(preco * pedida);
  return {
    ok: true,
    item,
    quantidade: pedida,
    separa: pedida < item.quantity,
    linha: { nome, quantidade: pedida, valor },
    descricao: `cortesia: ${pedida}x ${nome} (R$ ${valor.toFixed(2).replace(".", ",")})`,
  };
}
