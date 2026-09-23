/**
 * De qual LOJA da conta veio o pedido, para o filtro "Loja" do relatório.
 *
 * ── Loja e plataforma são dois filtros desde 23/09/2026 ─────────────────────
 *
 * Até essa data esta lista misturava as duas coisas de propósito — a loja
 * quando havia identidade (iFood multi-loja), o canal quando não havia —, com
 * a ideia de que "quanto vendi na Ragnar Pizza" e "quanto vendi no Brendi"
 * eram a mesma pergunta. Na prática o lojista não achou a plataforma ali: numa
 * loja só, o filtro se chamava "Loja / Origem · Todas as lojas (4)" e as
 * quatro "lojas" eram iFood, 99Food, Wabiz e Balcão. O dono pediu a plataforma
 * separada, com o nome dela, e é assim agora:
 *
 *   • Plataforma (iFood, 99Food, Site próprio, Balcão…) — lib/canal-do-pedido.ts,
 *     a régua do sistema inteiro; o filtro mora no próprio relatório.
 *   • Loja — ESTE arquivo, e só quando a conta tem mais de uma (três marcas no
 *     iFood, duas lojas no 99Food, um grupo de lojas). Numa loja só ele some.
 *
 * Os dois se combinam: "iFood" × "Ragnar Pizza".
 *
 * ── A lista sai dos PEDIDOS, não do cadastro ────────────────────────────────
 *
 * Loja que não tem pedido nenhum no período não entra. Filtro que oferece uma
 * loja e devolve relatório zerado faz o lojista achar que o sistema perdeu a
 * venda dele.
 */

import { chavesDeLojaDoPedido, type LojaDeOrigem, type PedidoComOrigem } from "@/lib/loja-de-origem";

/** O pedido como o relatório o conhece. */
export type PedidoDoRelatorio = PedidoComOrigem & { source?: string | null };

/**
 * A chave que o filtro guarda para o pedido de integração cuja loja não está
 * mais na lista — a integração desconectada depois. O histórico dela não pode
 * sumir do relatório por isso: vira uma opção própria.
 */
export const LOJA_NAO_IDENTIFICADA = "loja:?";

/** A loja conhecida deste pedido, ou null. */
export function lojaDoPedido(
  pedido: PedidoDoRelatorio,
  lojas: LojaDeOrigem[] | null | undefined,
): LojaDeOrigem | null {
  if (!lojas || lojas.length === 0) return null;
  const doPedido = chavesDeLojaDoPedido(pedido);
  if (doPedido.length === 0) return null;
  for (const loja of lojas) {
    const dela = loja.chaves && loja.chaves.length ? loja.chaves : [loja.chave];
    if (dela.some((k) => doPedido.includes(k))) return loja;
  }
  return null;
}

/** A chave de loja deste pedido — a mesma string que o filtro guarda. */
export function chaveDaLoja(pedido: PedidoDoRelatorio, lojas: LojaDeOrigem[] | null | undefined): string {
  const loja = lojaDoPedido(pedido, lojas);
  return loja ? `loja:${loja.chave}` : LOJA_NAO_IDENTIFICADA;
}

/**
 * As lojas presentes NESTES pedidos, com nome, ordenadas por quantidade —
 * numa conta com três marcas no iFood, a que o lojista procura é quase sempre
 * a maior. Vazia quando a conta não tem o que separar.
 */
export function lojasDosPedidos(
  pedidos: PedidoDoRelatorio[],
  lojas: LojaDeOrigem[] | null | undefined,
): { chave: string; rotulo: string; quantidade: number }[] {
  if (!lojas || lojas.length === 0) return [];
  const conta = new Map<string, { chave: string; rotulo: string; quantidade: number }>();
  for (const p of pedidos) {
    const loja = lojaDoPedido(p, lojas);
    const chave = loja ? `loja:${loja.chave}` : LOJA_NAO_IDENTIFICADA;
    let linha = conta.get(chave);
    if (!linha) {
      linha = { chave, rotulo: loja ? `${loja.emoji} ${loja.nome}` : "❔ Loja que não está mais conectada", quantidade: 0 };
      conta.set(chave, linha);
    }
    linha.quantidade++;
  }
  return Array.from(conta.values()).sort((a, b) => b.quantidade - a.quantidade || a.rotulo.localeCompare(b.rotulo));
}
