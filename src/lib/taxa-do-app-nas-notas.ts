/**
 * A TAXA DE SERVIÇO E A GORJETA DO APP, NA CONTA DO PEDIDO.
 *
 * O pedido do Open Delivery (Keeta, aiqfome, Anota AI, CardápioWeb —
 * lib/open-delivery/traducao.ts) não tem coluna para elas: as duas viram
 * linhas nas observações. Só que a conta do pedido, no quadro e na comanda,
 * mostrava Itens + Entrega e um Total maior, e a diferença ficava sem
 * explicação: Keeta #3843, Pepperoni R$ 66 + entrega R$ 1 com Total R$ 69,99
 * (R$ 0,99 de taxa de serviço da Keeta + R$ 2 de gorjeta, 04/11/2026). Com as
 * linhas próprias a conta fecha na frente do lojista.
 *
 * As linhas são escritas e lidas só aqui, então o formato não se espalha —
 * como a etiqueta de lib/acrescimo-no-credito.ts. Lê também o pedido que já
 * entrou, porque o texto é o mesmo de sempre.
 *
 * Sem import nenhum de propósito: roda no navegador (quadro) e no servidor.
 */

/** `💳 Taxa de serviço Keeta: R$0.99 (fica com a plataforma)` — o que vai em `notes`. */
export function linhaDaTaxaDoApp(canal: string, valor: number): string {
  return `💳 Taxa de serviço ${canal}: R$${valor.toFixed(2)} (fica com a plataforma)`;
}

/** `💝 Gorjeta: R$2.00` — o que vai em `notes`. */
export function linhaDaGorjeta(valor: number): string {
  return `💝 Gorjeta: R$${valor.toFixed(2)}`;
}

const TAXA = /💳 Taxa de serviço (.+?): R\$(\d+\.\d{2}) \(fica com a plataforma\)/;
const GORJETA = /💝 Gorjeta: R\$(\d+\.\d{2})/;

export type TaxasDoApp = { canal: string; taxaServico: number; gorjeta: number };

/** A taxa e a gorjeta gravadas no pedido. Null quando não tem nenhuma das duas. */
export function taxasDoAppNasNotas(pedido: { notes?: string | null } | null | undefined): TaxasDoApp | null {
  const notas = String(pedido?.notes || "");
  const t = TAXA.exec(notas);
  const g = GORJETA.exec(notas);
  const taxaServico = t ? Number(t[2]) : 0;
  const gorjeta = g ? Number(g[1]) : 0;
  if (!(taxaServico > 0) && !(gorjeta > 0)) return null;
  return { canal: t ? t[1] : "", taxaServico, gorjeta };
}

/**
 * Os campos que a COMANDA lê. Espalhe DEPOIS do pedido, como
 * `camposDeDesconto99ParaImpressao`.
 *
 * Vai em `serviceFee` + `serviceFeeLabel`, a linha que o Assistente já soma na
 * conta "subtotal − desconto + entrega + taxa = total". Ele não tem campo de
 * gorjeta para pedido de app, então a gorjeta vai junto, no rótulo — senão
 * sobrava como "Outros valores do pedido". ASCII: o rótulo já vai pronto
 * para a bobina.
 *
 * Pedido do 99Food e do cardápio nunca têm estas linhas, então ninguém disputa
 * o campo.
 */
export function camposDaTaxaDoAppParaImpressao(
  pedido: { notes?: string | null } | null | undefined,
): Record<string, unknown> {
  const t = taxasDoAppNasNotas(pedido);
  if (!t) return {};
  const canal = t.canal.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const doCanal = canal ? ` (${canal})` : "";
  const rotulo =
    t.taxaServico > 0 && t.gorjeta > 0 ? `Taxa e gorjeta${doCanal}:` : t.taxaServico > 0 ? `Taxa de servico${doCanal}:` : "Gorjeta:";
  return {
    serviceFee: Math.round((t.taxaServico + t.gorjeta) * 100) / 100,
    serviceFeeLabel: rotulo,
  };
}
