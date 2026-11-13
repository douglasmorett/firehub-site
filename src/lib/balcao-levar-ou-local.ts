/**
 * PARA LEVAR OU CONSUMIR NO LOCAL — a escolha dentro do Balcão do PDV.
 *
 * ── O pedido ────────────────────────────────────────────────────────────────
 *
 * Garagem Burger (Thalyta; aprovado pelo Douglas em 13/11/2026): no balcão o
 * cliente ou leva o lanche ou come ali, e a cozinha precisa saber ANTES de
 * montar (embalagem ou prato). A loja escrevia na observação, que sai pequena
 * e no meio do papel — "quero no topo, grande".
 *
 * ── NÃO é um tipo de pedido novo ────────────────────────────────────────────
 *
 * O pedido continua RETIRADA / PRESENCIAL, exatamente como o Balcão de hoje:
 * caixa, fechamento, relatórios, fila do KDS e mensalidade não mudam uma linha.
 * É só um detalhe do Balcão, e "Para levar" é o padrão (o de sempre).
 *
 * ── Onde fica gravado: etiqueta na observação ───────────────────────────────
 *
 * CustomerOrder não tem campo JSON genérico de "extras" — os que existem são
 * todos de um assunto só (entregaGratis, reposicao, trocoNoPix…), e enfiar
 * isto num deles seria mentir sobre o que o campo guarda. Coluna nova pede
 * migração. A observação já é o lugar das etiquetas do sistema
 * ("[Acréscimo no crédito…]", "[📍 Taxa pelo bairro…]") e tem uma vantagem que
 * nenhum campo novo teria: o Assistente instalado nas lojas (1.2.46) já a
 * imprime. Enquanto a loja não atualiza, a etiqueta sai como observação; com o
 * Assistente novo sai grande no topo (campo `consumoNoBalcao`) e some da
 * observação para não sair duas vezes.
 *
 * Quem ESCREVE a etiqueta é só o servidor (lib/venda-presencial.ts), a partir
 * de um campo do corpo — a tela nunca monta o texto. Quem LÊ é tudo daqui.
 */

export type ConsumoNoBalcao = "LEVAR" | "LOCAL";

/** O padrão: o Balcão de sempre. */
export const CONSUMO_PADRAO: ConsumoNoBalcao = "LEVAR";

/** A etiqueta na observação do pedido. Mesmo texto para quem escreve e quem lê. */
export const ETIQUETA_DO_CONSUMO: Record<ConsumoNoBalcao, string> = {
  LEVAR: "[Balcão: para levar]",
  LOCAL: "[Balcão: consumir no local]",
};

/** Como sai no topo da comanda (o Assistente só tira os acentos). */
export const CONSUMO_NO_PAPEL: Record<ConsumoNoBalcao, string> = {
  LEVAR: "PARA LEVAR",
  LOCAL: "CONSUMIR NO LOCAL",
};

/** O selo no card do painel e do KDS. */
export const CONSUMO_NO_CARD: Record<ConsumoNoBalcao, string> = {
  LEVAR: "🥡 Para levar",
  LOCAL: "🍽️ Consumir no local",
};

/** O campo do corpo do PDV. Qualquer outra coisa = não veio (pedido sem etiqueta, como hoje). */
export function lerConsumoNoBalcao(bruto: unknown): ConsumoNoBalcao | null {
  const s = String(bruto ?? "").trim().toUpperCase();
  return s === "LEVAR" || s === "LOCAL" ? s : null;
}

// Aceita "Balcao" sem til: texto que passou por alguma limpeza de acento
// continua sendo lido. Sem "g" para PERGUNTAR (`exec` com "g" guarda lastIndex
// entre chamadas); as de TIRAR são montadas na hora.
const LER = /\[\s*Balc[ãa]o:\s*(para levar|consumir no local)\s*\]/i;
const TEXTO_DA_ETIQUETA: Record<ConsumoNoBalcao, string> = { LEVAR: "para levar", LOCAL: "consumir no local" };
const tirar = (qual: string) => new RegExp(String.raw`\s*\[\s*Balc[ãa]o:\s*(?:${qual})\s*\]`, "gi");

/**
 * A escolha deste pedido, lida da etiqueta. Só vale no balcão: o pedido que
 * depois virou entrega ou mesa (Trocar tipo) carrega a etiqueta velha, e ela
 * não diz mais nada.
 */
export function consumoDoPedido(pedido: { deliveryType?: unknown; notes?: unknown } | null | undefined): ConsumoNoBalcao | null {
  if (!pedido) return null;
  const tipo = String(pedido.deliveryType ?? "").toUpperCase();
  if (tipo === "DELIVERY" || tipo === "MESA") return null;
  if (typeof pedido.notes !== "string" || !pedido.notes) return null;
  const m = LER.exec(pedido.notes);
  if (!m) return null;
  return m[1].toLowerCase() === "para levar" ? "LEVAR" : "LOCAL";
}

/** A observação com a etiqueta já escrita na frente (o recado da loja vem depois). */
export function notasComConsumo(notas: string, consumo: ConsumoNoBalcao | null): string {
  if (!consumo) return notas;
  return [ETIQUETA_DO_CONSUMO[consumo], notas.trim()].filter(Boolean).join(" ");
}

/**
 * A observação sem a etiqueta — para quem já mostra a escolha em destaque (o
 * card do painel, o KDS). Com `so`, tira só aquela. Sem etiqueta, devolve o
 * mesmo valor que recebeu.
 */
export function notasSemConsumo<T>(notas: T, so?: ConsumoNoBalcao): T | string {
  if (typeof notas !== "string" || !LER.test(notas)) return notas;
  const qual = so ? TEXTO_DA_ETIQUETA[so] : `${TEXTO_DA_ETIQUETA.LEVAR}|${TEXTO_DA_ETIQUETA.LOCAL}`;
  return notas.replace(tirar(qual), "").trim();
}

/**
 * O que muda no pedido que vai ao Assistente:
 *
 *   - `consumoNoBalcao` com o texto pronto ("PARA LEVAR" / "CONSUMIR NO
 *     LOCAL"), que o Assistente 1.2.47+ imprime no topo, dobrado — e aí ele
 *     mesmo tira a etiqueta do recado para não sair duas vezes;
 *   - a etiqueta de "para levar" sai da observação do papel. É o padrão, o
 *     Balcão de sempre: no Assistente que ainda não conhece o campo, toda
 *     venda de balcão de toda loja ganharia "[Balcao: para levar]" na tarja
 *     de observação. A de "consumir no local" fica — é a exceção que a
 *     cozinha precisa ver, e no Assistente antigo é a observação que a leva.
 *
 * Sem escolha (pedido de app, de mesa, antigo) devolve `{}` e o papel sai
 * como sempre saiu.
 */
export function camposDoConsumoParaImpressao(pedido: { deliveryType?: unknown; notes?: unknown; kind?: unknown }): {
  consumoNoBalcao?: string;
  notes?: string;
} {
  if (!pedido || pedido.kind) return {};
  const c = consumoDoPedido(pedido);
  if (!c) return {};
  return c === "LEVAR"
    ? { consumoNoBalcao: CONSUMO_NO_PAPEL.LEVAR, notes: notasSemConsumo(pedido.notes as string, "LEVAR") }
    : { consumoNoBalcao: CONSUMO_NO_PAPEL.LOCAL };
}
