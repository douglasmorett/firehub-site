/**
 * src/lib/beverage.ts
 * Utilitário central de detecção automática de bebidas por palavra-chave.
 * Usado por: JotaJá, iFood, Dashboard e Assistente de Impressão.
 * Suporta palavras-chave padrão + palavras-chave personalizadas da loja.
 */

import { safeParseCombo } from "@/lib/parse-combo";

export function cleanAscii(str: string): string {
  if (!str) return "";
  return String(str)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/º/g, ".")
    .replace(/ª/g, ".")
    .replace(/Ç/g, "C")
    .replace(/ç/g, "c");
}

export function isBeverageName(name?: string | null, customKeywords?: string | string[]): boolean {
  if (!name) return false;
  const cleanName = cleanAscii(name);
  const defaultPattern = "bebida|bebidas|refrigerante|refrigerantes|suco|sucos|cerveja|cervejas|agua|guarana|guaravita|coca|fanta|sprite|pepsi|soda|h2oh|monster|red bull|redbull|energetico|cha|mate|lata|2l|600ml|350ml|long neck|heineken|stella|budweiser|skol|brahma|antarctica|amstel|eisenbahn|sol|corona|smirnoff|ice|tonica|schweppes|del valle|tampico|kapo|suffresh|feel good|kombucha|vibe|tnt|bravus|skol beats|51|pitu|velho barreiro|corote|vodka|gin|whisky|whiskey|licor|vinho|espumante|champagne|chopp";

  let customPattern = "";
  if (customKeywords) {
    const list = typeof customKeywords === "string" ? customKeywords.split(",") : customKeywords;
    const cleanList = list.map(k => cleanAscii(k.trim())).filter(Boolean);
    if (cleanList.length > 0) {
      customPattern = "|" + cleanList.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    }
  }

  const bevRegex = new RegExp(`\\b(${defaultPattern}${customPattern})\\b`, "i");
  return bevRegex.test(cleanName);
}

export function isBeverageItem(item: any, customKeywords?: string | string[]): boolean {
  if (!item) return false;
  if (item.isBeverage === true || item.isBeverage === "true") return true;
  if (item.menuProduct?.isBeverage === true) return true;
  const cat = String(item.category || item.menuProduct?.category || "");
  const name = String(item.name || item.menuProduct?.name || "");
  if (isBeverageName(cat, customKeywords) || isBeverageName(name, customKeywords)) return true;

  if (item.comboSelections) {
    try {
      const parsed = safeParseCombo(item.comboSelections);
      if (Array.isArray(parsed) && parsed.some((s: any) => isBeverageName(s.name, customKeywords))) {
        return true;
      }
    } catch {}
  }
  return false;
}

export function getBeveragesFromOrder(order: any, customKeywords?: string | string[]): { name: string; quantity: number }[] {
  if (!order) return [];
  const beverages: { name: string; quantity: number }[] = [];

  const items = Array.isArray(order.items) ? order.items : [];
  for (const item of items) {
    const qty = item.quantity || 1;
    const name = item.name || item.menuProduct?.name || "";

    if (isBeverageItem(item, customKeywords)) {
      if (name) {
        beverages.push({ name, quantity: qty });
      }
    }

    if (item.comboSelections) {
      try {
        const comboSels = safeParseCombo(item.comboSelections);
        if (Array.isArray(comboSels)) {
          for (const sel of comboSels) {
            const selName = sel.name || sel.productName || sel.title;
            if (selName && isBeverageName(selName, customKeywords)) {
              const selQty = sel.quantity || 1;
              beverages.push({ name: selName, quantity: selQty });
            }
            if (Array.isArray(sel.extras)) {
              for (const ext of sel.extras) {
                const extName = typeof ext === "string" ? ext : ext?.name;
                if (extName && isBeverageName(extName, customKeywords)) {
                  beverages.push({ name: extName, quantity: qty });
                }
              }
            }
          }
        }
      } catch {}
    }
  }

  // Also check notes for keywords if items array was empty or didn't capture beverages
  if (beverages.length === 0 && order.notes) {
    const notesStr = String(order.notes);
    const lines = notesStr.split(/[\n,;|]+/);
    for (const line of lines) {
      const cleanLine = line.trim();
      if (cleanLine && isBeverageName(cleanLine, customKeywords)) {
        beverages.push({ name: cleanLine, quantity: 1 });
      }
    }
  }

  return beverages;
}
