/**
 * src/lib/beverage.ts
 * Utilitário central de detecção automática de bebidas por palavra-chave.
 * Usado por: JotaJá, iFood, Dashboard e Assistente de Impressão.
 * Suporta palavras-chave padrão + palavras-chave personalizadas da loja.
 *
 * ── POR QUE QUATRO LISTAS, E NÃO UMA ────────────────────────────────────────
 *
 * A lista única antiga errava para os dois lados, medido em cardápios reais:
 *
 *   - FALSO POSITIVO: "Filé ao Molho de VINHO", "Pizza 51 Queijos", "Marmitex
 *     SOL Nascente" e "Sorvete LATA Gigante" abriam o modal 🥤 do motoboy.
 *     Quando o aviso dispara em prato, o entregador aprende que é ruído e toca
 *     "Sim" no reflexo — o modal deixa de proteger justamente quando importa.
 *   - FALSO NEGATIVO: "Refri Uva 1L", "Kuat 1L" e "Toddynho 200ml" passavam
 *     SEM modal nenhum, e o toque já finalizava o pedido com a bebida esquecida
 *     na loja.
 *
 * Agora:
 *   SOZINHAS  — palavras que são bebida por si ("coca", "refri", "guarana").
 *   AMBIGUAS  — palavras que também são comida/nome de prato ("vinho", "sol",
 *               "51", "gin", "cha", "mate", "ice"): só valem COM contexto.
 *   CONTEXTO  — o que transforma a ambígua em bebida ("lata", "600ml",
 *               "garrafa", "gelada"...).
 *   CATEGORIA — nomes de categoria de cardápio que dizem "isto é bebida".
 */

import { safeParseCombo } from "@/lib/parse-combo";

export function cleanAscii(str: string): string {
  if (!str) return "";
  return String(str)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/º/g, ".")
    .replace(/ª/g, ".")
    .replace(/Ç/g, "C")
    .replace(/ç/g, "c");
}

/** Bebida por si só, sem depender de contexto. */
const SOZINHAS =
  "bebida|bebidas|refrigerante|refrigerantes|refri|refris|suco|sucos|agua|guarana|guaravita|coca|coca-cola|fanta|sprite|pepsi|soda|h2oh|monster|red bull|redbull|energetico|long neck|longneck|heineken|stella|budweiser|skol|brahma|antarctica|amstel|eisenbahn|corona|smirnoff|tonica|schweppes|del valle|tampico|kapo|suffresh|feel good|kombucha|bravus|skol beats|pitu|velho barreiro|corote|vodka|whisky|whiskey|licor|espumante|champagne|chopp|cerveja|cervejas|tubaina|itubaina|kuat|sukita|poty|dolly|ades|toddynho|milk shake|milkshake|milk-shake|achocolatado|chocolate quente|cappuccino|capuccino|yakult|cachaca|pinga|aguardente|cha gelado|cha mate|mate leao|ice tea|1l|1,5l|1,5 l|1.5l";

/** Também é comida ou nome de prato: só vira bebida com CONTEXTO ou categoria. */
const AMBIGUAS = "sol|51|vinho|ice|gin|cha|mate|tnt|vibe";

/** O que confirma a ambígua como bebida quando aparece no MESMO nome. */
const CONTEXTO =
  "lata|latinha|garrafa|garrafinha|long neck|longneck|\\d+\\s?ml|\\d+\\s?l\\b|litro|litros|bebida|bebidas|cerveja|cervejas|refrigerante|drink|dose|gelada|gelado|tonica|destilado|chopp|adega|cachaca";

/** Categoria de cardápio que é de bebida. Tier próprio, com plurais. */
const CATEGORIAS_DE_BEBIDA =
  "bebida|bebidas|cerveja|cervejas|refrigerante|refrigerantes|suco|sucos|vinho|vinhos|destilado|destilados|drink|drinks|adega|bar|cha|chas|agua|aguas";

const reSozinhas = new RegExp(`\\b(${SOZINHAS})\\b`, "i");
const reAmbiguas = new RegExp(`\\b(${AMBIGUAS})\\b`, "i");
const reContexto = new RegExp(`\\b(${CONTEXTO})\\b`, "i");
const reCategoria = new RegExp(`\\b(${CATEGORIAS_DE_BEBIDA})\\b`, "i");

function regexCustom(customKeywords?: string | string[]): RegExp | null {
  if (!customKeywords) return null;
  const list = typeof customKeywords === "string" ? customKeywords.split(",") : customKeywords;
  const cleanList = list.map(k => cleanAscii(k.trim())).filter(Boolean);
  if (cleanList.length === 0) return null;
  const pattern = cleanList.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return new RegExp(`\\b(${pattern})\\b`, "i");
}

/** A CATEGORIA do produto é de bebida? (não confundir com o nome do item) */
export function isBeverageCategory(category?: string | null): boolean {
  if (!category) return false;
  return reCategoria.test(cleanAscii(category));
}

/**
 * O NOME é de bebida?
 * `categoriaEhDeBebida` destrava as ambíguas: "Vinho Tinto Suave" na categoria
 * "Vinhos" é bebida; "Filé ao Molho de Vinho" na categoria "Pratos" não é.
 */
export function isBeverageName(
  name?: string | null,
  customKeywords?: string | string[],
  categoriaEhDeBebida?: boolean
): boolean {
  if (!name) return false;
  const cleanName = cleanAscii(name);

  // A palavra da LOJA é lei — é a saída de emergência para a marca regional.
  const custom = regexCustom(customKeywords);
  if (custom && custom.test(cleanName)) return true;

  if (reSozinhas.test(cleanName)) return true;
  if (reAmbiguas.test(cleanName) && (reContexto.test(cleanName) || categoriaEhDeBebida === true)) return true;
  return false;
}

export function isBeverageItem(item: any, customKeywords?: string | string[]): boolean {
  if (!item) return false;
  if (item.isBeverage === true || item.isBeverage === "true") return true;
  if (item.menuProduct?.isBeverage === true) return true;
  const cat = String(item.category || item.menuProduct?.category || "");
  // A coluna real do item de pedido é `productName`; `item.name` só existe em
  // payload montado na mão. Sem o fallback, pedido vindo do banco era invisível.
  const name = String(item.name || item.productName || item.menuProduct?.name || "");
  const catBebida = isBeverageCategory(cat);
  if (catBebida && name) return true;
  if (isBeverageName(name, customKeywords, catBebida)) return true;

  if (item.comboSelections) {
    try {
      const parsed = safeParseCombo(item.comboSelections);
      if (Array.isArray(parsed) && parsed.some((s: any) => isBeverageName(s.name || s.productName || s.title, customKeywords))) {
        return true;
      }
    } catch {}
  }
  return false;
}

/**
 * As bebidas de um pedido, com a QUANTIDADE certa — é o que o modal do motoboy
 * lista ("esse pedido tem 2 Coca Lata, você entregou?").
 *
 * Regras que já saíram erradas em produção:
 *  - O item PAI só entra quando ele mesmo é bebida E não há bebida dentro do
 *    combo — senão "1x Combo (com 2 Cocas)" listava 3 bebidas onde há 2, e o
 *    motoboy procurava a lata que não existe. A trava é "tem bebida dentro",
 *    NÃO "é combo": Jotajá/Brendi gravam opções de QUALQUER item em
 *    comboSelections, e uma "Coca 2L" com a opção "Gelada" sumiria da lista.
 *  - Bebida DENTRO do combo multiplica pela quantidade do pai: 2x combo com
 *    2 Cocas são 4 Cocas — o modal dizia 2, o motoboy conferia 2, e saíam 2
 *    faltando com o modal tendo dito que estava tudo certo.
 */
export function getBeveragesFromOrder(order: any, customKeywords?: string | string[]): { name: string; quantity: number }[] {
  if (!order) return [];
  const beverages: { name: string; quantity: number }[] = [];
  const somar = (name: string, quantity: number) => {
    const existente = beverages.find(b => b.name === name);
    if (existente) existente.quantity += quantity;
    else beverages.push({ name, quantity });
  };

  const items = Array.isArray(order.items) ? order.items : [];
  for (const item of items) {
    const qty = Number(item.quantity) || 1;
    const name = String(item.name || item.productName || item.menuProduct?.name || "");
    const catBebida = isBeverageCategory(String(item.category || item.menuProduct?.category || ""));
    const paiEhBebida =
      item.isBeverage === true || item.menuProduct?.isBeverage === true ||
      (catBebida && !!name) || isBeverageName(name, customKeywords, catBebida);

    let bebidasDeDentro: { name: string; quantity: number }[] = [];
    if (item.comboSelections) {
      try {
        const comboSels = safeParseCombo(item.comboSelections);
        if (Array.isArray(comboSels)) {
          for (const sel of comboSels) {
            const selName = sel.name || sel.productName || sel.title;
            if (selName && isBeverageName(selName, customKeywords)) {
              bebidasDeDentro.push({ name: String(selName), quantity: (Number(sel.quantity) || 1) * qty });
            }
            if (Array.isArray(sel.extras)) {
              for (const ext of sel.extras) {
                const extName = typeof ext === "string" ? ext : ext?.name;
                if (extName && isBeverageName(extName, customKeywords)) {
                  bebidasDeDentro.push({ name: String(extName), quantity: (Number((ext as any)?.quantity) || 1) * qty });
                }
              }
            }
          }
        }
      } catch {}
    }

    if (bebidasDeDentro.length > 0) {
      for (const b of bebidasDeDentro) somar(b.name, b.quantity);
    } else if (paiEhBebida && name) {
      somar(name, qty);
    }
  }

  // Observação do cliente NÃO entra na lista de bebidas a conferir: "SEM
  // bebida" e "troca o suco por coca" casavam palavra e viravam "item a
  // entregar" no modal. A observação já sai no card do pedido, onde é lida
  // como texto — não como contagem.

  return beverages;
}
