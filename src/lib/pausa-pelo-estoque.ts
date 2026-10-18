/**
 * PAUSA PELO ESTOQUE — "acabou o item, pausa o que usa ele".
 *
 * Douglas, 17/10/2026: "no controle de estoque ter a opção que fica desativada
 * de começo: quando o estoque acabar, pausar os produtos vinculados a esse item
 * na ficha técnica".
 *
 * Com a opção LIGADA (interruptor no topo da tela de Estoque; nasce desligada):
 *
 *   • PAUSA: um movimento (venda, perda, ajuste, contagem, Bill…) deixou o
 *     saldo de um insumo em ≤ 0 → os produtos ATIVOS cuja ficha técnica usa
 *     esse insumo pausam, e ficam marcados como "pausados pelo estoque".
 *     Produto já pausado pelo lojista não é tocado nem marcado.
 *
 *   • VOLTA: um produto marcado volta sozinho quando NENHUM insumo da ficha
 *     dele está mais em ≤ 0 (a carne chegou, mas o queijo ainda está zerado:
 *     continua pausado). Só volta o que a regra pausou — o que o lojista pausou
 *     na mão nunca é reativado por aqui.
 *
 *   • O lojista manda: reativar (ou pausar) na mão um produto marcado apaga a
 *     marca. A regra só volta a pausá-lo quando um insumo dele for movimentado
 *     de novo e ficar em ≤ 0 — por isso a pausa olha só os insumos TOCADOS pelo
 *     movimento, e não a loja inteira (a não ser quando o interruptor é ligado).
 *
 * Insumo arquivado (StockItem.active = false) não conta como "acabou": ele
 * saiu da lista, e o saldo esquecido dele não pode travar o cardápio.
 *
 * Este arquivo é só a decisão, sem banco — é o que o teste exercita
 * (scripts/teste-pausa-pelo-estoque.ts). O banco mora em
 * src/lib/pausa-pelo-estoque-no-banco.ts.
 */

export type FichaDoProduto = {
  produtoId: string;
  /** `MenuProduct.active` agora. */
  ativo: boolean;
  /** Insumos da ficha técnica (ProductRecipe.stockItemId). */
  insumos: string[];
};

export type EntradaDaDecisao = {
  /** Saldo atual de cada insumo ATIVO da loja que aparece nas fichas. Fora do mapa = não conta. */
  saldos: Map<string, number>;
  fichas: FichaDoProduto[];
  /** Produtos que a regra pausou e ainda não voltaram. */
  marcados: Set<string>;
  /** Insumos que o movimento mexeu. `null` = olhar a loja inteira (ligou o interruptor). */
  tocados: Set<string> | null;
};

export type Decisao = {
  /** Pausar e marcar; `faltando` = os insumos zerados da ficha (para a etiqueta). */
  pausar: { produtoId: string; faltando: string[] }[];
  /** Reativar e desmarcar. */
  reativar: string[];
  /** Só apagar a marca: já está ativo (alguém reativou por outro caminho). */
  desmarcar: string[];
};

export function insumoAcabou(saldos: Map<string, number>, insumoId: string): boolean {
  const s = saldos.get(insumoId);
  return typeof s === "number" && Number.isFinite(s) && s <= 0;
}

export function decidirPausaPeloEstoque(e: EntradaDaDecisao): Decisao {
  const pausar: Decisao["pausar"] = [];
  const reativar: string[] = [];
  const desmarcar: string[] = [];

  const fichaPorProduto = new Map<string, FichaDoProduto>();
  for (const f of e.fichas) fichaPorProduto.set(f.produtoId, f);

  for (const f of e.fichas) {
    if (e.marcados.has(f.produtoId)) continue;
    if (!f.ativo) continue; // pausado na mão: não é nosso
    const faltando = f.insumos.filter((i) => insumoAcabou(e.saldos, i));
    if (!faltando.length) continue;
    // Só pausa por insumo que o movimento mexeu: o lojista que reativou na mão
    // com o insumo zerado não é desfeito por uma venda de outra coisa.
    if (e.tocados && !faltando.some((i) => e.tocados!.has(i))) continue;
    pausar.push({ produtoId: f.produtoId, faltando });
  }

  for (const id of e.marcados) {
    const f = fichaPorProduto.get(id);
    if (f && f.ativo) { desmarcar.push(id); continue; }
    // Ficha apagada (ou produto sem insumo) não tem o que esperar: volta.
    const aindaFalta = (f?.insumos || []).some((i) => insumoAcabou(e.saldos, i));
    if (!aindaFalta) reativar.push(id);
  }

  return { pausar, reativar, desmarcar };
}
