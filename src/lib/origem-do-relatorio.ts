/**
 * De qual LOJA (ou canal) veio o pedido, para o filtro do relatório.
 *
 * ── Uma lista só, porque a pergunta do lojista é uma só ─────────────────────
 *
 * "Quanto vendi na Ragnar Pizza?" e "quanto vendi no Brendi?" são a mesma
 * pergunta — de onde veio o dinheiro —, e dois filtros separados ("loja" e
 * "canal") obrigariam a entender a diferença antes de conseguir perguntar.
 * Então a lista mistura os dois de propósito, e cada pedido cai em UM item:
 *
 *   • tem identidade de loja (iFood multi-loja, 99Food multi-loja)?
 *     → o NOME daquela loja, resolvido por lib/loja-de-origem.ts, que é o
 *       mesmo mapa que o painel e a impressora usam.
 *   • não tem? → o CANAL (Brendi, Jotajá, Site, Balcão, WhatsApp…).
 *
 * ── Por que o Brendi cai no canal ───────────────────────────────────────────
 *
 * O pedido do Brendi não grava identidade de loja nenhuma: em 90 dias, 96
 * pedidos, zero com `ifoodStoreMerchant` ou `food99AppShopId` (medido em
 * 22/09/2026). Ele é hub e repassa iFood e 99Food, mas a origem vem em
 * `salesChannel`, não numa loja cadastrada deste lado. Enquanto for assim,
 * "Brendi" é o que dá para oferecer — e é honesto: é exatamente o que o dado
 * permite separar.
 *
 * ── A lista sai dos PEDIDOS, não do cadastro ────────────────────────────────
 *
 * Opção que não tem pedido nenhum no período não entra. Filtro que oferece
 * uma loja e devolve relatório zerado faz o lojista achar que o sistema
 * perdeu a venda dele.
 */

import { chavesDeLojaDoPedido, type LojaDeOrigem, type PedidoComOrigem } from "@/lib/loja-de-origem";

export type OrigemDoPedido = {
  /** O que o filtro guarda. `loja:<chave>` ou `canal:<SOURCE>`. */
  chave: string;
  rotulo: string;
  /** Para a bolinha colorida do filtro. */
  cor?: string;
};

/** O pedido como o relatório o conhece. */
export type PedidoDoRelatorio = PedidoComOrigem & { source?: string | null };

/**
 * A chave de origem DESTE pedido — a mesma string que o filtro guarda.
 *
 * Pedido cuja loja não está na lista de lojas conhecidas cai no canal: é o
 * caso da integração que foi desconectada depois, e o histórico dela não pode
 * sumir do relatório por causa disso.
 */
export function chaveDaOrigem(
  pedido: PedidoDoRelatorio,
  lojas: LojaDeOrigem[] | null | undefined,
  normalizaCanal: (v: unknown) => string,
): string {
  const daLoja = lojaDoPedido(pedido, lojas);
  return daLoja ? `loja:${daLoja.chave}` : `canal:${normalizaCanal(pedido.source)}`;
}

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

/**
 * As origens presentes NESTES pedidos, com nome, ordenadas por quantidade.
 *
 * Ordena pelo que mais vende de propósito: numa conta com três lojas no iFood
 * e meia dúzia de canais, a que o lojista procura é quase sempre a maior.
 */
export function origensDosPedidos(
  pedidos: PedidoDoRelatorio[],
  lojas: LojaDeOrigem[] | null | undefined,
  normalizaCanal: (v: unknown) => string,
  rotuloDoCanal: (chave: string) => { label: string; cor: string },
): (OrigemDoPedido & { quantidade: number })[] {
  const conta = new Map<string, { origem: OrigemDoPedido; quantidade: number }>();

  for (const p of pedidos) {
    const daLoja = lojaDoPedido(p, lojas);
    const chave = daLoja ? `loja:${daLoja.chave}` : `canal:${normalizaCanal(p.source)}`;
    let linha = conta.get(chave);
    if (!linha) {
      if (daLoja) {
        // "🍔 Ragnar Pizza · iFood" — o nome primeiro, porque é o que o
        // lojista procura; a integração depois, para desempatar marca com
        // nome parecido em dois marketplaces.
        linha = { origem: { chave, rotulo: `${daLoja.emoji} ${daLoja.nome}`, cor: undefined }, quantidade: 0 };
      } else {
        const canal = rotuloDoCanal(normalizaCanal(p.source));
        linha = { origem: { chave, rotulo: canal.label, cor: canal.cor }, quantidade: 0 };
      }
      conta.set(chave, linha);
    }
    linha.quantidade++;
  }

  return Array.from(conta.values())
    .sort((a, b) => b.quantidade - a.quantidade || a.origem.rotulo.localeCompare(b.origem.rotulo))
    .map((l) => ({ ...l.origem, quantidade: l.quantidade }));
}
