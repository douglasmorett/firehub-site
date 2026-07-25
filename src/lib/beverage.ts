/**
 * src/lib/beverage.ts
 * Utilitário central de detecção automática de bebidas por palavra-chave.
 * Usado por: JotaJá, iFood, Dashboard e Assistente de Impressão.
 */

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

export function isBeverageName(name?: string | null): boolean {
  if (!name) return false;
  const cleanName = cleanAscii(name);
  const bevRegex = /\b(bebida|bebidas|refrigerante|refrigerantes|suco|sucos|cerveja|cervejas|agua|guarana|guaravita|coca|fanta|sprite|pepsi|soda|h2oh|monster|red bull|redbull|energetico|cha|mate|lata|2l|600ml|350ml|long neck|heineken|stella|budweiser|skol|brahma|antarctica|amstel|eisenbahn|sol|corona|smirnoff|ice|tonica|schweppes|del valle|tampico|kapo|suffresh|feel good|kombucha|vibe|tnt|bravus|skol beats|51|pitu|velho barreiro|corote|vodka|gin|whisky|whiskey|licor|vinho|espumante|champagne|chopp)\b/i;
  return bevRegex.test(cleanName);
}

export function isBeverageItem(item: any): boolean {
  if (!item) return false;
  if (item.isBeverage === true || item.isBeverage === "true") return true;
  if (item.menuProduct?.isBeverage === true) return true;
  const cat = String(item.category || item.menuProduct?.category || "");
  const name = String(item.name || item.menuProduct?.name || "");
  if (isBeverageName(cat) || isBeverageName(name)) return true;

  if (item.comboSelections) {
    try {
      const parsed = typeof item.comboSelections === "string" ? JSON.parse(item.comboSelections) : item.comboSelections;
      if (Array.isArray(parsed) && parsed.some((s: any) => isBeverageName(s.name))) {
        return true;
      }
    } catch {}
  }
  return false;
}
