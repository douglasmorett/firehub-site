/**
 * O estoque disponível lido do banco. A conta e o porquê do desenho estão em
 * src/lib/estoque-do-cardapio.ts.
 *
 * Loja sem nenhum produto com controle — quase todas — paga UMA consulta
 * pequena (produtos com `estoqueQtd` preenchido) e nenhuma nos pedidos.
 */
import { prisma } from "./prisma";
import {
  STATUS_QUE_NAO_CONTAM,
  calcularEstoque,
  controlaEstoque,
  esgotado,
  faltasDoPedido,
  mensagemDasFaltas,
  somarPorProduto,
  type EstoqueDaLoja,
  type FaltaDeEstoque,
  type ProdutoComEstoque,
} from "./estoque-do-cardapio";

async function produtosControlados(franchiseeId: string, ids?: string[]): Promise<ProdutoComEstoque[]> {
  const lista = await prisma.menuProduct.findMany({
    where: {
      franchiseeId,
      estoqueQtd: { not: null },
      ...(ids ? { id: { in: ids } } : {}),
    },
    select: { id: true, name: true, estoqueQtd: true, estoqueDesde: true, estoquePausar: true },
  });
  return lista.filter(controlaEstoque);
}

/**
 * O estoque de cada produto controlado da loja. Produto fora do mapa não tem
 * limite. Passar `produtos` evita reler o cadastro quando quem chama já o tem.
 */
export async function estoqueDaLoja(franchiseeId: string, produtos?: ProdutoComEstoque[]): Promise<EstoqueDaLoja> {
  const controlados = (produtos ?? (await produtosControlados(franchiseeId))).filter(controlaEstoque);
  if (controlados.length === 0) return new Map();

  // Um corte só para a consulta: o mais antigo `estoqueDesde`. Cada produto
  // descarta depois, na conta, o que vendeu antes da SUA reposição.
  const desde = new Date(
    Math.min(...controlados.map((p) => (p.estoqueDesde ? new Date(p.estoqueDesde).getTime() : 0)))
  );

  const itens = await prisma.customerOrderItem.findMany({
    where: {
      menuProductId: { in: controlados.map((p) => p.id) },
      order: {
        franchiseeId,
        createdAt: { gte: desde },
        status: { notIn: [...STATUS_QUE_NAO_CONTAM] },
      },
    },
    select: { menuProductId: true, quantity: true, order: { select: { createdAt: true } } },
  });

  return calcularEstoque(
    controlados,
    itens.map((i) => ({ menuProductId: i.menuProductId, quantity: i.quantity, criadoEm: i.order.createdAt }))
  );
}

/** A mesma leitura, sem nunca derrubar a tela que a pediu. */
export async function estoqueDaLojaOuVazio(franchiseeId: string | null | undefined): Promise<EstoqueDaLoja> {
  if (!franchiseeId) return new Map();
  try {
    return await estoqueDaLoja(franchiseeId);
  } catch (e: any) {
    console.error(`[Estoque do cardápio] leitura falhou na loja ${franchiseeId}: ${e?.message}`);
    return new Map();
  }
}

/**
 * Tira do cardápio de venda o que pausou por estoque e anota o restante no que
 * ficou (`estoqueRestante`), para a tela não deixar pedir mais do que há.
 */
export function aplicarEstoqueNaVitrine<T extends { id: string }>(produtos: T[], estoque: EstoqueDaLoja): T[] {
  if (estoque.size === 0) return produtos;
  return produtos
    .filter((p) => !esgotado(p.id, estoque))
    .map((p) => {
      const e = estoque.get(p.id);
      return e && e.pausaAoZerar ? { ...p, estoqueRestante: e.restam } : p;
    });
}

/**
 * Para as telas que decidem sozinhas o que mostrar (balcão, mesa, garçom,
 * cadastro): o produto controlado leva `estoqueRestante`, `estoquePausaAoZerar`
 * e a marca `esgotado` (zerou e a loja pediu para pausar).
 */
export function comEstoqueAnotado<T extends { id: string }>(p: T, estoque: EstoqueDaLoja): T {
  const e = estoque.get(p.id);
  if (!e) return p;
  return { ...p, estoqueRestante: e.restam, estoquePausaAoZerar: e.pausaAoZerar, esgotado: esgotado(p.id, estoque) };
}

export type ResultadoDaConferencia =
  | { ok: true }
  | { ok: false; faltas: FaltaDeEstoque[]; mensagem: string };

/**
 * O pedido cabe no estoque? Chamado pelos canais PRÓPRIOS (site, totem, mesa,
 * balcão, robô) antes de gravar. Marketplace não passa por aqui: o pedido do
 * iFood já foi pago lá e não dá para recusar — ele só conta na venda.
 *
 * Não reserva nada. Duas compras da última unidade no mesmo instante passam as
 * duas; o restante fica em zero e o produto fecha. É a troca por não precisar
 * de devolução em cada caminho de cancelamento.
 */
export async function conferirEstoque(
  franchiseeId: string,
  itens: { menuProductId?: string | null; quantity?: number | null }[]
): Promise<ResultadoDaConferencia> {
  const pedido = somarPorProduto(itens);
  if (pedido.size === 0) return { ok: true };

  const controlados = await produtosControlados(franchiseeId, [...pedido.keys()]);
  if (controlados.length === 0) return { ok: true };

  const estoque = await estoqueDaLoja(franchiseeId, controlados);
  const nomes = new Map(controlados.map((p) => [p.id, String(p.name || "Um item")]));
  const faltas = faltasDoPedido(pedido, estoque, nomes);
  return faltas.length === 0 ? { ok: true } : { ok: false, faltas, mensagem: mensagemDasFaltas(faltas) };
}
