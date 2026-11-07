/**
 * PREÇO DA OPÇÃO EM TODOS OS PRODUTOS QUE A OFERECEM.
 *
 * Charlie Brown Pizzas, 07/11/2026: o lojista trocou o preço do produto
 * "Borda de Catupiry" para R$ 14 e "nada mudou". Dentro da pizza o cliente paga
 * o acréscimo da OPÇÃO (ComboGroupItem.additionalPrice), que fica em cada pizza
 * — e a borda estava em três (brotinho +8, grande +12, grande 2 sabores +12).
 * O dono pediu: ao mudar o preço, perguntar se aplica em todas.
 *
 * Arquivo puro, sem banco: a tela (MenuProductManager) monta a lista com
 * `ondeAOpcaoAparece` e a rota (PUT api/admin/menu-products) confere o que
 * chegou com `conferirOpcoesParaAplicar` antes de gravar.
 *
 * Fica de fora, com aviso, a opção que tem preço próprio por canal
 * (additionalPriceSalao/Delivery/Totem) ou preço conforme outra escolha
 * (precoPorEscolha, a meia por tamanho): ali um valor só sobrescreveria uma
 * decisão da loja. A meia ("1/2 ...") nem entra: quem calcula o preço dela é
 * lib/meio-a-meio.ts, que refaria por cima.
 */
import { PREFIXO_DA_MEIA } from "./meio-a-meio";

export type OpcaoEmOutroProduto = {
  /** Id do ComboGroupItem (a opção dentro do grupo). */
  itemId: string;
  produtoId: string;
  produto: string;
  grupo: string;
  acrescimoAtual: number;
  /** Motivo de NÃO aplicar aqui; nulo = pode aplicar. */
  bloqueio: string | null;
};

const temPrecoPorCanal = (it: any) =>
  [it?.additionalPriceSalao, it?.additionalPriceDelivery, it?.additionalPriceTotem].some((v) => Number(v) > 0);

const temPrecoPorEscolha = (it: any) =>
  it?.precoPorEscolha != null && typeof it.precoPorEscolha === "object" && Object.keys(it.precoPorEscolha).length > 0;

export function bloqueioDaOpcao(it: any): string | null {
  if (temPrecoPorCanal(it)) return "tem preço por canal (balcão/delivery/totem) — ajuste nesse produto";
  if (temPrecoPorEscolha(it)) return "o preço muda conforme outra escolha (tamanho) — ajuste nesse produto";
  return null;
}

/**
 * Onde o produto `opcao` aparece como opção em OUTROS produtos da mesma loja.
 * Entra quem cobra diferente do preço novo (o que já está igual não precisa
 * de pergunta) e quem está bloqueado (para o lojista saber que ali não muda).
 */
export function ondeAOpcaoAparece(
  produtos: any[],
  opcao: { id: string; name?: string | null; franchiseeId?: string | null },
  precoNovo: number
): OpcaoEmOutroProduto[] {
  if (!opcao?.id || !(precoNovo > 0)) return [];
  if (String(opcao.name || "").startsWith(PREFIXO_DA_MEIA)) return [];
  const lista: OpcaoEmOutroProduto[] = [];
  for (const p of produtos || []) {
    if (!p?.id || String(p.id) === String(opcao.id)) continue;
    if ((p.franchiseeId ?? null) !== (opcao.franchiseeId ?? null)) continue;
    for (const g of p.comboGroups || []) {
      for (const it of g?.items || []) {
        const idDaOpcao = it?.menuProduct?.id ?? it?.menuProductId;
        if (String(idDaOpcao) !== String(opcao.id) || !it?.id) continue;
        const acrescimoAtual = Number(it.additionalPrice) || 0;
        const bloqueio = bloqueioDaOpcao(it);
        if (!bloqueio && acrescimoAtual === precoNovo) continue;
        lista.push({ itemId: String(it.id), produtoId: String(p.id), produto: String(p.name || ""), grupo: String(g.title || ""), acrescimoAtual, bloqueio });
      }
    }
  }
  return lista;
}

/**
 * Confere, na rota, os ids que a tela mandou aplicar. `linhas` é o que o banco
 * devolveu para esses ids (ComboGroupItem com o dono do grupo).
 *
 * - `recusadas`: id que não existe, que não é desta opção ou cujo grupo é de
 *   produto de outra loja — qualquer um derruba o pedido inteiro na rota;
 * - `comPrecoProprio`: da loja, mas com preço por canal/por escolha — pula;
 * - `aplicar`: o resto.
 */
export function conferirOpcoesParaAplicar(
  pedidos: string[],
  linhas: { id: string; menuProductId: string; comboGroup?: { menuProduct?: { franchiseeId?: string | null } | null } | null; [k: string]: any }[],
  opcaoId: string,
  lojaId: string | null
): { aplicar: string[]; comPrecoProprio: string[]; recusadas: string[] } {
  const porId = new Map(linhas.map((l) => [String(l.id), l]));
  const aplicar: string[] = [];
  const comPrecoProprio: string[] = [];
  const recusadas: string[] = [];
  for (const id of [...new Set(pedidos.map(String))]) {
    const l = porId.get(id);
    const loja = l?.comboGroup?.menuProduct?.franchiseeId ?? null;
    if (!l || String(l.menuProductId) !== String(opcaoId) || !lojaId || loja !== lojaId) recusadas.push(id);
    else if (bloqueioDaOpcao(l)) comPrecoProprio.push(id);
    else aplicar.push(id);
  }
  return { aplicar, comPrecoProprio, recusadas };
}
