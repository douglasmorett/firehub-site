/**
 * MEIO A MEIO DENTRO DE CADA PIZZA, COM O TAMANHO NA CONTA.
 *
 * A pizza do card é uma metade; uma pergunta opcional ("Meio a meio?") escolhe
 * a outra entre as demais pizzas, cada uma como a opção "1/2 <nome>". É o
 * jeito do Menudino e do Wabiz, e o que a Serpa Pizzaria pediu em 27/09/2026:
 * o cliente toca na Calabresa, escolhe o tamanho, e o cardápio pergunta se ele
 * quer acrescentar outro sabor.
 *
 * ── A CONTA ─────────────────────────────────────────────────────────────────
 *
 * O card cobra a pizza dele (base + o tamanho escolhido); a meia cobra a
 * DIFERENÇA até o preço final da combinação, NAQUELE tamanho:
 *
 *   média ("metade de cada", a Serpa):   final = (esta + outra) / 2
 *   maior ("vale a mais cara"):           final = max(esta, outra)
 *
 *   Calabresa (P 40 · G 60) + meia Camarão (P 50 · G 90), média:
 *     Pequena → final 45, acréscimo +5 · Grande → final 75, acréscimo +15
 *
 * Como o Grande custa diferente em cada sabor, o acréscimo depende do tamanho:
 * vai em `precoPorEscolha` ({ "Pequena": 5, "Grande": 15 }), que o motor de
 * preço (lib/preco-combo.ts) resolve pela escolha do cliente. Quando a outra é
 * mais barata o acréscimo é NEGATIVO — é o que faz a ordem não importar
 * (Camarão + meia Calabresa também dá 45 / 75).
 *
 * Arquivo puro, sem imports: o script scripts/meio-a-meio-nas-pizzas.mjs o
 * carrega direto com --experimental-strip-types.
 */

export type RegraDoMeio = "media" | "maior";

export const TITULO_DO_MEIO: Record<RegraDoMeio, string> = {
  media: "Meio a meio? Escolha a outra metade (cobra metade do preço de cada)",
  maior: "Meio a meio? Escolha a outra metade (vale o preço da mais cara)",
};

export function ehPerguntaDeMeio(titulo: unknown): boolean {
  return /^meio a meio\?/i.test(String(titulo ?? "").trim());
}

/** A regra está escrita no título, para o cliente ler — e é de lá que se relê. */
export function regraDoTitulo(titulo: unknown): RegraDoMeio {
  return /mais cara/i.test(String(titulo ?? "")) ? "maior" : "media";
}

export const PREFIXO_DA_MEIA = "1/2 ";

export function ehPerguntaDeTamanho(titulo: unknown): boolean {
  return /^\s*(\d+\s*[.)-]?\s*)?tamanho/i.test(String(titulo ?? ""));
}

export type PizzaDoMeio = {
  id: string;
  name: string;
  price: number;
  comboGroups?: {
    title?: string | null;
    items?: { additionalPrice?: number | null; menuProduct?: { name?: string | null } | null }[] | null;
  }[] | null;
};

/**
 * Preço da pizza INTEIRA em cada tamanho: base + o acréscimo do tamanho. Sem
 * pergunta de tamanho, um só preço, na chave "".
 */
export function precosPorTamanho(pizza: PizzaDoMeio): Map<string, number> {
  const base = Number(pizza.price) || 0;
  const tamanho = (pizza.comboGroups || []).find((g) => ehPerguntaDeTamanho(g?.title));
  const saida = new Map<string, number>();
  for (const it of tamanho?.items || []) {
    const nome = String(it?.menuProduct?.name || "").trim();
    if (nome) saida.set(nome, r2(base + (Number(it?.additionalPrice) || 0)));
  }
  if (saida.size === 0) saida.set("", r2(base));
  return saida;
}

export type MeiaCalculada = {
  /** "1/2 Camarão" */
  nome: string;
  /** Acréscimo no primeiro tamanho da pergunta (o que vale sem tamanho escolhido). */
  additionalPrice: number;
  /**
   * { tamanho: acréscimo }, ou null quando a pizza não tem pergunta de tamanho.
   * Tamanho com `null` = não tem meio a meio nele (a Serpa não faz na Pequena):
   * a opção some da tela e o pedido é recusado (lib/preco-combo, bloqueiosDaOpcao).
   */
  precoPorEscolha: Record<string, number | null> | null;
  /** "Pequena R$ 45,00 · Grande R$ 75,00": o preço FINAL, que é o que o cliente quer ver. */
  optionNote: string;
};

/** A meia `outra` dentro do card `esta`. */
export function meiaNaPizza(esta: PizzaDoMeio, outra: PizzaDoMeio, regra: RegraDoMeio, semMeio: readonly string[] = []): MeiaCalculada {
  const daEsta = precosPorTamanho(esta);
  const daOutra = precosPorTamanho(outra);
  const tabela: Record<string, number | null> = {};
  const finais: string[] = [];
  for (const [tamanho, precoEsta] of daEsta) {
    // Tamanho em que a casa não faz meio a meio: bloqueado, e a nota não o cita.
    if (tamanho && semMeio.includes(tamanho)) {
      tabela[tamanho] = null;
      continue;
    }
    // Tamanho que a outra não tem não entra na tabela: ali vale o
    // additionalPrice, e a nota não promete um preço que não existe.
    const precoOutra = daOutra.get(tamanho) ?? (daOutra.size === 1 ? [...daOutra.values()][0] : undefined);
    if (precoOutra === undefined) continue;
    const final = regra === "maior" ? Math.max(precoEsta, precoOutra) : r2((precoEsta + precoOutra) / 2);
    tabela[tamanho] = r2(final - precoEsta);
    finais.push(tamanho ? `${tamanho} R$ ${brl(final)}` : `Meio a meio sai por R$ ${brl(final)}`);
  }
  const primeiro = [...daEsta.keys()].find((t) => t in tabela && tabela[t] !== null);
  const comTamanho = !daEsta.has("");
  return {
    nome: PREFIXO_DA_MEIA + outra.name,
    additionalPrice: primeiro !== undefined ? (tabela[primeiro] as number) : 0,
    precoPorEscolha: comTamanho && Object.keys(tabela).length > 0 ? tabela : null,
    optionNote: finais.join(" · "),
  };
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

function brl(n: number): string {
  return n.toFixed(2).replace(".", ",");
}
