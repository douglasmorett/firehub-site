/**
 * Quem bancou o desconto de um pedido do 99Food: a LOJA ou o 99.
 *
 * ── Por que isto é uma pergunta ────────────────────────────────────────────
 *
 * O pedido #266003 do Frangoso (17/09/2026) saiu com "Desconto R$ 70,00" e
 * "Total R$ 1,97", e o dono leu como se a loja tivesse pago o combo inteiro
 * para o cliente. Não tinha: R$ 20 eram dela (R$ 12 no item + R$ 8 de frete
 * grátis) e R$ 50 eram cupom do 99Food, do bolso do 99. A loja RECEBE
 * R$ 50,98 — o "Total de ganhos após descontos" do painel deles. O iFood já
 * chegava separado (discountMerchant / discountIfood); o 99 chegava num
 * número só, e o lojista pedia "igual faz no iFood".
 *
 * O 99 manda isso em `promotions[]`: `promo_discount` é o desconto e
 * `shop_subside_price` é a parte que a LOJA paga. O que sobra é o 99.
 *
 * ── Uma régua, quatro leitores ─────────────────────────────────────────────
 *
 * O tradutor (food99-pedido.ts) usa `repartirDesconto99` quando o pedido
 * nasce e grava o resultado em `discountMerchant` (loja) e `discountIfood`
 * (plataforma — nome histórico do iFood; caixa e comanda o leem como
 * "desconto da plataforma"). Mas os 128 pedidos do 99 anteriores a
 * 18/09/2026 nasceram SEM essas colunas — e todos guardam `promocoes` em
 * `discountDetails`. `separacaoDoDesconto99` lê o pedido como está no banco:
 * coluna se houver, `promocoes` se não. Recibo do painel, comanda impressa e
 * fila do Assistente chamam esta função, então pedido antigo e novo saem
 * iguais, sem acertar banco nenhum.
 *
 * Sem `promotions` (app antigo do 99) tudo cai na loja — é o que sempre foi
 * feito, e um desconto do 99 lido como da loja só faz a loja achar que
 * ganhou menos, nunca mais.
 *
 * Sem import nenhum de propósito: roda no navegador (recibo) e no servidor.
 */

export type ReparticaoDoDesconto99 = {
  /** O que saiu do bolso da LOJA. */
  loja: number;
  /** O que o 99Food pagou do bolso dele. */
  plataforma: number;
  /** Taxa de serviço que o 99 cobra do cliente (entra no total, não é da loja). */
  taxaServico: number;
  /** O que a loja recebe deste pedido, antes da comissão: pago + plataforma − serviço. */
  recebeLoja: number;
};

/** O que a separação precisa ler de um pedido — do banco ou do webhook. */
export type PedidoParaSeparacao = {
  source?: string | null;
  openDeliveryChannel?: string | null;
  totalAmount?: number | null;
  discountTotal?: number | null;
  discountMerchant?: number | null;
  discountIfood?: number | null;
  discountDetails?: unknown;
};

const centavos = (n: number) => Math.round(n * 100) / 100;
/** Centavos do 99 → reais. Ausente ou lixo vira 0. */
const deCentavos = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? centavos(n / 100) : 0;
};

export function ehPedido99Food(p: Pick<PedidoParaSeparacao, "source" | "openDeliveryChannel">): boolean {
  return (
    String(p.source || "").toUpperCase() === "99FOOD" ||
    String(p.openDeliveryChannel || "").toUpperCase() === "99FOOD"
  );
}

/** A conta em si, sobre o que o 99 mandou. Quem tem o pedido do banco usa `separacaoDoDesconto99`. */
export function repartirDesconto99(entrada: {
  descontoTotal: number;
  promocoes: unknown;
  taxaServico: number;
  totalPago: number;
}): ReparticaoDoDesconto99 {
  const total = Math.max(0, Number(entrada.descontoTotal) || 0);
  const promocoes = Array.isArray(entrada.promocoes) ? (entrada.promocoes as any[]) : [];
  let loja = total;
  let plataforma = 0;
  if (promocoes.length > 0) {
    const pagoPelaLoja = promocoes.reduce((s, p) => s + deCentavos(p?.shop_subside_price), 0);
    const somaDasPromocoes = promocoes.reduce((s, p) => s + deCentavos(p?.promo_discount), 0);
    plataforma = Math.max(0, centavos(somaDasPromocoes - pagoPelaLoja));
    loja = Math.max(0, centavos(total - plataforma));
  }
  const taxaServico = Math.max(0, Number(entrada.taxaServico) || 0);
  const totalPago = Number(entrada.totalPago) || 0;
  return { loja, plataforma, taxaServico, recebeLoja: centavos(totalPago + plataforma - taxaServico) };
}

function detalhes(p: PedidoParaSeparacao): Record<string, unknown> {
  const dd = p.discountDetails;
  return dd && typeof dd === "object" && !Array.isArray(dd) ? (dd as Record<string, unknown>) : {};
}

/** A taxa de serviço do 99 como o pedido a guarda: campo próprio desde 17/09/2026, `precoCru` antes disso. */
export function taxaDeServico99(p: PedidoParaSeparacao | null | undefined): number {
  if (!p || !ehPedido99Food(p)) return 0;
  const dd = detalhes(p);
  const propria = Number(dd.taxaServico);
  if (Number.isFinite(propria) && propria > 0) return centavos(propria);
  const cru = dd.precoCru as Record<string, unknown> | undefined;
  const outras =
    cru && typeof cru.others_fees === "object" && cru.others_fees ? (cru.others_fees as Record<string, unknown>) : {};
  return deCentavos(outras.service_price);
}

/** Nulo quando não é 99Food ou não houve desconto. */
export function separacaoDoDesconto99(p: PedidoParaSeparacao | null | undefined): ReparticaoDoDesconto99 | null {
  if (!p || !ehPedido99Food(p)) return null;
  const dd = detalhes(p);
  const taxaServico = taxaDeServico99(p);
  const totalPago = Number(p.totalAmount) || 0;

  // Colunas gravadas (pedido de 18/09/2026 em diante) valem mais que o recálculo.
  if (p.discountMerchant != null || p.discountIfood != null) {
    const loja = Math.max(0, Number(p.discountMerchant) || 0);
    const plataforma = Math.max(0, Number(p.discountIfood) || 0);
    if (loja <= 0 && plataforma <= 0) return null;
    return { loja, plataforma, taxaServico, recebeLoja: centavos(totalPago + plataforma - taxaServico) };
  }

  const total = Number(p.discountTotal ?? dd.total) || 0;
  if (total <= 0) return null;
  return repartirDesconto99({ descontoTotal: total, promocoes: dd.promocoes, taxaServico, totalPago });
}

/**
 * Os campos que a COMANDA lê, pela mesma régua — para pedido antigo e novo.
 *
 * Espalhe DEPOIS do pedido: `{ ...order, ...camposDeDesconto99ParaImpressao(order) }`.
 *
 * A parte do 99 NÃO viaja em `discountIfood`: o Assistente instalado nas
 * lojas imprime esse campo com o rótulo fixo "Desconto (iFood)", e "iFood"
 * numa comanda do 99 é outra reclamação. Vai em `discountPlatform`, com o
 * rótulo junto — o Assistente 1.2.17 imprime; o antigo ignora o campo e cai
 * na linha única de sempre, sem regressão. A taxa de serviço vai em
 * `serviceFee` pelo mesmo motivo: sem ela a conta "subtotal + entrega −
 * total" não fecha, e o Assistente (desde a 1.2.13) só imprime as linhas
 * separadas quando elas fecham.
 */
export function camposDeDesconto99ParaImpressao(p: PedidoParaSeparacao | null | undefined): Record<string, unknown> {
  if (!p || !ehPedido99Food(p)) return {};
  const campos: Record<string, unknown> = {};
  const taxaServico = taxaDeServico99(p);
  if (taxaServico > 0) {
    campos.serviceFee = taxaServico;
    campos.serviceFeeLabel = "Taxa de servico (99Food):";
  }
  const sep = separacaoDoDesconto99(p);
  if (!sep) return campos;
  campos.discountIfood = null;
  campos.discountMerchant = sep.loja > 0 ? sep.loja : null;
  if (sep.plataforma > 0) {
    campos.discountPlatform = sep.plataforma;
    campos.discountPlatformLabel = "Desconto (99Food):";
  }
  return campos;
}
