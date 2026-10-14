/**
 * A BEBIDA QUE O SERVIDOR DECIDE PELO ASSISTENTE ANTIGO.
 *
 * ── O problema ──────────────────────────────────────────────────────────────
 *
 * Quem marca "<=== BEBIDA" e "!! CONTEM BEBIDA !!" no papel é o Assistente
 * instalado no PC da loja (firehub-print-assistant/server.js, isBeverageName),
 * com uma lista de palavras antiga em que "sol", "cha", "mate", "ice", "gin",
 * "vinho", "51" e "lata" valem SOZINHAS. O site já separou essas palavras
 * ambíguas (src/lib/beverage.ts: só com contexto), mas o Assistente leva
 * semanas para ser atualizado nas lojas. Esfihão, 13/10/2026: "Calzone carne
 * de sol <=== BEBIDA" e "!! CONTEM BEBIDA !!" em todo item de carne de sol.
 *
 * ── A saída, só pelo servidor ───────────────────────────────────────────────
 *
 * O Assistente respeita duas coisas que vêm no pedido: `item.isBeverage ===
 * true` (marca o item) e `order.printerConfig.autoBeverageTag === false`
 * (desliga a lista de palavras dele). Então, no pedido em que a lista antiga
 * marcaria algo que a regra do site NÃO marca, o servidor desliga a lista do
 * Assistente e manda `isBeverage: true` nos itens que são bebida pela regra
 * certa. Pedido sem falso positivo segue exatamente como sempre foi.
 *
 * Custo aceito nesse pedido: a bebida escolhida DENTRO de um combo deixa de
 * ganhar o "<=== BEBIDA" na linha da opção; o combo leva a marca no item e a
 * faixa "CONTEM BEBIDA" continua saindo.
 */

import { isBeverageItem, isBeverageName, cleanAscii } from "@/lib/beverage";
import { safeParseCombo } from "@/lib/parse-combo";

/** A lista do Assistente instalado (server.js, isBeverageName), letra por letra. */
const LISTA_DO_ASSISTENTE =
  "bebida|bebidas|refrigerante|refrigerantes|suco|sucos|cerveja|cervejas|agua|guarana|guaravita|coca|fanta|sprite|pepsi|soda|h2oh|monster|red bull|redbull|energetico|cha|mate|lata|2l|600ml|350ml|long neck|heineken|stella|budweiser|skol|brahma|antarctica|amstel|eisenbahn|sol|corona|smirnoff|ice|tonica|schweppes|del valle|tampico|kapo|suffresh|feel good|kombucha|vibe|tnt|bravus|skol beats|51|pitu|velho barreiro|corote|vodka|gin|whisky|whiskey|licor|vinho|espumante|champagne|chopp";
const reRecusa = /^\s*(nao|sem|dispenso|nenhum|nenhuma)\b|\bnao\s+(quero|desejo|preciso|vou querer)\b/i;

function regexDoAssistente(palavras: string): RegExp {
  const extra = String(palavras || "")
    .split(",")
    .map((k) => cleanAscii(k.trim()))
    .filter(Boolean)
    .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`\\b(${LISTA_DO_ASSISTENTE}${extra.length ? "|" + extra.join("|") : ""})\\b`, "i");
}

function nomesDasOpcoes(item: any): string[] {
  try {
    const p = safeParseCombo(item?.comboSelections);
    return Array.isArray(p) ? p.map((s: any) => String(s?.name || s?.productName || s?.title || "")).filter(Boolean) : [];
  } catch {
    return [];
  }
}

/** O Assistente antigo marcaria como bebida algo que a regra do site não marca? */
export function assistenteErraABebida(items: any[], palavras: string): boolean {
  const antigo = regexDoAssistente(palavras);
  const marcaAntiga = (nome: string) => {
    const limpo = cleanAscii(nome);
    return !!limpo && !reRecusa.test(limpo) && antigo.test(limpo);
  };
  for (const item of items || []) {
    if (item?.isBeverage === true) continue;
    const nome = String(item?.name || item?.menuProduct?.name || "");
    const cat = String(item?.category || item?.menuProduct?.category || "");
    const opcoes = nomesDasOpcoes(item);
    if (opcoes.length === 0 && (marcaAntiga(nome) || marcaAntiga(cat)) && !isBeverageItem({ ...item, comboSelections: null }, palavras)) return true;
    for (const o of opcoes) if (marcaAntiga(o) && !isBeverageName(o, palavras)) return true;
  }
  return false;
}

/** O mesmo job, com a bebida decidida pela regra do site quando o Assistente erraria. */
export function bebidaDecididaPeloServidor<J extends { order?: any; destinos?: any[] }>(job: J): J {
  const order = job?.order;
  if (!order || !Array.isArray(order.items)) return job;
  if (order.printerConfig?.autoBeverageTag === false) return job;
  const palavras = String(order.customBeverageKeywords || order.printerConfig?.customBeverageKeywords || "");
  const todos = [...order.items, ...(job.destinos || []).flatMap((d: any) => (Array.isArray(d?.items) ? d.items : []))];
  if (!assistenteErraABebida(todos, palavras)) return job;

  const marcar = (items: any[]) =>
    items.map((i: any) => (isBeverageItem(i, palavras) ? { ...i, isBeverage: true } : i));
  return {
    ...job,
    order: {
      ...order,
      items: marcar(order.items),
      printerConfig: { ...(order.printerConfig || {}), autoBeverageTag: false },
    },
    ...(Array.isArray(job.destinos)
      ? { destinos: job.destinos.map((d: any) => (Array.isArray(d?.items) ? { ...d, items: marcar(d.items) } : d)) }
      : {}),
  };
}
