/**
 * lib/evento-sem-assinatura.ts — evento de parceiro que chegou SEM assinatura
 * válida e quer mexer num pedido que já existe (cancelar, abrir ou fechar a
 * disputa de cancelamento, avançar o status).
 *
 * Brendi, 99Food, Keeta e JotaJá ainda não têm o segredo de assinatura
 * configurado (depende do portal deles), então o webhook aceita o corpo como
 * veio. A criação de pedido já era segura — busca o pedido na API —, mas o
 * cancelamento valia só pelo corpo: quem soubesse o id de um pedido real o
 * cancelava na cozinha (auditoria de 23/10/2026, F17/F68/F86, F67/F96,
 * F138/F141, F139/F140).
 *
 * A regra, igual para os quatro:
 *
 *   assinatura confere          → aplica (quem chama nem passa por aqui)
 *   veio do polling             → aplica (o evento saiu da API autenticada)
 *   API confirma o estado       → aplica
 *   API mostra OUTRO estado     → NÃO aplica, e loga
 *   pedido não existe na API    → NÃO aplica, e loga
 *   API falhou / não diz estado → aplica, e loga — perder um cancelamento
 *                                 real é tão ruim quanto aceitar um forjado
 */

/** O que o evento quer fazer com o pedido. */
export type Pretendido =
  | "CANCELADO"
  | "DISPUTA"
  | "DISPUTA_NEGADA"
  | "ACEITO"
  | "PREPARANDO"
  | "PRONTO"
  | "SAIU_ENTREGA"
  | "ENTREGUE";

/**
 * O estado do pedido na API do parceiro, já traduzido. Número = posição no
 * fluxo normal (0 criado … 5 entregue); `null` = a resposta não diz o estado.
 */
export type EstadoNoParceiro = "CANCELADO" | "DISPUTA" | "DISPUTA_NEGADA" | "OUTRO" | number | null;

const POSICAO_DO_STATUS: Record<string, number> = { ACEITO: 1, PREPARANDO: 2, PRONTO: 3, SAIU_ENTREGA: 4, ENTREGUE: 5 };

/** `lastEvent` do Open Delivery (Brendi, JotaJá, Keeta). */
const POSICAO_DO_LAST_EVENT: Record<string, number> = {
  CREATED: 0, PLACED: 0,
  CONFIRMED: 1,
  PREPARING: 2, IN_PREPARATION: 2, PREPARATION_STARTED: 2, RECOMMENDED_PREPARATION_START: 2,
  READY_FOR_PICKUP: 3, READY_TO_PICKUP: 3, PICKUP_AREA_ASSIGNED: 3, PICKUP_ONGOING: 3, RIDER_ARRIVED_AT_STORE: 3,
  DISPATCHED: 4, ORDER_COLLECTED: 4, PICKED_UP: 4,
  DELIVERED: 5, CONCLUDED: 5,
};

export function estadoDoLastEvent(lastEvent: unknown): EstadoNoParceiro {
  const e = String(lastEvent ?? "").trim().toUpperCase();
  if (!e) return null;
  if (e === "CANCELLED" || e === "CANCELED") return "CANCELADO";
  if (e === "CANCELLATION_REQUESTED" || e === "HANDSHAKE_DISPUTE") return "DISPUTA";
  if (e === "CANCELLATION_REQUEST_DENIED") return "DISPUTA_NEGADA";
  return e in POSICAO_DO_LAST_EVENT ? POSICAO_DO_LAST_EVENT[e] : "OUTRO";
}

/**
 * O estado no `order/detail` do 99Food.
 *
 * O campo de estado do OrderModel deles não está mapeado em lugar nenhum do
 * código nem do vault. Só texto que diz claramente o estado é lido; código
 * numérico (ou campo ausente) volta `null` — e `null` aplica o evento, com o
 * valor cru no log para dar para mapear depois. Chutar o número seria arriscar
 * ignorar cancelamento de verdade.
 */
export function estadoDoPedido99(dados: any): EstadoNoParceiro {
  const bruto = dados?.status ?? dados?.order_status ?? dados?.order_info?.status;
  if (typeof bruto !== "string" || !bruto.trim()) return null;
  const s = bruto.trim().toUpperCase();
  if (/CANCEL/.test(s)) return "CANCELADO";
  if (/FINISH|COMPLET|DELIVERED|CONCLU/.test(s)) return 5;
  if (/DISPATCH|DELIVERING|PICKED/.test(s)) return 4;
  if (/READY/.test(s)) return 3;
  if (/PREPAR|COOK/.test(s)) return 2;
  if (/CONFIRM|ACCEPT/.test(s)) return 1;
  if (/^(NEW|CREATED|PAID|PLACED)$/.test(s)) return 0;
  return null;
}

/** "confere" aplica; "sem-estado" aplica com log; "nao-confere" não aplica. */
export function conferirEstado(estado: EstadoNoParceiro, pretendido: Pretendido): "confere" | "nao-confere" | "sem-estado" {
  if (estado === null) return "sem-estado";
  if (pretendido === "CANCELADO") return estado === "CANCELADO" ? "confere" : "nao-confere";
  if (pretendido === "DISPUTA") return estado === "DISPUTA" ? "confere" : "nao-confere";
  // A negativa vale se o pedido seguiu vivo (negado, ou já andou no fluxo).
  if (pretendido === "DISPUTA_NEGADA") return estado === "DISPUTA_NEGADA" || typeof estado === "number" ? "confere" : "nao-confere";
  return typeof estado === "number" && estado >= POSICAO_DO_STATUS[pretendido] ? "confere" : "nao-confere";
}

export type LeituraDoParceiro =
  | { ok: true; estado: EstadoNoParceiro; bruto?: unknown }
  /** `naoExiste`: a API respondeu que o pedido não existe (404) — não é falha. */
  | { ok: false; motivo: string; naoExiste?: boolean };

/**
 * Relê o pedido na API (`ler`, com a credencial da loja dona) e diz se o
 * evento sem assinatura pode ser aplicado. Nunca lança.
 */
export async function aplicarEventoSemAssinatura(
  parceiro: string,
  orderId: string,
  evento: string,
  pretendido: Pretendido,
  ler: () => Promise<LeituraDoParceiro>,
): Promise<boolean> {
  let r: LeituraDoParceiro;
  try {
    r = await ler();
  } catch (e: any) {
    r = { ok: false, motivo: e?.message || "erro ao consultar" };
  }
  const qual = `${evento || "?"} ${orderId}`;
  if (!r.ok && r.naoExiste) {
    console.warn(`[${parceiro}] evento sem assinatura não confere com a API: ignorado (${qual}; a API não conhece o pedido: ${r.motivo})`);
    return false;
  }
  if (!r.ok) {
    console.warn(`[${parceiro}] evento sem assinatura: a API não respondeu (${r.motivo}) — aplicado assim mesmo, para não perder cancelamento real (${qual})`);
    return true;
  }
  const c = conferirEstado(r.estado, pretendido);
  if (c === "sem-estado") {
    console.warn(`[${parceiro}] evento sem assinatura: a API não diz o estado do pedido (${JSON.stringify(r.bruto ?? null)}) — aplicado assim mesmo (${qual})`);
    return true;
  }
  if (c === "nao-confere") {
    console.warn(`[${parceiro}] evento sem assinatura não confere com a API: ignorado (${qual} quer ${pretendido}; na API: ${JSON.stringify(r.bruto ?? r.estado)})`);
    return false;
  }
  return true;
}
