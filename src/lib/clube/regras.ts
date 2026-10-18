/**
 * CLUBE DO APLICATIVO — as regras puras (sem banco), para o teste provar.
 *
 * Douglas, 18/10/2026: "Nosso clube vai custar R$ 29,90 por mês. O cara assina
 * no cartão ou no Pix automático (Cakto)… 15% de desconto nos pedidos de quem
 * tiver assinado… se o cara parar de assinar ou não aprovar a assinatura, aparece
 * uma mensagem para ele pagar o clube, mas ele consegue fazer pedido normal, sem
 * o desconto do clube." E em 17/10: um plano só por loja (a loja define a
 * mensalidade e o %), desconto só no aplicativo.
 *
 * - O clube é da MARCA (mesma chave da base do app: a principal do grupo,
 *   lib/vitrine-do-grupo.ts → principalDoGrupo). Assinou numa unidade, vale em
 *   todas.
 * - Quem cobra é a Cakto (cartão e Pix Automático, na conta da loja). O FireHub
 *   só escuta o webhook (lib/clube/cakto.ts) e guarda até quando está pago.
 * - O desconto sai sobre os PRODUTOS que ainda faltam pagar (depois de cupom,
 *   prêmio e indicação), nunca sobre a entrega. Teto por pedido opcional.
 * - Pagamento atrasado ou assinatura cancelada: o pedido sai normal, sem o
 *   desconto, e o cardápio mostra o aviso para pagar.
 */

export type ConfigDoClube = {
  ativo: boolean;
  /** Mensalidade mostrada ao cliente (o preço de verdade está no produto da Cakto). */
  valor: number;
  /** % de desconto nos produtos. */
  percentual: number;
  /** Teto do desconto por pedido, em R$. null = sem teto. */
  teto: number | null;
  /** Link do checkout da assinatura na Cakto (pay.cakto.com.br/...). */
  linkDoCheckout: string | null;
  /** Nome do clube na tela ("Clube Hakim"). */
  nome: string | null;
};

export const CONFIG_PADRAO: ConfigDoClube = {
  ativo: false,
  valor: 29.9,
  percentual: 15,
  teto: null,
  linkDoCheckout: null,
  nome: null,
};

const numero = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Só aceita checkout da Cakto em https — o botão "Assinar" abre este link. */
export function linkDeCheckoutValido(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== "https:") return null;
    if (!/(^|\.)cakto\.com\.br$/i.test(u.hostname)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Lê (e saneia) a configuração gravada. Valor fora da faixa volta ao padrão. */
export function lerConfigDoClube(bruto: unknown): ConfigDoClube {
  const c: any = bruto && typeof bruto === "object" ? bruto : {};
  const valor = numero(c.valor);
  const percentual = numero(c.percentual);
  const teto = numero(c.teto);
  const nome = typeof c.nome === "string" ? c.nome.trim().slice(0, 40) : "";
  return {
    ativo: c.ativo === true,
    valor: valor != null && valor >= 1 && valor <= 999 ? Math.round(valor * 100) / 100 : CONFIG_PADRAO.valor,
    percentual: percentual != null && percentual > 0 && percentual <= 50 ? Math.round(percentual * 100) / 100 : CONFIG_PADRAO.percentual,
    teto: teto != null && teto > 0 ? Math.round(teto * 100) / 100 : null,
    linkDoCheckout: linkDeCheckoutValido(c.linkDoCheckout),
    nome: nome || null,
  };
}

/** O clube só aparece pronto para assinar com o link do checkout colado. */
export function clubeProntoParaAssinar(c: ConfigDoClube): boolean {
  return c.ativo && !!c.linkDoCheckout;
}

// ── A ASSINATURA ────────────────────────────────────────────────────────────

/**
 * ATIVO = pago (até `pagoAte`). PENDENTE = a cobrança da renovação falhou ou
 * venceu sem chegar a renovação. CANCELADO = o cliente (ou a loja) cancelou;
 * o que já foi pago continua valendo até `pagoAte`.
 */
export type StatusGravado = "AGUARDANDO" | "ATIVO" | "PENDENTE" | "CANCELADO";

export type Assinatura = {
  status: StatusGravado;
  /** Até quando o último pagamento cobre (ISO). */
  pagoAte: string | null;
  desde: string | null;
};

/** Dias de tolerância depois do vencimento: a Cakto tenta cobrar de novo e o webhook pode atrasar. */
export const TOLERANCIA_DIAS = 3;
/** Um pagamento cobre um mês. */
export const DIAS_POR_PAGAMENTO = 31;

export type SituacaoNoCardapio =
  /** Paga: o desconto entra. */
  | "ativo"
  /** Já foi assinante e o pagamento não veio: aviso para pagar, pedido sem desconto. */
  | "pendente"
  /** Cancelou e o período pago acabou: convite para assinar de novo. */
  | "encerrado"
  /** Nunca assinou. */
  | "nao_assinante";

export function situacaoDaAssinatura(a: Assinatura | null, agora: Date = new Date()): SituacaoNoCardapio {
  if (!a) return "nao_assinante";
  // AGUARDANDO = abriu o checkout e ainda não pagou nenhuma vez.
  if (a.status === "AGUARDANDO" && !a.pagoAte) return "nao_assinante";
  const ate = a.pagoAte ? new Date(a.pagoAte).getTime() : NaN;
  const pagoAinda = Number.isFinite(ate) && agora.getTime() <= ate;
  const naTolerancia = Number.isFinite(ate) && agora.getTime() <= ate + TOLERANCIA_DIAS * 86_400_000;
  if (a.status === "ATIVO") return pagoAinda || naTolerancia ? "ativo" : "pendente";
  if (a.status === "CANCELADO") return pagoAinda ? "ativo" : "encerrado";
  return "pendente";
}

/** Até quando o pagamento de agora cobre: a partir do maior entre agora e o que já estava pago. */
export function novoPagoAte(pagoAteAtual: string | null, pagoEm: Date): string {
  const atual = pagoAteAtual ? new Date(pagoAteAtual).getTime() : NaN;
  const base = Number.isFinite(atual) && atual > pagoEm.getTime() ? atual : pagoEm.getTime();
  return new Date(base + DIAS_POR_PAGAMENTO * 86_400_000).toISOString();
}

// ── O DESCONTO ──────────────────────────────────────────────────────────────

const centavos = (n: number) => Math.round(n * 100) / 100;

/** R$ de desconto do clube sobre os produtos que ainda faltam pagar. */
export function descontoDoClube(c: Pick<ConfigDoClube, "percentual" | "teto">, produtosAPagar: number): number {
  const base = Math.max(0, Number(produtosAPagar) || 0);
  if (base <= 0 || !(c.percentual > 0)) return 0;
  const bruto = centavos((base * c.percentual) / 100);
  const comTeto = c.teto != null ? Math.min(bruto, c.teto) : bruto;
  return centavos(Math.min(comTeto, base));
}

const reais = (n: number) => `R$ ${n.toFixed(2).replace(".", ",")}`;

/** Linha da comanda e do painel: "[Clube 15%: -R$ 7,20]". */
export function etiquetaDoClube(percentual: number, valor: number): string {
  const pct = Number.isInteger(percentual) ? String(percentual) : String(percentual).replace(".", ",");
  return `[Clube ${pct}%: -${reais(valor)}]`;
}

/** Lê o valor de volta da etiqueta (relatório de descontos). */
export function valorDaEtiquetaDoClube(notas: string | null | undefined): number {
  const m = String(notas || "").match(/\[Clube [\d,]+%: -R\$ ([\d.]+,\d{2})\]/);
  if (!m) return 0;
  return Number(m[1].replace(/\./g, "").replace(",", ".")) || 0;
}

// ── O PEDIDO VEIO DO APLICATIVO? ────────────────────────────────────────────

/**
 * O app da loja (apps/loja, PaginaDaLoja.tsx) abre o cardápio com o sufixo
 * `FireHubApp/1 (<marca>)` no user agent. Não é prova contra quem quer burlar
 * — a prova de quem é o assinante é a sessão assinada (lib/sessao-do-cliente.ts),
 * e o assinante pagou —, é a regra "o desconto é do aplicativo".
 */
export function ehDoAplicativo(userAgent: string | null | undefined): boolean {
  return /\bFireHubApp\/\d/.test(String(userAgent || ""));
}
