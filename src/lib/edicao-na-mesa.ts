/**
 * Editar uma RODADA já lançada numa mesa aberta: tirar item, mudar quantidade,
 * cancelar a rodada inteira.
 *
 * ── Por que mora aqui e não na rota ─────────────────────────────────────────
 *
 * Até 09/10/2026 isto vivia só em api/store/table-sessions/[id]/orders/[orderId],
 * chamada pela tela de Mesas (painel e link do garçom). O Victor pediu o lápis
 * de "Editar pedido" também no card de mesa do quadro de Pedidos — e dois
 * lugares editando a mesma rodada com contas diferentes é exatamente como a
 * conta da mesa passaria a divergir do que foi lançado (o motivo escrito em
 * `avaliarEdicao` para a mesa ficar BLOQUEADA ali). Então a regra é uma só, e
 * as duas rotas a chamam:
 *
 *   • api/store/table-sessions/[id]/orders/[orderId] — tela de Mesas;
 *   • api/store/orders/[id]/itens — o lápis do quadro, quando o pedido tem
 *     `tableSessionId` (depois de `avaliarEdicaoDaMesa` conferir a permissão).
 *
 * ── A regra ─────────────────────────────────────────────────────────────────
 *
 *   • Guardas: mesa da MINHA loja → conta ainda OPEN (fechada é estorno) →
 *     pedido DESTA conta → não cancelado → sem nota fiscal emitida.
 *     "Finalizado" com a mesa aberta passa de propósito
 *     ([[pedido-de-mesa-so-fecha-com-a-mesa]]): recusar prendia a mesa.
 *   • O total da rodada é REFEITO dos itens (`recalcularTotal`: itens −
 *     desconto + taxa). Rodada lançada na mesa não tem desconto nem taxa, e dá
 *     a soma dos itens como sempre deu; o delivery que virou mesa
 *     (lib/troca-de-tipo.ts) guarda o desconto que tinha, e a soma pura o
 *     apagaria. A conta da mesa soma o `totalAmount` das rodadas
 *     (lib/conta-da-mesa.ts, rota `close`), então acompanha sozinha.
 *   • Sobrou zero item = rodada cancelada, com o estoque devolvido pelas
 *     baixas registradas. Edição PARCIAL não mexe no estoque (a devolução
 *     registrada é por pedido — está avisado nas duas telas).
 *   • Garçom sem "pode remover item" só aumenta quantidade.
 *   • Toda edição entra no `editHistory` (lib/historico-do-pedido.ts lê), com
 *     quem e o total antes e depois — a tela de Mesas não gravava rastro.
 *   • Tirar item, diminuir quantidade e cancelar pedem o MOTIVO
 *     (lib/motivo-do-cancelamento.ts) — sem ele, 400. O que saiu vai para o
 *     rastro em `itensRetirados`, com o motivo: é dali que o fechamento do
 *     caixa lista "Itens cancelados". Aumentar quantidade não pede nada.
 *   • Status do pedido NÃO muda aqui (só no cancelamento): quem dá a rodada
 *     por ENTREGUE é o fechamento da mesa.
 */
import { prisma } from "@/lib/prisma";
import { STATUS_CANCELADOS } from "@/lib/status-pedido";
import { conferirEstoque } from "@/lib/estoque-restante";
import { empilharEdicao, recalcularTotal, type RegistroDeEdicao } from "@/lib/edicao-de-pedido";
import { motivoDoCorpo, MENSAGEM_SEM_MOTIVO_DO_SERVIDOR, type ItemRetirado } from "@/lib/motivo-do-cancelamento";

/** O que as rotas devolvem: o status HTTP e o corpo, para `NextResponse.json`. */
export type RespostaDaMesa = { status: number; corpo: Record<string, unknown> };

export type ItemDaRodada = {
  id: string;
  quantity: number;
  price: number;
  productName?: string | null;
  menuProductId?: string | null;
};

export type RodadaDaMesa = {
  id: string;
  totalAmount: number | null;
  deliveryFee: number | null;
  discountTotal: number | null;
  editHistory: unknown;
  items: ItemDaRodada[];
};

export type PedidoDeEdicaoNaMesa = {
  itens?: unknown;
  removerItemIds?: unknown;
  /** Obrigatório quando algo sai da conta (tirar item, diminuir, cancelar). */
  motivo?: unknown;
};

export type PlanoDaEdicao =
  | { ok: false; status: number; error: string }
  | {
      ok: true;
      remover: string[];
      mudar: { itemId: string; quantity: number }[];
      /** Sobrou zero item: a operação vira cancelamento da rodada. */
      cancela: boolean;
      novoTotal: number;
      /** Só o AUMENTO de quantidade é conferido no estoque. */
      aumentos: { menuProductId: string; quantity: number }[];
      acao: "REMOVEU" | "MUDOU_QTD";
      descricao: string;
      /** O que sai da conta (removido ou diminuído) — pede motivo. */
      retirados: ItemRetirado[];
    };

const centavos = (n: number) => Math.round(n * 100) / 100;

const nomeDoItem = (i: Pick<ItemDaRodada, "productName">) => String(i.productName || "item").trim() || "item";

function itemRetirado(i: ItemDaRodada, quantidade: number): ItemRetirado {
  return { nome: nomeDoItem(i), quantidade, valor: centavos(Number(i.price || 0) * quantidade) };
}

const semMotivo = (): RespostaDaMesa => ({
  status: 400,
  corpo: { error: MENSAGEM_SEM_MOTIVO_DO_SERVIDOR, precisaDeMotivo: true },
});

/**
 * A edição inteira, sem banco: o que sai, o que muda, o total novo e o texto
 * do rastro. Função pura para scripts/teste-edicao-na-mesa.ts conferir.
 */
export function planejarEdicaoNaMesa(
  rodada: Pick<RodadaDaMesa, "items" | "deliveryFee" | "discountTotal">,
  pedido: PedidoDeEdicaoNaMesa,
  podeRemoverItem: boolean
): PlanoDaEdicao {
  const itensDoCorpo: { itemId: string; quantity: number }[] = Array.isArray(pedido?.itens) ? (pedido.itens as any[]) : [];
  const removerDoCorpo: string[] = Array.isArray(pedido?.removerItemIds) ? (pedido.removerItemIds as any[]).map(String) : [];
  if (itensDoCorpo.length === 0 && removerDoCorpo.length === 0) {
    return { ok: false, status: 400, error: "Nada para alterar" };
  }

  // Só itens DESTA rodada — id de item de outro pedido no corpo não alcança nada.
  const porId = new Map(rodada.items.map((i) => [i.id, i]));
  const remover = [...new Set(removerDoCorpo.filter((rid) => porId.has(rid)))];
  const mudar = itensDoCorpo
    .filter((m) => m && porId.has(String(m.itemId)) && !remover.includes(String(m.itemId)))
    .map((m) => ({ itemId: String(m.itemId), quantity: Math.floor(Number(m.quantity)) }))
    .filter((m) => Number.isFinite(m.quantity) && m.quantity >= 1 && m.quantity <= 99)
    // A mesma quantidade não é mudança — e escreveria "2x → 2x" no rastro.
    .filter((m) => m.quantity !== porId.get(m.itemId)!.quantity);

  if (remover.length === 0 && mudar.length === 0) {
    return { ok: false, status: 400, error: "Nenhum item válido para alterar" };
  }

  // Garçom sem "pode remover item" (cadastro): só acrescenta. Remover item
  // ou diminuir quantidade é tirar dinheiro da conta — trabalho do caixa.
  if (!podeRemoverItem) {
    const diminui = mudar.some((m) => m.quantity < porId.get(m.itemId)!.quantity);
    if (remover.length > 0 || diminui) {
      return { ok: false, status: 403, error: "Este garçom não remove item lançado. Peça ao caixa para ajustar pelo painel." };
    }
  }

  const finais = rodada.items
    .filter((i) => !remover.includes(i.id))
    .map((i) => ({ ...i, quantity: mudar.find((m) => m.itemId === i.id)?.quantity ?? i.quantity }));

  const aumentos = mudar
    .map((m) => ({ i: porId.get(m.itemId)!, m }))
    .filter(({ i, m }) => i.menuProductId && m.quantity > i.quantity)
    .map(({ i, m }) => ({ menuProductId: i.menuProductId as string, quantity: m.quantity - i.quantity }));

  const nome = (id: string) => porId.get(id)?.productName || "item";
  const descricao = [
    ...remover.map((rid) => `−${nome(rid)}`),
    ...mudar.map((m) => `${nome(m.itemId)} ${porId.get(m.itemId)!.quantity}x → ${m.quantity}x`),
  ].join(", ");

  return {
    ok: true,
    remover,
    mudar,
    cancela: finais.length === 0,
    novoTotal:
      finais.length === 0
        ? 0
        : recalcularTotal({
            itens: finais.map((i) => ({ price: Number(i.price) || 0, quantity: i.quantity })),
            deliveryFee: rodada.deliveryFee,
            discountTotal: rodada.discountTotal,
          }),
    aumentos,
    acao: remover.length > 0 ? "REMOVEU" : "MUDOU_QTD",
    descricao,
    retirados: [
      ...remover.map((rid) => itemRetirado(porId.get(rid)!, porId.get(rid)!.quantity)),
      ...mudar
        .filter((m) => m.quantity < porId.get(m.itemId)!.quantity)
        .map((m) => itemRetirado(porId.get(m.itemId)!, porId.get(m.itemId)!.quantity - m.quantity)),
    ],
  };
}

/**
 * A rodada, se ela pode ser editada agora. `sessionId` ausente = a conta é a
 * do próprio pedido (o lápis do quadro só sabe o pedido).
 */
export async function carregarRodadaDaMesa(
  lojaId: string,
  orderId: string,
  sessionId?: string | null
): Promise<{ erro: RespostaDaMesa } | { rodada: RodadaDaMesa; mesa: number | null }> {
  const order = await prisma.customerOrder.findFirst({
    where: { id: orderId, franchiseeId: lojaId, ...(sessionId ? { tableSessionId: sessionId } : {}) },
    select: {
      id: true,
      status: true,
      fiscalStatus: true,
      totalAmount: true,
      deliveryFee: true,
      discountTotal: true,
      editHistory: true,
      tableSessionId: true,
      items: { select: { id: true, quantity: true, price: true, productName: true, menuProductId: true } },
    },
  });
  if (!order || !order.tableSessionId) {
    return { erro: { status: 404, corpo: { error: "Pedido não encontrado nesta mesa" } } };
  }

  const tableSession = await prisma.tableSession.findUnique({
    where: { id: order.tableSessionId },
    select: { id: true, status: true, franchiseeId: true, table: { select: { number: true } } },
  });
  if (!tableSession || tableSession.franchiseeId !== lojaId) {
    return { erro: { status: 404, corpo: { error: "Mesa não encontrada" } } };
  }
  if (tableSession.status !== "OPEN") {
    return {
      erro: {
        status: 409,
        corpo: { error: "Esta mesa já foi fechada — a conta virou pagamento. Ajustes agora são estorno, fale com o caixa." },
      },
    };
  }
  if ((STATUS_CANCELADOS as readonly string[]).includes(order.status)) {
    return { erro: { status: 409, corpo: { error: "Este pedido já foi cancelado" } } };
  }
  // ── "FINALIZADO" COM A MESA ABERTA NÃO É CONTA FECHADA ─────────────────
  //
  // Pedido de mesa só se encerra de verdade quando a MESA fecha: é ali que o
  // dinheiro entra e que os pedidos viram ENTREGUE. Um pedido finalizado com
  // a mesa ainda aberta foi finalizado por fora — o fechamento do caixa o
  // levava junto com os "na rua", o quadro de Pedidos o conclui — e ninguém
  // pagou nada ainda. Recusar aqui prendia a mesa para sempre: Hakim Centro,
  // mesa 4, 459 h aberta com "Este pedido já foi finalizado" a cada tentativa
  // de cancelar. A guarda que vale é a de cima (mesa fechada = estorno).
  //
  // O que continua barrado é nota fiscal já emitida: aí cancelar é na tela
  // Fiscal, senão a nota fica valendo para um pedido que deixou de existir.
  if (order.fiscalStatus === "EMITTED") {
    return {
      erro: {
        status: 409,
        corpo: { error: "Este pedido já tem nota fiscal emitida — cancele a nota na tela Fiscal antes de mexer nele." },
      },
    };
  }

  const numero = Number(tableSession.table?.number);
  return {
    rodada: {
      id: order.id,
      totalAmount: order.totalAmount,
      deliveryFee: order.deliveryFee,
      discountTotal: order.discountTotal,
      editHistory: order.editHistory,
      items: order.items,
    },
    mesa: Number.isFinite(numero) ? numero : null,
  };
}

/** Tira item e/ou muda quantidade. Sobrou zero item = cancela a rodada. */
export async function editarRodadaDaMesa(entrada: {
  lojaId: string;
  rodada: RodadaDaMesa;
  pedido: PedidoDeEdicaoNaMesa;
  quem: string;
  podeRemoverItem: boolean;
}): Promise<RespostaDaMesa> {
  const { lojaId, rodada, quem } = entrada;
  const plano = planejarEdicaoNaMesa(rodada, entrada.pedido, entrada.podeRemoverItem);
  if (!plano.ok) return { status: plano.status, corpo: { error: plano.error } };
  const motivo = motivoDoCorpo({ motivo: entrada.pedido?.motivo });

  // Removeu tudo = cancelou a rodada. Mesma via do DELETE, com devolução de
  // estoque — um pedido sem itens não pode continuar valendo dinheiro.
  if (plano.cancela) return cancelarRodadaDaMesa({ rodada, quem, motivo });

  // Tirar dinheiro da mesa sem motivo não passa.
  if (plano.retirados.length > 0 && !motivo) return semMotivo();

  // Estoque disponível: aumentar a quantidade é vender mais. O que o item já
  // tinha já está contado como vendido.
  if (plano.aumentos.length > 0) {
    const estoque = await conferirEstoque(lojaId, plano.aumentos);
    if (!estoque.ok) return { status: 409, corpo: { error: estoque.mensagem } };
  }

  const registro: RegistroDeEdicao = {
    quando: new Date().toISOString(),
    quem,
    acao: plano.acao,
    descricao: plano.descricao,
    totalAntes: rodada.totalAmount || 0,
    totalDepois: plano.novoTotal,
    ...(motivo ? { motivo } : {}),
    ...(plano.retirados.length > 0 ? { itensRetirados: plano.retirados } : {}),
  };

  await prisma.$transaction(async (tx) => {
    for (const rid of plano.remover) {
      await tx.customerOrderItem.delete({ where: { id: rid } });
    }
    for (const m of plano.mudar) {
      await tx.customerOrderItem.update({ where: { id: m.itemId }, data: { quantity: m.quantity } });
    }
    await tx.customerOrder.update({
      where: { id: rodada.id },
      data: {
        totalAmount: plano.novoTotal,
        editHistory: empilharEdicao(rodada.editHistory, registro) as any,
      },
    });
  });

  console.log(
    `[Mesa Editar] pedido ${rodada.id}: ${plano.descricao}, total ${rodada.totalAmount} → ${plano.novoTotal}, por ${quem}`
  );
  return { status: 200, corpo: { success: true, totalAmount: plano.novoTotal, registro } };
}

/** Cancela a rodada inteira e devolve o estoque baixado no lançamento. */
export async function cancelarRodadaDaMesa(entrada: { rodada: RodadaDaMesa; quem: string; motivo: string }): Promise<RespostaDaMesa> {
  const { rodada, quem, motivo } = entrada;
  if (!motivo) return semMotivo();
  const registro: RegistroDeEdicao = {
    quando: new Date().toISOString(),
    quem,
    acao: "CANCELOU",
    descricao: "Rodada da mesa cancelada (ficou sem itens ou foi cancelada na mão)",
    totalAntes: rodada.totalAmount || 0,
    totalDepois: 0,
    motivo,
    itensRetirados: rodada.items.map((i) => itemRetirado(i, i.quantity)),
  };

  // A grafia é CANCELADO — a que o resto do sistema grava e filtra. O motivo
  // é o que a pessoa escreveu: é ele que sai no fechamento do caixa.
  await prisma.customerOrder.update({
    where: { id: rodada.id },
    data: {
      status: "CANCELADO",
      cancelledBy: "LOJA",
      cancelReason: motivo,
      editHistory: empilharEdicao(rodada.editHistory, registro) as any,
    },
  });

  // O estoque do lançamento cancelado (devolver o insumo, ou desperdício se a
  // cozinha já tinha feito) é da extensão do Prisma em lib/prisma.ts, pelas
  // BAIXAS registradas do pedido — nunca pela ficha técnica de hoje.

  console.log(`[Mesa Editar] pedido ${rodada.id} cancelado por ${quem}`);
  return { status: 200, corpo: { success: true, cancelado: true } };
}
