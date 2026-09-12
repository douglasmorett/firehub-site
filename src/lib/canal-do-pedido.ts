/**
 * De onde veio o pedido — nome, cor e número no parceiro, num lugar só.
 *
 * ── Por que isto existe ─────────────────────────────────────────────────────
 *
 * O canal era decidido por cadeias de `?:` copiadas em cada tela: o selo do
 * card, o rótulo do pagamento na comanda, o filtro da barra, o app do motoboy.
 * Toda cadeia terminava num `: "Online"` — o pedido do site. Quando entrou um
 * canal novo, ninguém atualizou todas: em 11/09/2026 o dono viu o pedido do
 * 99Food com o selo verde "Online", igual ao do site próprio, e a comanda
 * impressa dizia "Pago via Online" num pedido pago no 99.
 *
 * O canal desconhecido cair no site é a pior escolha possível de padrão: o
 * pedido de marketplace tem regra de cancelamento, de prazo e de conferência
 * que o do site não tem. Por isso, aqui, o que não é reconhecido vira
 * `DESCONHECIDO` e aparece como tal — em vez de se disfarçar de venda própria.
 *
 * Regra de detecção: CANAL decide, presença de campo não. `openDeliveryOrderId`
 * é dividido por 99Food, Brendi e JotaJá — olhar só para ele já trocou pedido
 * de um pelo outro (ver o filtro da barra do painel).
 */

export type ChaveDeCanal =
  | "IFOOD"
  | "99FOOD"
  | "BRENDI"
  | "JOTAJA"
  | "WHATSAPP_IA"
  | "PDV"
  | "TOTEM"
  | "MESA"
  | "SITE"
  | "DESCONHECIDO";

export type Canal = {
  chave: ChaveDeCanal;
  /** Como se escreve o nome do canal para o lojista. */
  nome: string;
  /** Emoji curto, para onde não cabe logo. */
  emoji: string;
  /** Fundo e texto do selo — pastel + escuro, o padrão dos selos do painel. */
  fundo: string;
  texto: string;
  /** true para iFood, 99Food, Brendi e JotaJá: pedido que veio de fora. */
  ehMarketplace: boolean;
  /** O número curto que o parceiro mostra ao lojista (#1234). */
  referencia: string | null;
};

const CORES: Record<ChaveDeCanal, { nome: string; emoji: string; fundo: string; texto: string; marketplace: boolean }> = {
  IFOOD:       { nome: "iFood",   emoji: "🔴", fundo: "#FEE2E2", texto: "#DC2626", marketplace: true },
  // Amarelo porque é a cor da marca 99 — e porque era o único jeito de o
  // atendente distinguir num relance do verde do site, que é o que ele via.
  "99FOOD":    { nome: "99Food",  emoji: "🟡", fundo: "#FEF08A", texto: "#854D0E", marketplace: true },
  BRENDI:      { nome: "Brendi",  emoji: "🟣", fundo: "#EDE9FE", texto: "#6D28D9", marketplace: true },
  JOTAJA:      { nome: "Jotajá",  emoji: "🔵", fundo: "#DBEAFE", texto: "#1D4ED8", marketplace: true },
  WHATSAPP_IA: { nome: "IA Whats", emoji: "🤖", fundo: "#F3E8FF", texto: "#7C3AED", marketplace: false },
  PDV:         { nome: "PDV",     emoji: "🧾", fundo: "#E0E7FF", texto: "#4338CA", marketplace: false },
  TOTEM:       { nome: "Totem",   emoji: "🖥️", fundo: "#CFFAFE", texto: "#0E7490", marketplace: false },
  MESA:        { nome: "Mesa",    emoji: "🍽️", fundo: "#FFEDD5", texto: "#C2410C", marketplace: false },
  SITE:        { nome: "Online",  emoji: "🟢", fundo: "#DCFCE7", texto: "#15803D", marketplace: false },
  DESCONHECIDO:{ nome: "Outro canal", emoji: "❔", fundo: "#F1F5F9", texto: "#475569", marketplace: false },
};

type PedidoParaCanal = {
  source?: string | null;
  openDeliveryChannel?: string | null;
  openDeliveryOrderId?: string | null;
  openDeliveryReference?: string | number | null;
  ifoodOrderId?: string | null;
  ifoodReference?: string | number | null;
  status?: string | null;
  tableNumber?: string | number | null;
  deliveryType?: string | null;
  [k: string]: unknown;
};

export function chaveDoCanal(pedido: PedidoParaCanal | null | undefined): ChaveDeCanal {
  if (!pedido) return "DESCONHECIDO";
  const src = String(pedido.source || "").toUpperCase().trim();
  const od = String(pedido.openDeliveryChannel || "").toUpperCase().trim();

  if (src === "IFOOD" || pedido.ifoodOrderId || pedido.ifoodReference) return "IFOOD";
  if (src === "99FOOD" || od === "99FOOD" || od.includes("99")) return "99FOOD";
  if (src === "BRENDI" || od === "BRENDI") return "BRENDI";
  if (src === "JOTAJA" || od === "JOTAJA") return "JOTAJA";
  // OPEN_DELIVERY é o rótulo genérico antigo: o canal fino vem no
  // openDeliveryChannel, e sem ele o resto do Open Delivery era o JotaJá.
  if (src === "OPEN_DELIVERY") return od.includes("99") ? "99FOOD" : od === "BRENDI" ? "BRENDI" : "JOTAJA";
  if (pedido.openDeliveryOrderId) return "JOTAJA";

  if (src === "WHATSAPP_IA" || pedido.status === "CRIANDO_IA") return "WHATSAPP_IA";
  // A venda no balcão grava source "PRESENCIAL" (api/store/orders/presencial) e
  // o lançamento de mesa grava o mesmo. Sem estas duas linhas o pedido do caixa
  // caía em DESCONHECIDO e o selo dizia "Outro canal" — e a comanda de um
  // balcão pré-pago imprimia "Pago via Outro canal (NÃO COBRAR)".
  if (src === "PDV" || src === "PRESENCIAL" || src === "BALCAO" || src === "MANUAL" || src === "CAIXA") return "PDV";
  if (src === "TOTEM") return "TOTEM";
  if (pedido.tableNumber != null && String(pedido.tableNumber) !== "") return "MESA";
  if (src === "SITE" || src === "" || src === "WEB" || src === "ONLINE") return "SITE";
  return "DESCONHECIDO";
}

export function canalDoPedido(pedido: PedidoParaCanal | null | undefined): Canal {
  const chave = chaveDoCanal(pedido);
  const c = CORES[chave];
  const ref =
    chave === "IFOOD"
      ? pedido?.ifoodReference ?? null
      : c.marketplace
      ? pedido?.openDeliveryReference ?? null
      : null;
  return {
    chave,
    nome: c.nome,
    emoji: c.emoji,
    fundo: c.fundo,
    texto: c.texto,
    ehMarketplace: c.marketplace,
    referencia: ref != null && String(ref).trim() !== "" ? String(ref) : null,
  };
}

/** O que vai no selo do card: "99Food #266009", "iFood #4231", "Online". */
export function rotuloDoCanal(pedido: PedidoParaCanal | null | undefined): string {
  const c = canalDoPedido(pedido);
  if (pedido?.status === "CRIANDO_IA") return "🤖 IA criando...";
  if (c.chave === "WHATSAPP_IA") return "🤖 IA Whats";
  if (c.chave === "TOTEM") return "🖥️ Totem";
  if (!c.ehMarketplace) return c.nome;
  return c.referencia ? `${c.nome} #${c.referencia}` : c.nome;
}

/** Nome do canal para frase corrida: "Pago via 99Food (NÃO COBRAR)". */
export function nomeDoCanal(pedido: PedidoParaCanal | null | undefined): string {
  return canalDoPedido(pedido).nome;
}
