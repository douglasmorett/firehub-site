import { formaLigada } from "@/lib/formas-do-cardapio";

/**
 * O CLIENTE ESCOLHE A FORMA NA TELA DO TOTEM (Douglas, 12/11/2026).
 *
 * Antes o totem tinha só "Pagar na maquininha", e a maquininha perguntava de
 * novo: Crédito, Débito, Vale ou Pix. Era um toque a mais em pé na frente da
 * maquininha, e o Pix saía pela adquirente. Agora:
 *
 *  - aparecem só as formas que a loja aceita (Minha Loja → Formas de
 *    Pagamento, `paymentFees.<FORMA>.active`);
 *  - Crédito, Débito e Vale vão para a maquininha JÁ escolhidos — o app abre
 *    direto a tela da adquirente;
 *  - Pix é sempre o Pix do FireHub (Asaas da loja, `pixOnlineAtivo`), com o QR
 *    na própria tela do totem. Nunca o Pix da maquininha.
 */

export type FormaDoTotem = "CREDITO" | "DEBITO" | "VOUCHER" | "PIX";

const CARTOES: readonly FormaDoTotem[] = ["CREDITO", "DEBITO", "VOUCHER"];

/** O texto gravado em `paymentMethod` até a cobrança devolver o tipo real. */
const TEXTO: Record<FormaDoTotem, string> = {
  CREDITO: "Cartão Crédito (Maquininha)",
  DEBITO: "Cartão Débito (Maquininha)",
  VOUCHER: "Vale (Maquininha)",
  // É o que lib/pix-online-pedido.ts (formaDoPedido) reconhece como Pix pelo site.
  PIX: "PIX_ONLINE",
};

export const ROTULO_DA_FORMA: Record<FormaDoTotem, string> = {
  CREDITO: "Crédito",
  DEBITO: "Débito",
  VOUCHER: "Vale-refeição",
  PIX: "Pix",
};

/**
 * Aceita as nossas chaves e o vocabulário que /api/totem/payment/start já usava
 * com a Stone (credit|debit|voucher|pix) — o totem manda este último.
 */
export function lerFormaDoTotem(valor: unknown): FormaDoTotem | null {
  const v = String(valor ?? "").trim().toUpperCase();
  const daStone: Record<string, FormaDoTotem> = { CREDIT: "CREDITO", DEBIT: "DEBITO" };
  if (daStone[v]) return daStone[v];
  return (["CREDITO", "DEBITO", "VOUCHER", "PIX"] as const).find((f) => f === v) ?? null;
}

export function ehCartao(forma: FormaDoTotem | null): forma is "CREDITO" | "DEBITO" | "VOUCHER" {
  return forma !== null && CARTOES.includes(forma);
}

export function textoDaForma(forma: FormaDoTotem): string {
  return TEXTO[forma];
}

/**
 * As formas que o totem desta loja oferece. Os cartões dependem ainda de haver
 * maquininha (ou pinpad) — isso a tela sabe e o servidor confere no start.
 */
export function formasDoTotem(loja: { paymentFees: unknown; pixOnlineAtivo: boolean | null | undefined }): FormaDoTotem[] {
  const formas: FormaDoTotem[] = CARTOES.filter((f) => formaLigada(loja.paymentFees, f));
  if (loja.pixOnlineAtivo) formas.push("PIX");
  return formas;
}

/**
 * A forma já escolhida que vai junto da cobrança para a maquininha. Lê o texto
 * gravado por `textoDaForma`; qualquer outro (totem antigo, "Cartão
 * (Maquininha)") é null e o app pergunta como antes.
 */
export function formaParaAMaquininha(paymentMethod: string | null | undefined): "CREDITO" | "DEBITO" | "VOUCHER" | null {
  const pm = String(paymentMethod || "").trim();
  if (pm === TEXTO.CREDITO) return "CREDITO";
  if (pm === TEXTO.DEBITO) return "DEBITO";
  if (pm === TEXTO.VOUCHER) return "VOUCHER";
  return null;
}
