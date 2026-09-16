/**
 * Editar um pedido de delivery/balcão JÁ LANÇADO — o cliente ligou.
 *
 * PATCH  { itens: [{ itemId, quantity }], removerItemIds: [...] }
 *          → muda quantidade e/ou remove itens do PRÓPRIO pedido. O total é
 *            recalculado do que sobrou (nunca digitado à mão), pela conta de
 *            lib/edicao-de-pedido.ts — que preserva taxa de entrega e desconto,
 *            ao contrário da conta da mesa. Sobrou zero item = pedido cancelado
 *            e estoque devolvido.
 *
 *        { acrescentar: [{ menuProductId, quantity, notes }], pagamento }
 *          → acrescenta item. Em pedido próprio o item entra no MESMO pedido e
 *            o total sobe. Em pedido de marketplace nasce um pedido COLADO
 *            (`parentOrderId`), com a forma de pagamento que o cliente vai usar
 *            para pagar essa parte — ver o porquê logo abaixo.
 *
 * DELETE → cancela o pedido inteiro e devolve o estoque baixado.
 *
 * ── Por que o acréscimo do marketplace não entra no pedido ──────────────────
 *
 * Duas razões, e as duas doem:
 *
 *   1. O pedido do iFood tem que continuar valendo o que o iFood vai depositar.
 *      Inflar `totalAmount` com um item que o iFood não cobrou faz o relatório
 *      de faturamento divergir do extrato do parceiro, todo dia, para sempre.
 *
 *   2. O CAIXA. Gravar as duas partes no mesmo pedido exigiria `paymentMethods`
 *      com um rótulo tipo "iFood (Pago Online)" — e a régua de
 *      api/cash-session/route.ts:77 testa `m.includes("food")` para vale-
 *      refeição ANTES de qualquer coisa. "iFood" contém "food": o repasse do
 *      iFood inteiro cairia na linha de VOUCHER, e a gaveta fecharia com sobra
 *      fantasma. É a mesma classe de estrago que o comentário daquele arquivo
 *      documenta em R$ 43.245,98 de esperado somado errado em 45 dias.
 *
 * Como pedido próprio separado, o acréscimo passa pela conferência de caixa que
 * já existe e funciona, e o pedido do parceiro fica intocado.
 *
 * Guardas, nesta ordem: sessão → permissão → pedido DESTA loja → o que
 * `avaliarEdicao` decidir (status e canal). A permissão e a decisão de modo
 * vivem em lib/edicao-de-pedido.ts, a MESMA função que a tela consulta para
 * desenhar o botão: tela e servidor divergirem aqui é botão que existe e não
 * funciona, ou escrita que a tela não deixaria passar.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateDailyOrderNumber } from "@/lib/order-number";
import { precoDoCanal, type CanalDePreco } from "@/lib/preco-por-canal";
import {
  avaliarEdicao,
  recalcularTotal,
  empilharEdicao,
  type RegistroDeEdicao,
} from "@/lib/edicao-de-pedido";

/** Os campos do pedido que a decisão e o recálculo precisam. */
const CAMPOS_DO_PEDIDO = {
  id: true,
  franchiseeId: true,
  status: true,
  source: true,
  totalAmount: true,
  deliveryFee: true,
  discountTotal: true,
  tableSessionId: true,
  ifoodOrderId: true,
  ifoodReference: true,
  openDeliveryOrderId: true,
  openDeliveryChannel: true,
  openDeliveryReference: true,
  dailyOrderNumber: true,
  customerName: true,
  customerPhone: true,
  customerAddress: true,
  deliveryType: true,
  editHistory: true,
  items: { select: { id: true, quantity: true, price: true, productName: true, menuProductId: true } },
} as const;

async function contexto(params: Promise<{ id: string }>) {
  const session = await getServerSession(authOptions).catch(() => null);
  if (!session?.user?.email) {
    return { erro: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) };
  }

  const operador = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, name: true, email: true, role: true, permissions: true, ownerId: true },
  });
  if (!operador) return { erro: NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 }) };

  const lojaId = operador.ownerId || operador.id;
  const { id } = await params;

  const order = await prisma.customerOrder.findFirst({
    where: { id, franchiseeId: lojaId },
    select: CAMPOS_DO_PEDIDO,
  });
  if (!order) return { erro: NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 }) };

  const avaliacao = avaliarEdicao(order as any, operador);
  if (avaliacao.modo === "BLOQUEADO") {
    // 403 e não 400: o pedido existe, a escrita é que não é permitida. A tela
    // mostra `error` direto para o lojista, então ele já vem escrito para ele.
    return { erro: NextResponse.json({ error: avaliacao.motivo }, { status: 403 }) };
  }

  return { lojaId, order, operador, avaliacao };
}

/** Quem aparece no rastro. O e-mail é o que identifica sem ambiguidade. */
function nomeDoOperador(op: { name?: string | null; email?: string | null; role?: string | null }) {
  const papel = (op.role || "").toUpperCase() === "STAFF" ? "funcionário" : "dono";
  return `${op.name || op.email || "?"} (${papel})`;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await contexto(params);
    if ("erro" in ctx) return ctx.erro;
    const { order, operador, avaliacao, lojaId } = ctx;

    const body = await req.json().catch(() => ({}) as any);
    const acrescentar: { menuProductId: string; quantity: number; notes?: string }[] =
      Array.isArray(body?.acrescentar) ? body.acrescentar : [];
    const itens: { itemId: string; quantity: number }[] = Array.isArray(body?.itens) ? body.itens : [];
    const removerItemIds: string[] = Array.isArray(body?.removerItemIds)
      ? body.removerItemIds.map(String)
      : [];

    const querMexerNosOriginais = itens.length > 0 || removerItemIds.length > 0;

    if (!querMexerNosOriginais && acrescentar.length === 0) {
      return NextResponse.json({ error: "Nada para alterar" }, { status: 400 });
    }

    // A trava do marketplace mora aqui, não só na tela: tirar item de pedido do
    // parceiro é o que faria o valor divergir do repasse.
    if (avaliacao.modo === "SO_ACRESCIMO" && querMexerNosOriginais) {
      return NextResponse.json({ error: avaliacao.motivo }, { status: 403 });
    }

    // Pedido de marketplace: o acréscimo vira pedido colado, sozinho.
    if (avaliacao.modo === "SO_ACRESCIMO") {
      return await acrescentarColado({
        order,
        lojaId,
        operador,
        acrescentar,
        pagamento: String(body?.pagamento || "").trim(),
      });
    }

    // Pedido próprio: tirar, mudar quantidade e acrescentar são UMA operação só.
    //
    // Antes isto era um if/else — acréscimo OU remoção — e a remoção enviada
    // junto era descartada em silêncio. O atendente que tirasse a Coca e
    // acrescentasse um pastel na mesma edição via a tela prever um total e o
    // pedido fechar noutro, com a Coca ainda lá. Uma transação só também deixa o
    // total ser recalculado uma vez, do estado final.
    return await editarPedidoProprio({ order, lojaId, operador, itens, removerItemIds, acrescentar });
  } catch (error: any) {
    console.error("[Editar Pedido PATCH]", error);
    return NextResponse.json({ error: "Erro ao editar o pedido" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await contexto(params);
    if ("erro" in ctx) return ctx.erro;
    // Cancelar um pedido de marketplace daqui avisaria o parceiro pela metade:
    // quem fala com o iFood/99/Brendi é a rota de status, com o código de
    // cancelamento que cada um exige. O botão de cancelar do painel continua
    // sendo o caminho.
    if (ctx.avaliacao.modo === "SO_ACRESCIMO") {
      return NextResponse.json(
        { error: "Para cancelar um pedido de marketplace, use o botão Cancelar do painel — ele avisa o parceiro." },
        { status: 403 }
      );
    }
    return await cancelarPedido(ctx.order, ctx.operador);
  } catch (error: any) {
    console.error("[Editar Pedido DELETE]", error);
    return NextResponse.json({ error: "Erro ao cancelar o pedido" }, { status: 500 });
  }
}

// ── Pedido próprio: tirar, mudar quantidade e acrescentar, tudo junto ───────

async function editarPedidoProprio(entrada: {
  order: any;
  lojaId: string;
  operador: any;
  itens: { itemId: string; quantity: number }[];
  removerItemIds: string[];
  acrescentar: { menuProductId: string; quantity: number; notes?: string }[];
}) {
  const { order, lojaId, operador } = entrada;

  // Só itens DESTE pedido: id de item de outro pedido no corpo não alcança nada.
  const idsDoPedido = new Set(order.items.map((i: any) => i.id));
  const remover = entrada.removerItemIds.filter((rid) => idsDoPedido.has(rid));
  const mudar = entrada.itens
    .filter((m) => m && idsDoPedido.has(String(m.itemId)) && !remover.includes(String(m.itemId)))
    .map((m) => ({ itemId: String(m.itemId), quantity: Math.floor(Number(m.quantity)) }))
    .filter((m) => Number.isFinite(m.quantity) && m.quantity >= 1 && m.quantity <= 99);

  let novosItens: ItemNovo[] = [];
  if (entrada.acrescentar.length > 0) {
    const montados = await montarItensNovos(entrada.acrescentar, lojaId, order.deliveryType);
    if ("erro" in montados) return montados.erro;
    novosItens = montados.itens;
  }

  if (remover.length === 0 && mudar.length === 0 && novosItens.length === 0) {
    return NextResponse.json({ error: "Nenhum item válido para alterar" }, { status: 400 });
  }

  // O estado final é calculado ANTES de escrever, porque "sobrou zero item"
  // muda a operação inteira: vira cancelamento.
  const sobraram = order.items
    .filter((i: any) => !remover.includes(i.id))
    .map((i: any) => ({ ...i, quantity: mudar.find((m) => m.itemId === i.id)?.quantity ?? i.quantity }));

  const finais = [
    ...sobraram.map((i: any) => ({ price: i.price, quantity: i.quantity })),
    ...novosItens.map((i) => ({ price: i.price, quantity: i.quantity })),
  ];

  if (finais.length === 0) {
    // Tirou tudo e não acrescentou nada: pedido sem item não pode continuar
    // valendo dinheiro. Mesma via do DELETE, com devolução de estoque.
    return cancelarPedido(order, operador);
  }

  const novoTotal = recalcularTotal({
    itens: finais,
    deliveryFee: order.deliveryFee,
    discountTotal: order.discountTotal,
  });

  const nomeDoItem = (id: string) => {
    const it = order.items.find((i: any) => i.id === id);
    return it?.productName || "item";
  };
  const descricao = [
    ...remover.map((rid) => `−${nomeDoItem(rid)}`),
    ...mudar.map((m) => {
      const antes = order.items.find((i: any) => i.id === m.itemId)?.quantity;
      return `${nomeDoItem(m.itemId)} ${antes}x → ${m.quantity}x`;
    }),
    ...novosItens.map((i) => `+${i.quantity}x ${i.productName}`),
  ].join(", ");

  const registro: RegistroDeEdicao = {
    quando: new Date().toISOString(),
    quem: nomeDoOperador(operador),
    acao:
      remover.length > 0
        ? "REMOVEU"
        : mudar.length > 0
          ? "MUDOU_QTD"
          : "ACRESCENTOU",
    descricao,
    totalAntes: order.totalAmount || 0,
    totalDepois: novoTotal,
  };

  await prisma.$transaction(async (tx) => {
    for (const rid of remover) {
      await tx.customerOrderItem.delete({ where: { id: rid } });
    }
    for (const m of mudar) {
      await tx.customerOrderItem.update({ where: { id: m.itemId }, data: { quantity: m.quantity } });
    }
    for (const i of novosItens) {
      await tx.customerOrderItem.create({ data: { ...i, orderId: order.id } });
    }
    await tx.customerOrder.update({
      where: { id: order.id },
      data: {
        totalAmount: novoTotal,
        editHistory: empilharEdicao(order.editHistory, registro) as any,
      },
    });
  });

  // ── ESTOQUE: DEVOLVE TUDO E BAIXA O QUE SOBROU ──────────────────────────
  //
  // O painel de MESAS não faz isso — lá, tirar item não devolve insumo, e a
  // tela avisa. O motivo escrito lá é que devolver "proporcional" recalcularia
  // pela ficha técnica de hoje. Mas o ciclo abaixo não é proporcional: a
  // devolução usa as BAIXAS REGISTRADAS do pedido (a fonte da verdade que
  // lib/stock.ts já usa no cancelamento) e a baixa seguinte roda inteira sobre
  // o que restou. É o mesmo caminho do pedido cancelado e reaceito, que a
  // função já suporta e documenta.
  //
  // Vale a pena porque o contrário é a reclamação óbvia: "tirei dois pastéis do
  // pedido e o estoque não voltou". Em SEQUÊNCIA, nunca em paralelo — invertida,
  // a devolução apagaria a baixa recém-feita e o insumo voltaria ao saldo sem
  // ter voltado para a prateleira.
  //
  // (A mesa segue com a regra antiga de propósito: mexer nela pede teste do
  // fluxo de conta e rateio, que é outro caminho. Ficou anotado para alinhar.)
  import("@/lib/stock")
    .then(async ({ restoreStockForOrder, deductStockForOrder }) => {
      await restoreStockForOrder(order.id);
      await deductStockForOrder(order.id);
    })
    .catch((e: any) =>
      console.error(
        `[Editar Pedido] rebaixa de estoque falhou ao editar o pedido ${order.id} — ` +
        `conferir o saldo dos insumos de ${descricao}:`,
        e?.message
      )
    );

  console.log(
    `[Editar Pedido] ${order.id}: ${remover.length} removido(s), ${mudar.length} qtd alterada(s), ` +
    `total ${order.totalAmount} → ${novoTotal}, por ${registro.quem}`
  );
  return NextResponse.json({ success: true, totalAmount: novoTotal, registro });
}

// ── Itens novos: preço do banco e isolamento entre lojas ────────────────────

type ItemNovo = {
  menuProductId: string;
  productName: string;
  quantity: number;
  price: number;
  notes: string | null;
};

/**
 * Transforma o que o navegador pediu em itens graváveis.
 *
 * O PREÇO VEM DO BANCO, nunca do corpo: aceitar preço do cliente seria deixar o
 * navegador dizer quanto custa. E só produto DESTA loja entra — é a mesma
 * guarda da venda de balcão, que existe porque um menuProductId de outra loja
 * fazia a baixa de estoque seguir a ficha técnica dela, drenando insumo alheio.
 */
async function montarItensNovos(
  brutos: { menuProductId: string; quantity: number; notes?: string }[],
  lojaId: string,
  deliveryType: string | null | undefined
): Promise<{ erro: NextResponse } | { itens: ItemNovo[] }> {
  const pedidos = brutos
    .map((a) => ({
      menuProductId: String(a?.menuProductId || ""),
      quantity: Math.floor(Number(a?.quantity)),
      notes: a?.notes ? String(a.notes).trim().slice(0, 200) : null,
    }))
    .filter((a) => a.menuProductId && Number.isFinite(a.quantity) && a.quantity >= 1 && a.quantity <= 99);

  if (pedidos.length === 0) {
    return { erro: NextResponse.json({ error: "Nenhum item válido para acrescentar" }, { status: 400 }) };
  }

  const produtos = await prisma.menuProduct.findMany({
    where: { id: { in: pedidos.map((p) => p.menuProductId) }, franchiseeId: lojaId },
    select: { id: true, name: true, price: true, priceDelivery: true, priceSalao: true, priceTotem: true },
  });
  const porId = new Map(produtos.map((p) => [p.id, p]));
  const invasores = pedidos.filter((p) => !porId.has(p.menuProductId));
  if (invasores.length > 0) {
    console.error(`[Editar Pedido] Produto de outra loja recusado na loja ${lojaId}:`, invasores.map((i) => i.menuProductId));
    return { erro: NextResponse.json({ error: "Um dos itens não pertence ao cardápio desta loja." }, { status: 400 }) };
  }

  // Preço por canal pela régua oficial (lib/preco-por-canal.ts), a mesma que o
  // cardápio, o carrinho e a comanda usam: um pastel de entrega custa mais que
  // o do balcão nas lojas que separam os preços, e reimplementar essa escolha
  // aqui seria o acréscimo sair por um valor que não existe em tela nenhuma.
  const canalDePreco: CanalDePreco =
    String(deliveryType || "").toUpperCase() === "DELIVERY" ? "delivery" : "salao";

  return {
    itens: pedidos.map((p) => {
      const prod = porId.get(p.menuProductId)!;
      return {
        menuProductId: prod.id,
        productName: prod.name,
        quantity: p.quantity,
        price: precoDoCanal(prod as any, canalDePreco),
        notes: p.notes,
      };
    }),
  };
}

// ── Marketplace: o acréscimo vira um pedido próprio colado no original ──────

async function acrescentarColado(entrada: {
  order: any;
  lojaId: string;
  operador: any;
  acrescentar: { menuProductId: string; quantity: number; notes?: string }[];
  pagamento: string;
}) {
  const { order, lojaId, operador, pagamento } = entrada;

  if (entrada.acrescentar.length === 0) {
    return NextResponse.json({ error: "Nenhum item para acrescentar" }, { status: 400 });
  }
  if (!pagamento) {
    return NextResponse.json(
      { error: "Escolha como o cliente vai pagar o acréscimo — esse valor não vem do marketplace." },
      { status: 400 }
    );
  }

  const montados = await montarItensNovos(entrada.acrescentar, lojaId, order.deliveryType);
  if ("erro" in montados) return montados.erro;
  const novosItens = montados.itens;

  const valorDoAcrescimo =
    Math.round(novosItens.reduce((s, i) => s + i.price * i.quantity, 0) * 100) / 100;
  const descricao = novosItens.map((i) => `+${i.quantity}x ${i.productName}`).join(", ");

  const numero = await generateDailyOrderNumber(lojaId);
  const novo = await prisma.customerOrder.create({
    data: {
      franchiseeId: lojaId,
      parentOrderId: order.id,
      dailyOrderNumber: numero,
      customerName: order.customerName || "Cliente",
      customerPhone: order.customerPhone || "00000000000",
      customerAddress: order.customerAddress || "",
      deliveryType: order.deliveryType || "DELIVERY",
      paymentMethod: pagamento,
      // Nasce sem taxa: a entrega já foi cobrada no pedido original. Cobrar
      // de novo no acréscimo seria cobrar duas vezes pela mesma viagem.
      deliveryFee: 0,
      totalAmount: valorDoAcrescimo,
      status: "ACEITO",
      // PRESENCIAL e não o canal do pai: é venda própria da loja, e é assim
      // que o caixa a classifica pela forma de pagamento — que é justamente o
      // que não funcionaria se ela ficasse marcada como iFood.
      source: "PRESENCIAL",
      notes: `Acréscimo do pedido ${order.ifoodReference || order.openDeliveryReference || order.dailyOrderNumber || order.id.slice(-6).toUpperCase()}`,
      editHistory: [
        {
          quando: new Date().toISOString(),
          quem: nomeDoOperador(operador),
          acao: "ACRESCENTOU",
          descricao,
          totalAntes: 0,
          totalDepois: valorDoAcrescimo,
        },
      ] as any,
      items: { create: novosItens },
    },
    select: { id: true, dailyOrderNumber: true, totalAmount: true },
  });

  // O acréscimo é comida saindo da cozinha como qualquer outra: o insumo tem
  // que baixar, senão o estoque infla exatamente no item que mais sai por
  // pedido do cliente que liga.
  import("@/lib/stock")
    .then(({ deductStockForOrder }) => deductStockForOrder(novo.id))
    .catch((e: any) => console.error(`[Editar Pedido] baixa de estoque do acréscimo ${novo.id}:`, e?.message));

  // O rastro fica NOS DOIS: no pai, para quem abrir o pedido do iFood ver que
  // houve acréscimo; no filho, para quem achar a venda solta no caixa saber
  // de onde ela veio.
  await prisma.customerOrder.update({
    where: { id: order.id },
    data: {
      editHistory: empilharEdicao(order.editHistory, {
        quando: new Date().toISOString(),
        quem: nomeDoOperador(operador),
        acao: "ACRESCENTOU",
        descricao: `${descricao} (pedido colado ${novo.dailyOrderNumber ?? novo.id.slice(-6).toUpperCase()}, pago em ${pagamento})`,
        totalAntes: order.totalAmount || 0,
        totalDepois: order.totalAmount || 0,
      }) as any,
    },
  });

  console.log(
    `[Editar Pedido] acréscimo colado ${novo.id} (R$ ${valorDoAcrescimo}, ${pagamento}) no pedido ${order.id}, por ${nomeDoOperador(operador)}`
  );
  return NextResponse.json({
    success: true,
    acrescimo: { id: novo.id, numero: novo.dailyOrderNumber, valor: valorDoAcrescimo, pagamento },
  });
}


// ── Cancelar ────────────────────────────────────────────────────────────────

async function cancelarPedido(order: any, operador: any) {
  const registro: RegistroDeEdicao = {
    quando: new Date().toISOString(),
    quem: nomeDoOperador(operador),
    acao: "CANCELADO" as any,
    descricao: "Pedido cancelado pela edição (ficou sem itens ou foi cancelado na mão)",
    totalAntes: order.totalAmount || 0,
    totalDepois: 0,
  };

  await prisma.customerOrder.update({
    where: { id: order.id },
    data: {
      // A grafia é CANCELADO — a que o resto do sistema grava e filtra.
      status: "CANCELADO",
      cancelledBy: "LOJA",
      cancelReason: "Cancelado pelo painel ao editar o pedido",
      editHistory: empilharEdicao(order.editHistory, { ...registro, acao: "CANCELOU" }) as any,
    },
  });

  // Devolve o insumo baixado. Usa as BAIXAS registradas do pedido, nunca a
  // ficha técnica de hoje, que pode ter mudado desde então.
  try {
    const { restoreStockForOrder } = await import("@/lib/stock");
    restoreStockForOrder(order.id).catch((e: any) =>
      console.error(`[Editar Pedido] devolução de estoque falhou para ${order.id}:`, e?.message)
    );
  } catch {}

  console.log(`[Editar Pedido] pedido ${order.id} cancelado por ${registro.quem}`);
  return NextResponse.json({ success: true, cancelado: true });
}
