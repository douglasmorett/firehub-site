/**
 * ACRÉSCIMO PARA QUEM PAGA NO CRÉDITO (a taxa da maquininha repassada ao cliente).
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 *
 * Pizzou153 (Maxuel, 14/10/2026): "não montei meus valores pra absorver a taxa
 * da maquininha; a maioria das pizzarias cobra taxa no crédito". A loja escolhe
 * um % (ex.: 3,86) em Minha Loja → Formas de Pagamento → Cartão de crédito, e o
 * pedido pago no crédito sobe esse %, numa linha própria:
 *
 *     Acréscimo no crédito (3,86%): R$ 3,09
 *
 * NÃO é o `paymentFees.CREDITO.rate`. Aquele é o que a maquininha cobra DA LOJA
 * (vai para o relatório de lucro, o cliente nunca vê). Este é cobrado DO
 * CLIENTE e é receita do pedido: entra no `totalAmount` e, com ele, em
 * faturamento, ticket e caixa.
 *
 * Mora em `paymentFees.CREDITO.acrescimo` (número, 0–20). Ausente ou 0 = nada
 * muda: é o padrão de todas as lojas.
 *
 * ── Qual crédito ────────────────────────────────────────────────────────────
 *
 * Só o crédito na MAQUININHA (entrega ou retirada). O cartão pelo site
 * (CREDITO_ONLINE, Asaas) fica de fora de propósito: ele tem a régua própria
 * em lib/desconto-pagamento-online.ts (a loja até DÁ desconto a quem paga por
 * lá), e o Asaas cobra o total gravado — a confirmação recusa valor que difere
 * dele, então misturar as duas contas é onde o pagamento online pararia de
 * fechar.
 *
 * ── Onde fica gravado ───────────────────────────────────────────────────────
 *
 * Numa etiqueta nas observações do pedido, como o desconto do pagamento pelo
 * site e o cashback já fazem: `[Acréscimo no crédito (3,86%): +R$ 3,09]`.
 * Assim aparece no painel, na comanda (inclusive no Assistente antigo, que não
 * conhece campo novo) e para o robô, sem coluna nova no banco. Quem precisa do
 * NÚMERO (a linha da comanda, a conta da tela, a edição de itens, a NFC-e) lê
 * de volta por `acrescimoGravadoNoPedido` — a etiqueta é escrita e lida só
 * aqui, então o formato não se espalha.
 */

/** Teto do %: acima disso é erro de digitação (38,6 no lugar de 3,86). */
export const ACRESCIMO_NO_CREDITO_MAXIMO = 20;

const centavos = (n: number) => Math.round(n * 100) / 100;

/** O % que a loja gravou, já limpo (ausente, negativo, texto = 0; acima do teto = teto). */
export function percentualDoAcrescimoNoCredito(paymentFees: unknown): number {
  const bruto = (paymentFees as any)?.CREDITO?.acrescimo;
  const n = Number(typeof bruto === "string" ? bruto.replace(",", ".") : bruto);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(ACRESCIMO_NO_CREDITO_MAXIMO, Math.round(n * 100) / 100);
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * O texto de pagamento é crédito NA MAQUININHA?
 *
 * O cardápio grava "CREDITO"; o painel, o PDV e o robô gravam rótulos
 * ("Cartão de Crédito", "Crédito (Entrega)", "credito na entrega"). A régua é
 * a de lib/relatorios/formas-de-pagamento.ts (`formaDoTexto`): o que fala em
 * débito, dinheiro, pix, vale ou fiado NÃO é crédito, mesmo citando crédito
 * junto ("Crédito + Débito" é ambíguo e fica de fora). E o que é pelo site
 * (online, Asaas, gateway) também não — ver o cabeçalho.
 */
export function ehCreditoNaMaquininha(paymentMethod: unknown): boolean {
  const m = semAcento(String(paymentMethod || "")).trim();
  if (!m) return false;
  if (!/credit/.test(m)) return false;
  if (/online|pelo site|site|asaas|mercadopago|gateway|link/.test(m)) return false;
  if (/debit|dinheiro|cash|pix|voucher|vale|meal|fiado|funcion/.test(m)) return false;
  return true;
}

export type AcrescimoNoCredito = { percentual: number; valor: number; rotulo: string };

const pctEmTexto = (pct: number) => String(pct).replace(".", ",");
const reais = (v: number) => v.toFixed(2).replace(".", ",");

/**
 * O acréscimo deste pedido, ou null quando não há (loja sem %, forma que não
 * é crédito, base zerada).
 *
 * `base` = itens − descontos + entrega: é o que o cliente ia pagar na
 * maquininha, e a maquininha cobra a loja sobre o valor passado inteiro —
 * entrega inclusa. Centavos arredondados (meio centavo sobe).
 */
export function acrescimoNoCredito(opts: {
  paymentFees: unknown;
  paymentMethod: unknown;
  base: number;
}): AcrescimoNoCredito | null {
  if (!ehCreditoNaMaquininha(opts.paymentMethod)) return null;
  const percentual = percentualDoAcrescimoNoCredito(opts.paymentFees);
  if (percentual <= 0) return null;
  const base = Math.max(0, Number(opts.base) || 0);
  // `+ 1e-9`: 80 × 3,86% = 3,088 vira 308,79999… em ponto flutuante.
  const valor = Math.round(base * percentual + 1e-9) / 100;
  if (valor <= 0) return null;
  return { percentual, valor, rotulo: `Acréscimo no crédito (${pctEmTexto(percentual)}%)` };
}

// ── A ETIQUETA NAS OBSERVAÇÕES ──────────────────────────────────────────────

/** `[Acréscimo no crédito (3,86%): +R$ 3,09]` — o que vai em `notes`. */
export function etiquetaDoAcrescimo(a: AcrescimoNoCredito): string {
  return `[${a.rotulo}: +R$ ${reais(a.valor)}]`;
}

const ETIQUETA = /\[Acr[ée]scimo no cr[ée]dito \((\d+(?:[.,]\d+)?)%\): \+R\$ (\d[\d.]*,\d{2})\]/i;

/**
 * O acréscimo que o servidor gravou no pedido, lido da etiqueta. Null quando o
 * pedido não tem (todo pedido de antes, de outro canal, ou de loja sem %).
 */
export function acrescimoGravadoNoPedido(
  pedido: { notes?: string | null } | null | undefined,
): AcrescimoNoCredito | null {
  const m = ETIQUETA.exec(String(pedido?.notes || ""));
  if (!m) return null;
  const percentual = Number(m[1].replace(",", "."));
  const valor = centavos(Number(m[2].replace(/\./g, "").replace(",", ".")));
  if (!Number.isFinite(valor) || valor <= 0) return null;
  return { percentual, valor, rotulo: `Acréscimo no crédito (${pctEmTexto(percentual)}%)` };
}

/** Só o valor, em reais (0 quando não há) — para as contas. */
export function valorDoAcrescimoGravado(pedido: { notes?: string | null } | null | undefined): number {
  return acrescimoGravadoNoPedido(pedido)?.valor || 0;
}

/**
 * Os campos que a COMANDA lê. Espalhe DEPOIS do pedido, como
 * `camposDeDesconto99ParaImpressao`.
 *
 * Vai em `serviceFee` + `serviceFeeLabel`, os campos que o Assistente já usa
 * para a taxa de serviço do 99Food (server.js, bloco de totais): ele soma o
 * valor na conta "subtotal − desconto + entrega + taxa = total" e imprime a
 * linha com o rótulo que vier. Assistente sem esse suporte cai na linha
 * "Outros valores do pedido" com o mesmo número, e a etiqueta nas observações
 * explica — nenhum papel sai com total errado. ASCII: o Assistente limpa
 * acento, mas o rótulo já vai pronto para a bobina.
 *
 * Pedido do 99Food nunca tem a etiqueta (ela nasce em api/customer-order), então
 * os dois nunca disputam o campo.
 */
export function camposDoAcrescimoParaImpressao(
  pedido: { notes?: string | null } | null | undefined,
): Record<string, unknown> {
  const a = acrescimoGravadoNoPedido(pedido);
  if (!a) return {};
  return {
    serviceFee: a.valor,
    serviceFeeLabel: `Acrescimo no credito (${pctEmTexto(a.percentual)}%):`,
  };
}
