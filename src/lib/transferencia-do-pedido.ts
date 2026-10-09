/**
 * "Enviar para outra loja" — a regra da transferência de pedido entre as
 * lojas do mesmo acesso.
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 *
 * Pizzaria 17 (Antonio, 09/10/2026): o pedido #104 da Bia, do site, era do
 * Aeroporto e caiu no Lagomar — e não havia como mudar de unidade. Ele pediu
 * "um botãozinho, tipo o que escolhe o motoboy: enviar pedido para outra
 * unidade", que serve também quando uma loja está com problema operacional.
 * O Douglas desenhou:
 *
 *   - No ✏️ Editar, quem tem mais de uma loja no mesmo acesso escolhe a loja e
 *     ESCREVE uma confirmação (a mudança é séria: o pedido sai desta loja).
 *   - A outra loja vê na tela "Este pedido foi enviado da loja X para esta
 *     loja. Aceitar?" e pode NÃO aceitar, escrevendo o motivo.
 *   - Aceito, o pedido entra lá no fim da fila, com o número do dia DE LÁ, e a
 *     comanda sai na impressora de lá. A numeração daqui não é respeitada, de
 *     propósito: não embola a operação de ninguém.
 *
 * Enquanto a outra loja não responde, o pedido CONTINUA nesta loja: nunca
 * fica num limbo sem dono, nem imprime lá antes de alguém aceitar. Recusado,
 * ele segue aqui e esta loja vê o motivo.
 *
 * Arquivo puro (o banco mora em lib/transferencia-no-banco.ts): tem teste que
 * o carrega sozinho (scripts/teste-transferencia-do-pedido.ts).
 */
import { CANAIS_DA_LOJA } from "./pedido-do-cliente";

/** A palavra que confirma a transferência. */
export const PALAVRA_DE_CONFIRMACAO = "transferir";

/** O que a pessoa escreveu confirma? Sem acento e sem caixa: "Transferir" vale. */
export function confirmacaoValida(texto: unknown): boolean {
  const limpo = String(texto ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .trim()
    .toLowerCase();
  return limpo === PALAVRA_DE_CONFIRMACAO;
}

/** Status em que o pedido ainda está NA loja (não saiu, não acabou). */
const STATUS_QUE_TRANSFEREM = new Set(["NOVO", "ACEITO", "CONFIRMADO", "PREPARANDO", "EM_PREPARO", "EM_ANDAMENTO", "PRONTO"]);

export type PedidoParaTransferir = {
  status?: unknown;
  source?: unknown;
  franchiseeId?: unknown;
  tableSessionId?: unknown;
  ifoodOrderId?: unknown;
  openDeliveryOrderId?: unknown;
  gatewayProvider?: unknown;
  gatewayPaymentId?: unknown;
  fiscalStatus?: unknown;
};

/**
 * Por que este pedido NÃO pode ir para outra loja — ou null, pode.
 *
 * `grupo` = os ids das lojas do mesmo acesso; `para` = a loja escolhida
 * (ausente = só a pergunta "dá para transferir?", sem destino ainda).
 */
export function motivoQueImpede(
  pedido: PedidoParaTransferir | null | undefined,
  opcoes: { grupo: string[]; para?: string | null }
): string | null {
  if (!pedido) return "Pedido não encontrado.";
  const de = String(pedido.franchiseeId || "");
  if (opcoes.grupo.length < 2) return "Esta conta tem uma loja só.";
  if (!opcoes.grupo.includes(de)) return "O pedido não é de uma loja deste acesso.";
  if (opcoes.para != null) {
    if (!opcoes.para) return "Escolha a loja.";
    if (opcoes.para === de) return "O pedido já é desta loja.";
    if (!opcoes.grupo.includes(opcoes.para)) return "A loja escolhida não é deste acesso.";
  }

  const status = String(pedido.status || "").toUpperCase();
  if (status === "CRIANDO_IA") return "O robô ainda está montando este pedido: a loja se escolhe ao aceitar.";
  if (status === "AGUARDANDO_PAGAMENTO") return "O pedido ainda espera o pagamento.";
  if (!STATUS_QUE_TRANSFEREM.has(status)) {
    return status.startsWith("SAIU") || status === "EM_ROTA" || status === "DESPACHADO"
      ? "O pedido já saiu para entrega."
      : "O pedido já foi encerrado.";
  }

  if (pedido.tableSessionId) return "Pedido de mesa fica com a conta da mesa.";
  // O pedido do iFood/99/Brendi mora na plataforma, com o cadastro de UMA loja:
  // daqui, a outra loja não conseguiria aceitar, despachar nem concluir.
  if (pedido.ifoodOrderId || pedido.openDeliveryOrderId || !CANAIS_DA_LOJA.includes(String(pedido.source || "").toUpperCase())) {
    return "Pedido de aplicativo (iFood, 99…) fica na loja cadastrada no aplicativo.";
  }
  // O Pix/cartão pago pelo site caiu na conta DESTA loja (lib/pix-online): o
  // estorno de um cancelamento lá sairia da conta errada.
  // (Pago no caixa da loja não conta: `paymentPaidAt` sozinho é a gaveta.)
  if (pedido.gatewayProvider || pedido.gatewayPaymentId) {
    return "O pedido foi pago online e o dinheiro está na conta desta loja.";
  }
  // A NFC-e leva o CNPJ desta loja.
  if (String(pedido.fiscalStatus || "").toUpperCase() === "EMITTED") {
    return "A nota fiscal deste pedido já saiu com o CNPJ desta loja.";
  }
  return null;
}

/** O motivo da recusa: o mesmo piso do cancelamento (3 letras). */
export function motivoDaRecusa(texto: unknown): string {
  const limpo = String(texto ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  return (limpo.match(/\p{L}/gu) || []).length >= 3 ? limpo : "";
}

/** A linha que fica na observação do pedido aceito. */
export function notaDaTransferencia(de: string, quem: string): string {
  return `🏪 Transferido da loja ${de || "outra loja"} (por ${quem || "a loja"})`;
}
