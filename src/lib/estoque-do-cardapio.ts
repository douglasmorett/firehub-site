/**
 * ESTOQUE DISPONÍVEL DO PRODUTO — o "acabou, fecha" do iFood.
 *
 * Ao lado de cada item do cardápio a loja informa quanto tem ("12 costelas") e
 * responde: "zerou o estoque, pausar o item? Sim / Não".
 *
 *   • Sim (o padrão): chegou a zero, o item PAUSA SOZINHO em todos os canais —
 *     some do site, do totem, do balcão, da mesa e do robô — e os canais
 *     próprios recusam pedir mais do que resta. Repôs, volta.
 *   • Não: o número continua abatendo a cada venda, só como controle, e o item
 *     segue à venda.
 *
 * Não confundir com o Estoque de insumos (src/lib/stock.ts, ficha técnica):
 * aquele baixa quilo de carne; este conta PORÇÕES À VENDA de um item.
 *
 * ── O RESTANTE NÃO É GRAVADO ────────────────────────────────────────────────
 *
 * O banco guarda só o que a loja informou (`estoqueQtd`) e quando
 * (`estoqueDesde`). O que resta é CALCULADO:
 *
 *     restante = estoqueQtd − Σ quantidade dos itens desse produto em pedidos
 *                criados desde `estoqueDesde` que não foram cancelados
 *
 * Um contador que se decrementa precisaria de uma devolução em cada caminho
 * que cancela pedido — painel, marketplace, pagamento expirado, robô, mesa,
 * disputa, emergência: são mais de dez, e cada um esquecido vira estoque que
 * some para sempre. Calculado, o cancelamento devolve sozinho, a edição de
 * pedido se ajusta sozinha e a venda do iFood, da 99, do balcão e da mesa conta
 * igual, sem ninguém lembrar de chamar nada. Pelo mesmo motivo a "pausa" não
 * mexe em `active`: é o restante em zero que fecha o item, e é a reposição que
 * o reabre — o `active` continua sendo só a pausa que a loja fez na mão.
 *
 * Este arquivo é só a conta, sem banco — é o que o teste exercita
 * (scripts/teste-estoque-do-cardapio.mjs). A consulta mora em
 * src/lib/estoque-restante.ts.
 */

/** Pedido nestes status não levou o produto. O rascunho do robô ainda não é
 *  pedido: é reescrito a cada mensagem e só vira venda quando confirmado. */
export const STATUS_QUE_NAO_CONTAM = ["CANCELADO", "CANCELLED", "CANCELED", "CRIANDO_IA"] as const;

export type ProdutoComEstoque = {
  id: string;
  name?: string | null;
  estoqueQtd?: number | null;
  estoqueDesde?: Date | string | null;
  /** "Zerou, pausar?" — nulo conta como SIM. */
  estoquePausar?: boolean | null;
};

export type VendaDoProduto = {
  menuProductId: string | null;
  quantity: number;
  /** Quando o PEDIDO foi criado. */
  criadoEm: Date | string;
};

export type EstoqueDoProduto = {
  /** Quanto resta. Nunca negativo: vender além do estoque deixa em zero. */
  restam: number;
  /** Zerou, pausa o item? */
  pausaAoZerar: boolean;
};

/** O estado do estoque de cada produto CONTROLADO. Fora do mapa = sem controle. */
export type EstoqueDaLoja = Map<string, EstoqueDoProduto>;

/** O produto tem controle de estoque ligado? Nulo = não controla. */
export function controlaEstoque(p: Pick<ProdutoComEstoque, "estoqueQtd"> | null | undefined): boolean {
  const q = p?.estoqueQtd;
  return typeof q === "number" && Number.isFinite(q) && q >= 0;
}

/**
 * Quanto resta de cada produto controlado.
 *
 * Venda maior que o estoque (duas compras da última unidade no mesmo segundo,
 * pedido do iFood, que não dá para recusar, ou item que segue à venda porque a
 * loja respondeu "não pausar") não deixa o número negativo: "−1 disponível" não
 * significa nada para o lojista.
 */
export function calcularEstoque(produtos: ProdutoComEstoque[], vendas: VendaDoProduto[]): EstoqueDaLoja {
  const estoque: EstoqueDaLoja = new Map();
  const desde = new Map<string, number>();
  for (const p of produtos) {
    if (!controlaEstoque(p)) continue;
    estoque.set(p.id, { restam: Math.floor(p.estoqueQtd as number), pausaAoZerar: p.estoquePausar !== false });
    desde.set(p.id, p.estoqueDesde ? new Date(p.estoqueDesde).getTime() : 0);
  }
  for (const v of vendas) {
    const e = v.menuProductId ? estoque.get(v.menuProductId) : undefined;
    if (!e) continue;
    // Venda de ANTES da última reposição já estava descontada no número que a
    // loja informou ao repor.
    if (new Date(v.criadoEm).getTime() < (desde.get(v.menuProductId as string) as number)) continue;
    e.restam -= Math.max(0, Math.floor(Number(v.quantity) || 0));
  }
  for (const e of estoque.values()) if (e.restam < 0) e.restam = 0;
  return estoque;
}

/** Zerou e a loja pediu para pausar: o item está fechado. */
export function esgotado(id: string, estoque: EstoqueDaLoja): boolean {
  const e = estoque.get(id);
  return !!e && e.pausaAoZerar && e.restam <= 0;
}

/**
 * Quanto o pedido quer de cada produto. O mesmo produto aparece em várias
 * linhas do carrinho (um X-Bacon sem cebola, outro com cheddar) e o estoque é
 * um só: conferir linha por linha deixaria passar 2 + 2 com 3 na prateleira.
 */
export function somarPorProduto(
  itens: { menuProductId?: string | null; quantity?: number | null }[]
): Map<string, number> {
  const total = new Map<string, number>();
  for (const i of itens || []) {
    if (!i?.menuProductId) continue;
    const q = Math.max(0, Math.floor(Number(i.quantity) || 0));
    if (q === 0) continue;
    total.set(i.menuProductId, (total.get(i.menuProductId) || 0) + q);
  }
  return total;
}

export type FaltaDeEstoque = {
  menuProductId: string;
  nome: string;
  pedido: number;
  restam: number;
};

/**
 * Os produtos em que o pedido quer mais do que resta. Vazio = pode seguir.
 * Produto com "não pausar" nunca falta: a loja escolheu continuar vendendo.
 */
export function faltasDoPedido(
  pedido: Map<string, number>,
  estoque: EstoqueDaLoja,
  nomes: Map<string, string> = new Map()
): FaltaDeEstoque[] {
  const faltas: FaltaDeEstoque[] = [];
  for (const [id, qtd] of pedido) {
    const e = estoque.get(id);
    if (!e || !e.pausaAoZerar) continue;
    if (qtd > e.restam) faltas.push({ menuProductId: id, nome: nomes.get(id) || "Um item", pedido: qtd, restam: e.restam });
  }
  return faltas;
}

/** A frase para o cliente (ou para o operador) — uma por produto. */
export function mensagemDasFaltas(faltas: FaltaDeEstoque[]): string {
  return faltas
    .map((f) =>
      f.restam <= 0
        ? `${f.nome} esgotou.`
        : `Só ${f.restam === 1 ? "resta 1" : `restam ${f.restam}`} de ${f.nome} (você pediu ${f.pedido}).`
    )
    .join(" ");
}
