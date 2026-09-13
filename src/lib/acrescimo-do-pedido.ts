/**
 * /src/lib/acrescimo-do-pedido.ts
 *
 * Cliente com pedido na cozinha pede, pelo robô do WhatsApp, para acrescentar
 * itens. Quem decide se ainda dá tempo é a loja, na tela; aqui mora só a regra
 * — quem pode pedir e o que se diz ao cliente. Sem banco e sem rede de
 * propósito: é provado por scripts/teste-acrescimo-do-pedido.mjs.
 *
 * ── O caso que originou (Hakim Centro, 12/09/2026) ──────────────────────────
 *
 * A Gabi tinha o #48 (site) em preparo e voltou ao WhatsApp querendo mais
 * coisa. O robô abriu um pedido NOVO (o rascunho #N257, "Retirada no local"),
 * que caiu por inatividade e ainda saiu na impressora. O certo era perguntar o
 * que ela queria acrescentar e levar a pergunta à cozinha.
 *
 * ── Por que só site e WhatsApp ──────────────────────────────────────────────
 *
 * O pedido do site e o do robô são nossos: dá para incluir item e mudar o
 * total. O de marketplace (iFood, 99Food, JotaJá, Brendi, Wabiz) é do app — o
 * valor e a cobrança são deles, e item incluído aqui não aparece lá. Nesses o
 * robô explica que não dá, sugere um pedido novo e oferece chamar a cozinha.
 */

/** Onde o pedido ainda pode receber item: não saiu da loja nem foi encerrado. */
export const STATUS_QUE_ACEITAM_ACRESCIMO = [
  "NOVO", "RECEBIDO", "PENDENTE", "CONFIRMADO", "ACEITO",
  "PREPARANDO", "EM_PREPARO", "EM_ANDAMENTO", "PRONTO",
] as const;

/** Canais de pedido que são nossos (chaves de lib/canal-do-pedido.ts). */
export const CANAIS_QUE_ACEITAM_ACRESCIMO = ["SITE", "WHATSAPP_IA"] as const;

export type Elegibilidade =
  | { pode: true }
  | { pode: false; motivo: "CANAL" | "STATUS" };

export function podeAcrescentar(pedido: { status?: string | null; canal?: string | null }): Elegibilidade {
  const status = String(pedido.status || "").toUpperCase();
  if (!(STATUS_QUE_ACEITAM_ACRESCIMO as readonly string[]).includes(status)) return { pode: false, motivo: "STATUS" };
  if (!(CANAIS_QUE_ACEITAM_ACRESCIMO as readonly string[]).includes(String(pedido.canal || ""))) {
    return { pode: false, motivo: "CANAL" };
  }
  return { pode: true };
}

export type ItemDoAcrescimo = { name: string; quantity: number; price: number; menuProductId?: string | null };

export const centavos = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export function subtotalDoAcrescimo(itens: ItemDoAcrescimo[]): number {
  return centavos(itens.reduce((soma, i) => soma + (Number(i.price) || 0) * (Number(i.quantity) || 0), 0));
}

/** "12,00" — o número no formato do Brasil; quem chama põe o "R$" na frente. */
export function reais(n: number): string {
  return centavos(n).toFixed(2).replace(".", ",");
}

/** "1x Coca-Cola 2L (12,00), 2x Pastel de Carne (18,00)" */
export function listaDosItens(itens: ItemDoAcrescimo[]): string {
  return itens
    .map((i) => `${i.quantity}x ${i.name} (R$ ${reais((Number(i.price) || 0) * (Number(i.quantity) || 0))})`)
    .join(", ");
}

const numeroDoPedido = (numero: string | number | null | undefined) =>
  numero != null && String(numero).trim() !== "" ? `#${numero}` : "";

export function mensagemAcrescimoAceito(e: {
  numero?: string | number | null;
  itens: ItemDoAcrescimo[];
  novoTotal: number;
  cobrarDiferencaNaEntrega?: boolean;
}): string {
  const pedido = numeroDoPedido(e.numero);
  const cobranca = e.cobrarDiferencaNaEntrega
    ? `\nA diferença de R$ ${reais(subtotalDoAcrescimo(e.itens))} é paga na entrega. 😉`
    : "";
  return (
    `Boa notícia! 🎉 A cozinha conseguiu incluir no seu pedido ${pedido}: ${listaDosItens(e.itens)}.\n` +
    `Novo total do pedido: R$ ${reais(e.novoTotal)}.${cobranca}`
  ).replace(/  +/g, " ");
}

export function mensagemAcrescimoRecusado(e: { numero?: string | number | null; motivo?: string | null }): string {
  const pedido = numeroDoPedido(e.numero);
  const motivo = String(e.motivo || "").trim();
  return (
    `Poxa! 😕 A cozinha não conseguiu incluir os itens no seu pedido ${pedido}` +
    (motivo ? `: ${motivo}` : ".") +
    `\nSe quiser, eu anoto esses itens num pedido novo — é só me dizer!`
  ).replace(/  +/g, " ").replace(/: *\./, ".");
}

export function mensagemAcrescimoExpirado(e: { numero?: string | number | null }): string {
  const pedido = numeroDoPedido(e.numero);
  return (
    `Poxa! 😕 Não deu tempo de incluir os itens: seu pedido ${pedido} já saiu da cozinha.` +
    `\nSe quiser, eu anoto esses itens num pedido novo — é só me dizer!`
  ).replace(/  +/g, " ");
}

/**
 * Pedido pago antes (online): a diferença não entra no que já foi cobrado e
 * precisa ser recebida na entrega. A prova é a confirmação do pagamento
 * (`paymentPaidAt`, `pagarmeStatus = paid`); o texto "(Pago Online)" da forma
 * de pagamento fica como reserva para pedido antigo sem carimbo.
 */
export function pedidoJaPago(pedido: {
  paymentMethod?: string | null;
  paymentPaidAt?: Date | string | null;
  pagarmeStatus?: string | null;
}): boolean {
  if (pedido.paymentPaidAt) return true;
  if (String(pedido.pagarmeStatus || "").toLowerCase() === "paid") return true;
  return /\(pago/.test(String(pedido.paymentMethod || "").toLowerCase());
}
