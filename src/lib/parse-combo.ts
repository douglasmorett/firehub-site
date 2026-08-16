/**
 * /src/lib/parse-combo.ts
 * Utilitário ÚNICO e CENTRALIZADO para parsear comboSelections.
 * TODOS os views (KDS produção, KDS finalização, notinha, dashboard, API)
 * devem usar esta função para garantir consistência.
 */

export interface ComboItem {
  name: string;
  quantity: number;
  price?: number;
}

/**
 * Parseia comboSelections de qualquer formato (string JSON, array, etc.)
 * e retorna lista normalizada de { name, quantity }.
 *
 * @param raw - O campo comboSelections (string | array | null)
 * @param parentQuantity - Multiplicador da quantidade do item pai (default: 1)
 * @returns Array normalizado de sub-itens do combo
 *
 * REGRA FUNDAMENTAL: Quando o item é um OBJETO com campo `quantity` explícito,
 * o `name` é usado INTEGRALMENTE sem tentar extrair números dele.
 * Exemplo: { name: "5 Queijos", quantity: 2 } → { name: "5 Queijos", quantity: 2 }
 * NUNCA: { name: "Queijos", quantity: 5 } — isso é ERRADO.
 */
export function parseComboSelections(
  raw: any,
  parentQuantity: number = 1,
): ComboItem[] {
  if (!raw) return [];

  let parsed = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Fallback: tratar como texto separado por \n, | ou ;
      parsed = raw
        .split(/[\n|;]/)
        .map((s: string) => s.trim())
        .filter(Boolean);
    }
  }

  if (!Array.isArray(parsed)) return [];

  const list: ComboItem[] = [];

  for (const item of parsed) {
    if (typeof item === "string") {
      // String pura: "2x Esfirra de Carne" → extrair quantidade do texto
      const match = item.match(/^(\d+)x?\s+(.+)$/i);
      if (match) {
        list.push({
          name: match[2].trim(),
          quantity: parseInt(match[1], 10),
        });
      } else if (item.trim()) {
        list.push({
          name: item.trim(),
          quantity: 1,
        });
      }
    } else if (item && typeof item === "object") {
      // Objeto com campos estruturados: { name, quantity, price }
      // A quantidade do sub-item já é a quantidade total selecionada pelo cliente no pedido
      const rawName = String(
        item.name || item.productName || item.label || item.description || "",
      );
      const qty = Number(item.quantity || item.qty || 1);
      const price = item.price != null ? Number(item.price) : undefined;

      if (rawName.trim()) {
        list.push({
          name: rawName.trim(),
          quantity: qty,
          ...(price !== undefined ? { price } : {}),
        });
      }
    }
  }

  return list;
}

/**
 * Helper para simplesmente parsear o JSON do comboSelections sem normalizar.
 * Usado por APIs e lógica de negócio que precisam do objeto raw.
 */
export function safeParseCombo(raw: any): any[] {
  if (!raw) return [];
  if (typeof raw === "string") {
    try {
      const p = JSON.parse(raw);
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
  return Array.isArray(raw) ? raw : [];
}
