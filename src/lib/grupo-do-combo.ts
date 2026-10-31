/**
 * Como uma pergunta (ComboGroup) e as opções dela viram payload de gravação.
 *
 * Saiu de api/admin/menu-products/route.ts para a cópia de pergunta
 * (api/admin/menu-products/copiar-pergunta) gravar pelo MESMO caminho do POST
 * e do PUT — campo novo que entra num lugar só não falta na cópia. Arquivo
 * puro, sem banco.
 */

export const comboItemId = (it: any): string | null =>
  typeof it === "string" ? it : (it?.id || it?.menuProductId || null);

/** Acréscimo promocional da opção: número ≥ 0, ou NULL (sem promoção). */
export const promoDaOpcao = (v: any): number | null => {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/**
 * Monta o payload de um grupo de combo. POST e PUT gravam pelo mesmo caminho —
 * antes cada um montava o seu, e um campo novo entrava só na metade dos casos.
 *
 * `minQty` chega como número ou não chega. Ausente vira NULO de propósito: é o
 * que preserva a regra antiga ("exige exatamente maxQty") para todo combo
 * gravado antes da coluna existir, e para todo cliente da API que ainda não
 * sabe mandar o campo.
 */
export function dadosDoGrupo(g: any, gIdx: number) {
  const maxQty = Number(g?.maxQty) > 0 ? Number(g.maxQty) : 1;
  const minBruto = Number(g?.minQty);
  const minQty =
    g?.minQty === null || g?.minQty === undefined || !Number.isFinite(minBruto) || minBruto < 0
      ? null
      : Math.min(Math.trunc(minBruto), maxQty);

  // Como a pergunta cobra várias escolhas. Só "MAIOR" e "MEDIA" são gravados;
  // qualquer outra coisa (inclusive vazio) vira NULL, que é a regra de sempre
  // — somar. Ver lib/preco-combo.ts.
  const regra = String(g?.priceRule || "").trim().toUpperCase();
  const priceRule = regra === "MAIOR" || regra === "MEDIA" ? regra : null;

  return {
    title: g?.title,
    maxQty,
    minQty,
    priceRule,
    sortOrder: gIdx,
    items: {
      create: (Array.isArray(g?.items) ? g.items : []).map((it: any, iIdx: number) => {
        const maxItem = Number(it?.maxPerItem);
        // Preço por canal da OPÇÃO: só grava o que é número positivo. Zero,
        // vazio e lixo viram NULL, que é "usa o additionalPrice" — a mesma
        // regra do preço por canal do produto, e pelo mesmo motivo: campo
        // apagado pela metade não pode virar opção de graça no cardápio.
        const porCanal = (v: any) => {
          const n = Number(v);
          return Number.isFinite(n) && n > 0 ? n : null;
        };
        return {
          menuProductId: comboItemId(it) as string,
          additionalPrice: typeof it === "object" ? (Number(it?.additionalPrice) || 0) : 0,
          additionalPriceSalao: typeof it === "object" ? porCanal(it?.additionalPriceSalao) : null,
          additionalPriceDelivery: typeof it === "object" ? porCanal(it?.additionalPriceDelivery) : null,
          additionalPriceTotem: typeof it === "object" ? porCanal(it?.additionalPriceTotem) : null,
          // Promoção da opção: aqui o zero VALE ("Grande pelo preço da
          // Pequena"); vazio e lixo viram NULL = sem promoção.
          promoAdditionalPrice: typeof it === "object" ? promoDaOpcao(it?.promoAdditionalPrice) : null,
          maxPerItem: Number.isFinite(maxItem) && maxItem > 0 ? Math.trunc(maxItem) : null,
          optionNote:
            typeof it === "object" && typeof it?.optionNote === "string" && it.optionNote.trim()
              ? it.optionNote.trim()
              : null,
          // A tabela do meio a meio por tamanho volta do jeito que veio: a
          // tela não a edita, mas o salvamento recria as opções, e sem isto
          // qualquer "Salvar" na pizza apagava o preço da meia no Grande.
          // (refazerMeiasDaLoja, logo depois, recalcula de qualquer forma.)
          precoPorEscolha: typeof it === "object" ? tabelaValida(it?.precoPorEscolha) : undefined,
          // A ordem que o lojista arrumou com as setinhas na tela. É o índice
          // do array, do mesmo jeito que o grupo usa `gIdx` — sem isto as
          // setinhas mexiam na tela e nada mudava para o cliente.
          sortOrder: iIdx,
        };
      }),
    },
  };
}

/** `{ "Grande": 15 }` com número em todo valor, ou nada. */
export function tabelaValida(t: any): Record<string, number | null> | undefined {
  if (!t || typeof t !== "object" || Array.isArray(t)) return undefined;
  const saida: Record<string, number | null> = {};
  for (const [k, v] of Object.entries(t)) {
    // null = "não existe com esta escolha" (meia pizza na Pequena, Serpa): fica.
    if (k && v === null) { saida[k] = null; continue; }
    const n = Number(v);
    if (k && Number.isFinite(n)) saida[k] = n;
  }
  return Object.keys(saida).length > 0 ? saida : undefined;
}
