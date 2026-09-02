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

  // ── FORMATO DO CARDÁPIO ONLINE ──────────────────────────────────────────
  // O ComboModal trabalha com { grupoId: { nome: quantidade } } e o
  // /api/customer-order grava esse objeto CRU — o grupoId precisa sobreviver,
  // porque é ele que faz `somaDosAdicionais` cobrar o preço do grupo certo
  // (a mesma opção pode custar diferente em dois grupos).
  //
  // Só que aqui embaixo o código exigia array e devolvia [] para esse objeto.
  // Resultado: todo combo pedido pelo cardápio online chegava à cozinha como o
  // nome do combo e mais nada — sem os sabores escolhidos, sem acompanhamento.
  // Pelo PDV aparecia, porque o PDV manda array. Achatar aqui conserta os
  // pedidos novos e os que já estão gravados, sem mexer no formato de origem.
  if (parsed && !Array.isArray(parsed) && typeof parsed === "object") {
    const achatado: any[] = [];
    for (const grupo of Object.values(parsed as Record<string, any>)) {
      if (!grupo || typeof grupo !== "object" || Array.isArray(grupo)) continue;
      for (const [nome, qtd] of Object.entries(grupo as Record<string, any>)) {
        const n = Number(qtd);
        if (nome && Number.isFinite(n) && n > 0) achatado.push({ name: nome, quantity: n });
      }
    }
    parsed = achatado;
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
          quantity: parseInt(match[1], 10) * parentQuantity,
        });
      } else if (item.trim()) {
        list.push({
          name: item.trim(),
          quantity: 1 * parentQuantity,
        });
      }
    } else if (item && typeof item === "object") {
      // Objeto com campos estruturados: { name, quantity, price }
      // A quantidade do sub-item é multiplicada pela quantidade do combo pai
      const rawName = String(
        item.name || item.productName || item.label || item.description || "",
      );
      const qty = Number(item.quantity || item.qty || 1);
      const price = item.price != null ? Number(item.price) : undefined;

      if (rawName.trim()) {
        list.push({
          name: rawName.trim(),
          quantity: qty * parentQuantity,
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
 *
 * O formato do cardápio online ({ grupoId: { nome: qtd } }) também sai daqui
 * achatado, pelo mesmo motivo de `parseComboSelections`: devolver [] para ele
 * fazia a detecção de bebida não enxergar a Coca-Cola DENTRO do combo — o
 * pedido do site ia para a impressora do bar sem bebida nenhuma, e a bebida do
 * combo não ganhava a tag na comanda.
 */
export function safeParseCombo(raw: any): any[] {
  if (!raw) return [];

  let parsed: any = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }

  if (Array.isArray(parsed)) return parsed;

  if (parsed && typeof parsed === "object") {
    const achatado: any[] = [];
    for (const grupo of Object.values(parsed as Record<string, any>)) {
      if (!grupo || typeof grupo !== "object" || Array.isArray(grupo)) continue;
      for (const [nome, qtd] of Object.entries(grupo as Record<string, any>)) {
        const n = Number(qtd);
        if (nome && Number.isFinite(n) && n > 0) achatado.push({ name: nome, quantity: n });
      }
    }
    return achatado;
  }

  return [];
}

/**
 * `comboSelections` no formato que o Assistente de Impressão entende: lista de
 * `{ name, quantity, price }`.
 *
 * O Assistente instalado nas lojas aceita SÓ array — o combo do cardápio online
 * chega como `{ grupoId: { nome: qtd } }` e ele descarta em silêncio. Foi assim
 * que o pedido 98 (01/09) saiu no papel como "1x Combo 10 Esfirras Simples + 2
 * Bebidas" e nada mais: a cozinha não sabia quais esfirras fazer. Na tela saía
 * certo, porque a tela usa `parseComboSelections`.
 *
 * Converter aqui, antes de enviar, conserta a impressão sem depender de a loja
 * atualizar o Assistente.
 *
 * A quantidade NÃO é multiplicada pela do item pai: é assim que o array do
 * iFood sempre chegou ao Assistente, e é ele quem imprime "2x" do lado.
 */
export function comboParaImpressao(raw: any): ComboItem[] | null {
  const lista = parseComboSelections(raw, 1);
  return lista.length > 0 ? lista : null;
}
