/**
 * TROCO FEITO PELO PIX — o cliente pagou em dinheiro com nota maior e o troco
 * voltou para ele por Pix, não em cédula.
 *
 * ── De onde veio ───────────────────────────────────────────────────────────
 *
 * Allan (Delícia de Casa, 16/10/2026): o cliente paga com R$ 50 um pedido de
 * R$ 40 sem ter avisado o troco, o motoboy não tem os R$ 10 e o troco vai por
 * Pix — da conta da loja ou do celular do próprio motoboy. Com "troco para 50"
 * gravado, o sistema dava como certo que os R$ 10 tinham saído EM DINHEIRO da
 * gaveta com o motoboy e voltado com a nota: o acerto cobrava do motoboy a
 * nota inteira e o caixa esperava na gaveta só o valor do pedido. Nenhum dos
 * dois aconteceu, e o fechamento não batia. Decisão do Douglas (17/10/2026):
 * "troco feito no Pix a gente pode colocar na forma de pagamento: editar a
 * forma de pagamento → troco feito pelo Pix; aí não sai do caixa da loja e
 * contabiliza só o valor do pedido no caixa, para o caixa fechar certo".
 *
 * ── O que a marca muda, por quem fez o Pix ────────────────────────────────
 *
 * O valor do troco não é gravado: é a nota (`changeAmount`, "troco para") menos
 * a parte em dinheiro, a mesma conta do troco levado (`partesDaEntrega`, em
 * lib/resumo-do-entregador.ts). Gravar o número à parte deixaria os dois
 * descolarem na primeira vez que alguém corrigisse a nota.
 *
 *   • LOJA — o Pix saiu da conta da loja. Nenhuma cédula de troco saiu da
 *     gaveta, e a nota inteira do cliente entra nela: o caixa espera a NOTA no
 *     dinheiro e o troco A MENOS no Pix (saiu da conta). A venda continua sendo
 *     o valor do pedido — dinheiro + Pix do pedido somam exatamente ele. No
 *     acerto, o motoboy entrega a nota inteira, sem "troco levado".
 *
 *   • MOTOBOY — o Pix saiu do bolso do motoboy. Ele fica com a diferença da
 *     nota (é o reembolso do Pix que ele fez) e entrega à loja só o valor do
 *     pedido. A gaveta recebe o valor do pedido, como o caixa já esperava; o
 *     acerto deixa de cobrar dele o troco que não saiu da loja e mostra, à
 *     parte, quanto ele bancou e já recuperou da nota. Nada entra no "a pagar":
 *     o ganho dele não muda por causa de um troco.
 */

export type QuemFezOPix = "LOJA" | "MOTOBOY";

/** A marca gravada no pedido (`CustomerOrder.trocoNoPix`). */
export type TrocoNoPix = {
  por: QuemFezOPix;
  /** Quando a loja marcou (ISO). */
  quando?: string | null;
  /** Quem marcou: nome ou e-mail do operador. */
  quem?: string | null;
};

/** Lê a marca do banco. Qualquer coisa que não seja uma marca válida é "sem marca". */
export function lerTrocoNoPix(bruto: unknown): TrocoNoPix | null {
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return null;
  const por = String((bruto as any).por || "").toUpperCase();
  if (por !== "LOJA" && por !== "MOTOBOY") return null;
  const quando = typeof (bruto as any).quando === "string" ? (bruto as any).quando : null;
  const quem = typeof (bruto as any).quem === "string" ? (bruto as any).quem : null;
  return { por, quando, quem };
}

/**
 * O campo para o `select` do Prisma, já tipado como "nada".
 *
 * A coluna é nova (garantir-colunas.ts cria no boot) e o cliente do Prisma que
 * a pasta de trabalho usa é gerado do master: escrever `trocoNoPix: true`
 * direto no select quebraria o tsc até o merge. Espalhado assim, o select leva
 * o campo e o tipo não reclama; quem lê usa `lerTrocoNoPix((o as any).trocoNoPix)`.
 * Depois do merge pode virar `trocoNoPix: true` normal — o resultado é o mesmo.
 */
export const SELECT_TROCO_NO_PIX = { trocoNoPix: true } as {};

const dinheiro = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;

/** "Troco feito pelo Pix: R$ 10,00 (Pix da loja)" — a linha do detalhe e da comanda. */
export function textoDoTrocoNoPix(valor: number, por: QuemFezOPix): string {
  return `Troco feito pelo Pix: ${dinheiro(valor)} (${por === "MOTOBOY" ? "Pix do motoboy" : "Pix da loja"})`;
}

/**
 * O troco no Pix de um pedido, pronto para mostrar: a marca e o valor (nota −
 * pedido). Sem marca, sem nota ou com a nota que não passa do pedido: null.
 * Para pedido com pagamento dividido, quem soma por parte é `partesDaEntrega`;
 * aqui a nota é comparada com a parte em dinheiro, como lá.
 */
export function trocoNoPixDoPedido(o: {
  trocoNoPix?: unknown;
  changeAmount?: number | null;
  totalAmount?: number | null;
  paymentMethods?: unknown;
}): { valor: number; por: QuemFezOPix } | null {
  const marca = lerTrocoNoPix(o?.trocoNoPix);
  if (!marca) return null;
  const nota = Number(o.changeAmount || 0);
  const partes = Array.isArray(o.paymentMethods) ? o.paymentMethods : [];
  const parteEmDinheiro = partes.find((p: any) => /dinheiro/i.test(String(p?.method || p?.metodo || "")));
  const base = parteEmDinheiro ? Number(parteEmDinheiro.amount ?? parteEmDinheiro.valor) || 0 : Number(o.totalAmount || 0);
  const valor = Math.round((nota - base) * 100) / 100;
  if (!(nota > 0) || valor <= 0) return null;
  return { valor, por: marca.por };
}
