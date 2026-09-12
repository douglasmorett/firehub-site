/**
 * src/lib/loja-de-origem.ts
 *
 * De QUAL LOJA veio o pedido — e se ESTA impressora recebe pedido daquela loja.
 *
 * Uma conta do FireHub pode ter mais de uma loja dentro da mesma integração:
 * três marcas no iFood (Ragnar Pizza, Ragnar Burguer, Tadala) chegando no
 * mesmo painel, duas lojas no 99Food, e assim por diante. A cozinha de cada
 * marca quer a SUA comanda na SUA impressora — e o filtro por categoria e o por
 * canal ("iFood") não sabem separar uma marca da outra: para eles é tudo iFood.
 *
 * A identidade da loja de origem vira uma CHAVE de texto, e a impressora guarda
 * a lista das chaves que atende (`lojas`; vazia = todas):
 *
 *   ifood:<merchantId>        a loja do iFood (CustomerOrder.ifoodStoreMerchant)
 *   99food:<app_shop_id>      a loja do 99Food (food99AppShopId / food99ShopId)
 *   loja:<franchiseeId>       a própria loja — site, WhatsApp, mesa, balcão,
 *                             totem e integrações que não identificam loja
 *
 * O pedido do 99Food carrega as duas chaves (app_shop_id E shop_id) porque o
 * evento deles ora traz uma, ora a outra; a tela oferece o app_shop_id, que é
 * o vínculo, e o shop_id serve de reserva para o vínculo antigo (Brasa Burguer),
 * em que o app_shop_id é o próprio id da conta.
 *
 * Browser-safe de propósito: o navegador (print.ts) e a fila da nuvem
 * (roteamento-de-impressao.ts) decidem com a MESMA função.
 */

/**
 * Uma loja de origem com NOME, para a tela mostrar e a impressora escolher.
 *
 * Quem monta a lista é lib/lojas-de-origem-da-conta.ts (servidor, com banco).
 * O tipo mora aqui porque o quadro de pedidos é componente de cliente e
 * importar de lá arrastaria o prisma para o navegador.
 */
export type LojaDeOrigem = {
  /** A chave principal, que a impressora guarda. */
  chave: string;
  /** Todas as chaves que significam esta loja. Ausente = só `chave`. */
  chaves?: string[];
  nome: string;
  emoji: string;
  origem: string;
};

/**
 * O nome da loja de onde veio o pedido, ou vazio.
 *
 * Vazio também quando a conta não tem o que separar (a lista vem vazia) — e
 * isso é o certo: numa loja só, o nome seria a mesma palavra repetida em
 * todo pedido da tela.
 */
export function nomeDaLojaDoPedido(
  pedido: PedidoComOrigem | null | undefined,
  lojas: LojaDeOrigem[] | null | undefined,
): { nome: string; emoji: string } | null {
  if (!pedido || !lojas || lojas.length === 0) return null;
  const doPedido = chavesDeLojaDoPedido(pedido);
  if (doPedido.length === 0) return null;
  for (const loja of lojas) {
    const dela = loja.chaves && loja.chaves.length ? loja.chaves : [loja.chave];
    if (dela.some((k) => doPedido.includes(k))) return { nome: loja.nome, emoji: loja.emoji };
  }
  return null;
}

const texto = (v: unknown) => String(v ?? "").trim().toLowerCase();

export const chaveIfood = (merchantId: string) => `ifood:${texto(merchantId)}`;
export const chave99Food = (id: string) => `99food:${texto(id)}`;
export const chaveLojaPropria = (franchiseeId: string) => `loja:${texto(franchiseeId)}`;

export type PedidoComOrigem = {
  franchiseeId?: string | null;
  ifoodStoreMerchant?: string | null;
  food99AppShopId?: string | null;
  food99ShopId?: string | null;
} & Record<string, unknown>;

/**
 * As chaves de loja deste pedido. Pedido de integração com loja identificada
 * leva SÓ a chave da integração — a chave da própria loja é para o que entra
 * pelos canais dela. Assim "esta impressora recebe só a Ragnar Pizza" não
 * puxa o pedido do site junto, e "só a própria loja" não puxa o do iFood.
 */
export function chavesDeLojaDoPedido(pedido: PedidoComOrigem | null | undefined): string[] {
  const chaves: string[] = [];
  const ifood = texto(pedido?.ifoodStoreMerchant);
  if (ifood) chaves.push(`ifood:${ifood}`);
  const app = texto(pedido?.food99AppShopId);
  if (app) chaves.push(`99food:${app}`);
  const shop = texto(pedido?.food99ShopId);
  if (shop && shop !== app) chaves.push(`99food:${shop}`);
  if (chaves.length === 0) {
    const propria = texto(pedido?.franchiseeId);
    if (propria) chaves.push(`loja:${propria}`);
  }
  return chaves;
}

/**
 * Esta impressora recebe pedido desta loja?
 *
 * Lista vazia ou ausente = recebe de todas, que é como toda impressora
 * configurada antes desta opção continua funcionando. Pedido SEM identidade
 * nenhuma (payload antigo, sem franchiseeId) também passa: filtro que não
 * consegue decidir não esconde comanda.
 */
export function impressoraAtendeLoja(
  impressora: { lojas?: string[] | null } | null | undefined,
  pedido: PedidoComOrigem | null | undefined
): boolean {
  const lojas = (impressora?.lojas || []).map(texto).filter(Boolean);
  if (lojas.length === 0) return true;
  const chaves = chavesDeLojaDoPedido(pedido);
  if (chaves.length === 0) return true;
  return chaves.some((c) => lojas.includes(c));
}

/**
 * Das impressoras candidatas, as que atendem a loja deste pedido — e TODAS
 * quando nenhuma atende. Mesma regra do módulo e da categoria: comanda que não
 * sai é prejuízo, comanda a mais é papel.
 */
export function impressorasDaLoja<T extends { lojas?: string[] | null }>(
  impressoras: T[],
  pedido: PedidoComOrigem | null | undefined
): T[] {
  const daLoja = impressoras.filter((i) => impressoraAtendeLoja(i, pedido));
  return daLoja.length > 0 ? daLoja : impressoras;
}
