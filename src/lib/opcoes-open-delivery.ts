/**
 * lib/opcoes-open-delivery.ts
 *
 * As opções, sabores e ADICIONAIS de um item de pedido Open Delivery — uma
 * função só para a Brendi e o JotaJá, que falam o mesmo contrato (Abrasel).
 *
 * Nasceu de duas CÓPIAS do mesmo parser (`extractBrendiOptions` e
 * `extractJotajaOptions`, idênticas linha a linha) com o MESMO defeito: as nove
 * listas conhecidas encadeadas com `??`, ficando com a primeira não-vazia. Era
 * o tipo de coisa que se conserta num arquivo e continua quebrada no outro —
 * que é exatamente o motivo de o processador da Brendi já ter sido escrito como
 * clone do JotaJá, e não como segunda implementação.
 */

/**
 * O valor de um preço do Open Delivery — número puro ou `{ value, currency }`.
 *
 * SEMPRE NÚMERO, nunca o que veio. O `?? 0` de antes deixava passar qualquer
 * coisa não-nula, e a Brendi manda `addition: true` (uma BANDEIRA de "esta
 * opção é uma adição") no mesmo lugar onde os outros mandam o valor. O `true`
 * era gravado como preço do adicional e, como `Number(true)` é 1, a comanda do
 * Frangoso imprimia "+R$ 1,00" ao lado de opção que não custa nada. 19/09/2026.
 */
export function valorOpenDelivery(p: any): number {
  const bruto = typeof p === "object" && p !== null ? p.value : p;
  const n = typeof bruto === "boolean" ? NaN : Number(bruto);
  return Number.isFinite(n) ? n : 0;
}

/** Os nomes que os originadores Open Delivery usam para a lista de opções. */
const LISTAS_DE_OPCAO = [
  "options", "subItems", "sub_items", "garnishItems", "choices",
  "items", "additions", "customizations", "toppings",
] as const;

/**
 * Todas as opções, sabores e ADICIONAIS de um item, achatados.
 *
 * ── O bug que isto conserta ────────────────────────────────────────────────
 *
 * A versão anterior encadeava os nove nomes com `??`: ficava com o PRIMEIRO
 * array não-vazio e jogava os outros fora. O comentário dizia "aceitamos todos
 * os formatos conhecidos", mas o código aceitava um só.
 *
 * Quando o item traz a escolha obrigatória em `options` ("Peito de frango") e
 * os adicionais pagos em `additions`/`toppings` — que é justamente o hambúrguer
 * com bacon extra —, os adicionais sumiam antes de virar `comboSelections`. Da
 * cozinha para baixo ninguém tinha como saber: a comanda imprimia o que
 * chegou, e o que chegou já vinha sem eles. Foi a queixa do Frangoso em
 * 19/09/2026 ("os adicionais da Brendi não saem na impressão").
 *
 * Agora as nove listas são CONCATENADAS. A deduplicação existe porque nomes
 * sinônimos (`subItems` e `sub_items`) às vezes carregam o mesmo conteúdo: cai
 * fora o que repete a referência ou a assinatura id+nome+quantidade.
 *
 * A recursão continua igual: opção que tem filhos entra pelos filhos (é o
 * grupo "Molhos", que não é escolha nenhuma), e opção folha entra por si.
 */
export function extrairOpcoesDoItem(item: any): any[] {
  if (!item || typeof item !== "object") return [];

  const rawList: any[] = [];
  const vistos = new Set<unknown>();
  for (const campo of LISTAS_DE_OPCAO) {
    const lista = (item as any)[campo];
    if (!Array.isArray(lista)) continue;
    for (const o of lista) {
      if (!o || typeof o !== "object") continue;
      if (vistos.has(o)) continue;
      const assinatura = `${o.id ?? ""}|${o.name ?? o.productName ?? ""}|${o.quantity ?? ""}`;
      if (assinatura !== "||" && vistos.has(assinatura)) continue;
      vistos.add(o);
      vistos.add(assinatura);
      rawList.push(o);
    }
  }

  const extracted: any[] = [];
  for (const o of rawList) {
    const nested = extrairOpcoesDoItem(o);
    if (nested.length > 0) {
      extracted.push(...nested);
    } else {
      const name = o.name || o.productName || o.label || o.optionName || o.description || o.nameOption || "";
      if (name) {
        extracted.push({
          id: o.id || `opt-${Math.random().toString(36).slice(2)}`,
          name,
          quantity: o.quantity ?? o.qty ?? 1,
          price:
            valorOpenDelivery(o.unitPrice) || valorOpenDelivery(o.price) ||
            valorOpenDelivery(o.totalPrice) || valorOpenDelivery(o.addition) || 0,
        });
      }
    }
  }
  return extracted;
}

