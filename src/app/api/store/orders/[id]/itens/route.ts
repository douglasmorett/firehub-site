/**
 * Editar um pedido de delivery/balcão JÁ LANÇADO — o cliente ligou.
 *
 * PATCH  { itens: [{ itemId, quantity }], removerItemIds: [...] }
 *          → muda quantidade e/ou remove itens. O total é recalculado do que
 *            sobrou (nunca digitado à mão), pela conta de
 *            lib/edicao-de-pedido.ts — que preserva taxa de entrega e desconto,
 *            ao contrário da conta da mesa. Sobrou zero item = pedido cancelado
 *            e estoque devolvido.
 *
 *            EM PEDIDO DE MARKETPLACE isto também passa (desde 19/09/2026 — o
 *            cliente liga na loja, não no app), com duas diferenças: se o
 *            pedido foi pago na plataforma o `totalAmount` NÃO cai junto (ele
 *            tem que continuar batendo com o repasse; só os itens mudam), e
 *            tirar o último item não vira cancelamento — cancelar pedido de
 *            parceiro é pelo botão que avisa o parceiro.
 *
 *        { desconto: { tipo: "percent" | "valor", valor, motivo } }
 *          → desconto dado na edição, sozinho ou junto com os itens. Soma ao
 *            desconto que o pedido tinha, vale sobre os itens (sem a taxa) e
 *            só quando o cliente ainda vai pagar (`descontoNaEdicao`).
 *
 *        { acrescentar: [{ menuProductId, quantity, notes, comboSelections }], pagamento }
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
import { conferirEstoque } from "@/lib/estoque-restante";
import { precoDoCanal, aplicarPrecoDoCanalComCombo, type CanalDePreco } from "@/lib/preco-por-canal";
import { precoUnitarioDoItem, pisoDoPreco } from "@/lib/preco-combo";
import {
  avaliarEdicao,
  recalcularTotal,
  empilharEdicao,
  descontoNaEdicao,
  contaDoDescontoDaEdicao,
  descontoDaLojaDepoisDaEdicao,
  type RegistroDeEdicao,
} from "@/lib/edicao-de-pedido";
import { descontoDoCorpo, descreverDesconto, notaDoDesconto, type DescontoManual } from "@/lib/desconto-manual";
import { motivoDoCorpo, MENSAGEM_SEM_MOTIVO, type ItemRetirado } from "@/lib/motivo-do-cancelamento";

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
  // O que decide se o dinheiro já entrou pela plataforma — é isso que separa
  // "o total cai junto com o item" de "o total fica em pé para bater com o
  // repasse" (lib/edicao-de-pedido.ts).
  paymentMethod: true,
  gatewayPaymentId: true,
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
  // O desconto da edição: soma ao que o pedido tinha, a parte da loja vai para
  // `discountMerchant` (relatório de descontos) e o motivo para a observação.
  notes: true,
  discountMerchant: true,
  discountIfood: true,
  paymentMethods: true,
  // Nota autorizada trava a edição (travaDaNotaFiscal, em avaliarEdicao).
  fiscalStatus: true,
  fiscalInfo: true,
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

/**
 * O que esta edição TIRA do pedido: os removidos inteiros e a diferença de
 * quem teve a quantidade diminuída. Vazio = não tira nada (só acrescenta ou
 * dá desconto), e aí o motivo não é pedido.
 */
function retiradosDaEdicao(
  itensDoPedido: { id: string; quantity: number; price: number; productName?: string | null }[],
  remover: string[],
  mudar: { itemId: string; quantity: number }[]
): ItemRetirado[] {
  const linha = (i: { quantity: number; price: number; productName?: string | null }, quantidade: number): ItemRetirado => ({
    nome: String(i.productName || "item").trim() || "item",
    quantidade,
    valor: Math.round(Number(i.price || 0) * quantidade * 100) / 100,
  });
  const saida: ItemRetirado[] = [];
  for (const i of itensDoPedido || []) {
    if (remover.includes(i.id)) { saida.push(linha(i, i.quantity)); continue; }
    const m = mudar.find((x) => x.itemId === i.id);
    if (m && m.quantity < i.quantity) saida.push(linha(i, i.quantity - m.quantity));
  }
  return saida;
}

const semMotivo = () => NextResponse.json({ error: MENSAGEM_SEM_MOTIVO, precisaDeMotivo: true }, { status: 400 });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await contexto(params);
    if ("erro" in ctx) return ctx.erro;
    const { order, operador, avaliacao, lojaId } = ctx;

    const body = await req.json().catch(() => ({}) as any);
    const acrescentar: Acrescimo[] = Array.isArray(body?.acrescentar) ? body.acrescentar : [];
    const itens: { itemId: string; quantity: number }[] = Array.isArray(body?.itens) ? body.itens : [];
    const removerItemIds: string[] = Array.isArray(body?.removerItemIds)
      ? body.removerItemIds.map(String)
      : [];

    const querMexerNosOriginais = itens.length > 0 || removerItemIds.length > 0;
    const desconto = descontoDoCorpo(body?.desconto);
    // Tirar item ou diminuir quantidade pede o motivo (lib/motivo-do-cancelamento.ts).
    const motivo = motivoDoCorpo(body);

    if (!querMexerNosOriginais && acrescentar.length === 0 && !desconto) {
      return NextResponse.json({ error: "Nada para alterar" }, { status: 400 });
    }
    if (desconto) {
      const pode = descontoNaEdicao(order as any, avaliacao);
      if (!pode.pode) return NextResponse.json({ error: pode.motivo }, { status: 403 });
    }

    // ── Marketplace: as duas metades, cada uma no seu lugar ──────────────
    //
    // Mexer nos itens originais passa (é o pedido do lojista: o cliente ligou
    // na loja para tirar item). O ACRÉSCIMO continua virando pedido colado
    // pelas duas razões escritas no topo — repasse do parceiro e fechamento de
    // caixa —, então quando vêm as duas coisas na mesma chamada, a remoção é
    // gravada primeiro e o colado nasce depois.
    if (avaliacao.modo === "MARKETPLACE") {
      if (querMexerNosOriginais || desconto) {
        const resposta = await editarItensDoMarketplace({
          order,
          operador,
          itens,
          removerItemIds,
          totalMuda: avaliacao.totalMuda === true,
          desconto,
          motivo,
        });
        // Erro (nada válido, ou tirou tudo): não segue para o acréscimo.
        if (!resposta.ok) return resposta.resposta;
        if (acrescentar.length === 0) return resposta.resposta;
        // Com acréscimo junto, quem responde é o colado — a tela precisa do
        // pedido novo para imprimir a comanda dele.
      }
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
    return await editarPedidoProprio({ order, lojaId, operador, itens, removerItemIds, acrescentar, desconto, motivo });
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
    if (ctx.avaliacao.modo === "MARKETPLACE") {
      return NextResponse.json(
        { error: "Para cancelar um pedido de marketplace, use o botão Cancelar do painel — ele avisa o parceiro." },
        { status: 403 }
      );
    }
    // O motivo vem no corpo ({ motivo }) ou em ?motivo=.
    const body = await req.json().catch(() => ({}) as any);
    const motivo = motivoDoCorpo(body) || motivoDoCorpo({ motivo: req.nextUrl.searchParams.get("motivo") });
    return await cancelarPedido(ctx.order, ctx.operador, motivo);
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
  acrescentar: Acrescimo[];
  desconto: DescontoManual | null;
  motivo: string;
}) {
  const { order, lojaId, operador, desconto, motivo } = entrada;

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

  const mexeuNosItens = remover.length > 0 || mudar.length > 0 || novosItens.length > 0;
  if (!mexeuNosItens && !desconto) {
    return NextResponse.json({ error: "Nenhum item válido para alterar" }, { status: 400 });
  }

  const retirados = retiradosDaEdicao(order.items, remover, mudar);
  if (retirados.length > 0 && !motivo) return semMotivo();

  // Estoque disponível. O que o pedido JÁ tem já está contado como vendido,
  // então o que se confere é a DIFERENÇA por produto: o acrescentado, mais o
  // aumento de quantidade, menos o que foi tirado. Trocar uma costela por
  // outra costela "sem cebola" com a última na prateleira tem que passar.
  const diferenca: { menuProductId: string; quantity: number }[] = [];
  for (const i of order.items as any[]) {
    if (!i.menuProductId) continue;
    if (remover.includes(i.id)) diferenca.push({ menuProductId: i.menuProductId, quantity: -i.quantity });
    const m = mudar.find((x) => x.itemId === i.id);
    if (m) diferenca.push({ menuProductId: i.menuProductId, quantity: m.quantity - i.quantity });
  }
  for (const n of novosItens) diferenca.push({ menuProductId: n.menuProductId, quantity: n.quantity });
  const liquido = new Map<string, number>();
  for (const d of diferenca) liquido.set(d.menuProductId, (liquido.get(d.menuProductId) || 0) + d.quantity);
  const aumentos = [...liquido].filter(([, q]) => q > 0).map(([menuProductId, quantity]) => ({ menuProductId, quantity }));
  if (aumentos.length > 0) {
    const estoque = await conferirEstoque(lojaId, aumentos);
    if (!estoque.ok) return NextResponse.json({ error: estoque.mensagem }, { status: 409 });
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
    return cancelarPedido(order, operador, motivo);
  }

  const comDesconto = gravacaoDoDesconto(order, finais, desconto);
  if (comDesconto && "erro" in comDesconto) return NextResponse.json({ error: comDesconto.erro }, { status: 400 });

  const novoTotal = comDesconto
    ? comDesconto.total
    : recalcularTotal({
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
    ...novosItens.map((i) => `+${i.quantity}x ${comEscolhas(i)}`),
    ...(comDesconto ? [comDesconto.descricao] : []),
  ].join(", ");

  const registro: RegistroDeEdicao = {
    quando: new Date().toISOString(),
    quem: nomeDoOperador(operador),
    acao:
      remover.length > 0
        ? "REMOVEU"
        : mudar.length > 0
          ? "MUDOU_QTD"
          : novosItens.length > 0
            ? "ACRESCENTOU"
            : "DESCONTO",
    descricao,
    totalAntes: order.totalAmount || 0,
    totalDepois: novoTotal,
    ...(retirados.length > 0 ? { motivo, itensRetirados: retirados } : {}),
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
        ...(comDesconto ? comDesconto.dados : {}),
        editHistory: empilharEdicao(order.editHistory, registro) as any,
      },
    });
  });

  // Só o desconto: os itens são os mesmos, não há estoque a refazer.
  if (!mexeuNosItens) {
    console.log(`[Editar Pedido] ${order.id}: ${descricao}, total ${order.totalAmount} → ${novoTotal}, por ${registro.quem}`);
    return NextResponse.json({ success: true, totalAmount: novoTotal, registro, soDesconto: true, desconto: comDesconto!.valor });
  }

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
  return NextResponse.json({ success: true, totalAmount: novoTotal, registro, ...(comDesconto ? { desconto: comDesconto.valor } : {}) });
}

/**
 * O que o desconto da edição grava (contaDoDescontoDaEdicao em
 * lib/edicao-de-pedido.ts — a mesma conta que a tela mostrou):
 *
 *   • `discountTotal` soma o desconto novo ao que o pedido já tinha;
 *   • `discountMerchant` sempre (descontoDaLojaDepoisDaEdicao): é a LOJA que
 *     dá, e é desse campo que o fechamento de caixa tira a linha "Desconto";
 *   • a observação ganha "[Desconto: 10% (R$ 5,90) — Pedido atrasado]", o
 *     mesmo formato do balcão (lib/desconto-manual.ts): sai na comanda e o
 *     relatório lê o motivo dali.
 */
function gravacaoDoDesconto(
  order: any,
  itensFinais: { price: number; quantity: number }[],
  desconto: DescontoManual | null,
):
  | null
  | { erro: string }
  | { total: number; valor: number; descricao: string; dados: Record<string, unknown> } {
  if (!desconto) return null;
  const conta = contaDoDescontoDaEdicao({
    itens: itensFinais,
    discountTotal: order.discountTotal,
    deliveryFee: order.deliveryFee,
    desconto,
  });
  if (conta.problema) return { erro: conta.problema };
  if (!(conta.valor > 0)) return { erro: "O pedido não tem valor de item para dar desconto." };

  const nota = notaDoDesconto(desconto, conta.base);
  const notes = [String(order.notes || "").trim(), nota].filter(Boolean).join("\n");
  return {
    total: conta.total,
    valor: conta.valor,
    descricao: `desconto ${descreverDesconto(desconto, conta.base)}`,
    dados: {
      discountTotal: conta.discountTotal,
      discountMerchant: descontoDaLojaDepoisDaEdicao(order, conta.valor),
      notes,
    },
  };
}

// ── Marketplace: tirar item e mudar quantidade, sem mexer no repasse ───────

/**
 * O cliente ligou NA LOJA para tirar dois dos dez itens de um pedido do iFood.
 *
 * O que muda aqui e não no pedido próprio:
 *
 *   • O TOTAL SÓ CAI SE O CLIENTE AINDA VAI PAGAR. Pedido pago na plataforma
 *     continua valendo o que o parceiro vai depositar — `totalAmount` intocado,
 *     com os itens certos na comanda. Reduzir o total ali faria o relatório de
 *     faturamento divergir do extrato do iFood todo santo dia, que é o motivo
 *     pelo qual esta edição era proibida até 19/09/2026. Quem paga na porta tem
 *     o total recalculado, porque o entregador vai cobrar o novo valor.
 *     Quem decide é `avaliarEdicao` (`totalMuda`), nunca esta função.
 *
 *   • TIRAR O ÚLTIMO ITEM NÃO CANCELA. No pedido próprio isso vira
 *     cancelamento; aqui cancelar significa avisar o parceiro com o código de
 *     cancelamento que ele exige, e quem faz isso é o botão Cancelar do painel.
 *     Pedido de parceiro vazio e ativo seria pior que o erro que corrige.
 *
 * O estoque segue a mesma regra do pedido próprio: devolve o que foi baixado e
 * baixa de novo o que sobrou, em sequência — a cozinha vai produzir menos.
 */
async function editarItensDoMarketplace(entrada: {
  order: any;
  operador: any;
  itens: { itemId: string; quantity: number }[];
  removerItemIds: string[];
  totalMuda: boolean;
  desconto?: DescontoManual | null;
  motivo?: string;
}): Promise<{ ok: boolean; resposta: NextResponse }> {
  const { order, operador, totalMuda } = entrada;
  const motivo = entrada.motivo || "";
  // Só chega com desconto quando totalMuda: o PATCH recusa o do pedido pago no parceiro.
  const desconto = totalMuda ? entrada.desconto || null : null;

  const idsDoPedido = new Set(order.items.map((i: any) => i.id));
  const remover = entrada.removerItemIds.filter((rid) => idsDoPedido.has(rid));
  const mudar = entrada.itens
    .filter((m) => m && idsDoPedido.has(String(m.itemId)) && !remover.includes(String(m.itemId)))
    .map((m) => ({ itemId: String(m.itemId), quantity: Math.floor(Number(m.quantity)) }))
    .filter((m) => Number.isFinite(m.quantity) && m.quantity >= 1 && m.quantity <= 99);

  const mexeuNosItens = remover.length > 0 || mudar.length > 0;
  if (!mexeuNosItens && !desconto) {
    return {
      ok: false,
      resposta: NextResponse.json({ error: "Nenhum item válido para alterar" }, { status: 400 }),
    };
  }

  const retirados = retiradosDaEdicao(order.items, remover, mudar);
  if (retirados.length > 0 && !motivo) return { ok: false, resposta: semMotivo() };

  const sobraram = order.items
    .filter((i: any) => !remover.includes(i.id))
    .map((i: any) => ({ ...i, quantity: mudar.find((m) => m.itemId === i.id)?.quantity ?? i.quantity }));

  if (sobraram.length === 0) {
    return {
      ok: false,
      resposta: NextResponse.json(
        {
          error:
            "Para tirar TODOS os itens, cancele o pedido pelo botão Cancelar do painel — é ele que avisa o parceiro.",
        },
        { status: 403 }
      ),
    };
  }

  const finais = sobraram.map((i: any) => ({ price: i.price, quantity: i.quantity }));
  const comDesconto = gravacaoDoDesconto(order, finais, desconto);
  if (comDesconto && "erro" in comDesconto) {
    return { ok: false, resposta: NextResponse.json({ error: comDesconto.erro }, { status: 400 }) };
  }

  const novoTotal = comDesconto
    ? comDesconto.total
    : totalMuda
      ? recalcularTotal({
          itens: finais,
          deliveryFee: order.deliveryFee,
          discountTotal: order.discountTotal,
        })
      : Number(order.totalAmount) || 0;

  const nomeDoItem = (id: string) => order.items.find((i: any) => i.id === id)?.productName || "item";
  const descricao =
    [
      ...remover.map((rid) => `−${nomeDoItem(rid)}`),
      ...mudar.map((m) => {
        const antes = order.items.find((i: any) => i.id === m.itemId)?.quantity;
        return `${nomeDoItem(m.itemId)} ${antes}x → ${m.quantity}x`;
      }),
      ...(comDesconto ? [comDesconto.descricao] : []),
    ].join(", ") + (totalMuda ? "" : " (pago na plataforma: total mantido)");

  const registro: RegistroDeEdicao = {
    quando: new Date().toISOString(),
    quem: nomeDoOperador(operador),
    acao: remover.length > 0 ? "REMOVEU" : mudar.length > 0 ? "MUDOU_QTD" : "DESCONTO",
    descricao,
    totalAntes: order.totalAmount || 0,
    totalDepois: novoTotal,
    ...(retirados.length > 0 ? { motivo, itensRetirados: retirados } : {}),
  };

  await prisma.$transaction(async (tx) => {
    for (const rid of remover) {
      await tx.customerOrderItem.delete({ where: { id: rid } });
    }
    for (const m of mudar) {
      await tx.customerOrderItem.update({ where: { id: m.itemId }, data: { quantity: m.quantity } });
    }
    await tx.customerOrder.update({
      where: { id: order.id },
      data: {
        ...(totalMuda ? { totalAmount: novoTotal } : {}),
        ...(comDesconto ? comDesconto.dados : {}),
        editHistory: empilharEdicao(order.editHistory, registro) as any,
      },
    });
  });

  if (!mexeuNosItens) {
    console.log(`[Editar Pedido] marketplace ${order.id}: ${descricao}, total ${order.totalAmount} → ${novoTotal}, por ${registro.quem}`);
    return {
      ok: true,
      resposta: NextResponse.json({ success: true, totalAmount: novoTotal, registro, soDesconto: true, desconto: comDesconto!.valor }),
    };
  }

  import("@/lib/stock")
    .then(async ({ restoreStockForOrder, deductStockForOrder }) => {
      await restoreStockForOrder(order.id);
      await deductStockForOrder(order.id);
    })
    .catch((e: any) =>
      console.error(
        `[Editar Pedido] rebaixa de estoque falhou no pedido de parceiro ${order.id} — ` +
        `conferir o saldo dos insumos de ${descricao}:`,
        e?.message
      )
    );

  console.log(
    `[Editar Pedido] marketplace ${order.id}: ${remover.length} removido(s), ${mudar.length} qtd alterada(s), ` +
    `total ${order.totalAmount} → ${novoTotal}${totalMuda ? "" : " (mantido)"}, por ${registro.quem}`
  );

  return {
    ok: true,
    resposta: NextResponse.json({
      success: true, totalAmount: novoTotal, totalMantido: !totalMuda, registro,
      ...(comDesconto ? { desconto: comDesconto.valor } : {}),
    }),
  };
}

// ── Itens novos: preço do banco e isolamento entre lojas ────────────────────

/** O que a tela manda para acrescentar. `comboSelections`: { grupoId: { opção: qtd } }, como o cardápio. */
type Acrescimo = { menuProductId: string; quantity: number; notes?: string; comboSelections?: unknown };

type ItemNovo = {
  menuProductId: string;
  productName: string;
  quantity: number;
  price: number;
  notes: string | null;
  comboSelections?: Record<string, Record<string, number>>;
};

/** "Pizza G (Calabresa, Frango)" — o histórico de edição diz o que entrou, não só o produto. */
function comEscolhas(i: ItemNovo): string {
  const nomes = Object.values(i.comboSelections || {}).flatMap((g) =>
    Object.entries(g).map(([nome, q]) => (q > 1 ? `${nome} x${q}` : nome))
  );
  return nomes.length > 0 ? `${i.productName} (${nomes.join(", ")})` : i.productName;
}

/**
 * As escolhas que vieram da tela, só com o que EXISTE no produto: pergunta
 * dele e opção daquela pergunta, quantidade inteira de 1 a 30. É o que vai
 * para a comanda e para a conta — opção inventada no corpo não imprime nem
 * entra no preço.
 */
function escolhasDoProduto(bruto: unknown, grupos: any[]): Record<string, Record<string, number>> | null {
  let v: any = bruto;
  if (typeof v === "string") {
    try { v = JSON.parse(v); } catch { return null; }
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const saida: Record<string, Record<string, number>> = {};
  for (const g of grupos) {
    const doGrupo = v[g.id];
    if (!doGrupo || typeof doGrupo !== "object") continue;
    const nomes = new Set((g.items || []).map((i: any) => i?.menuProduct?.name).filter(Boolean));
    for (const [nome, q] of Object.entries(doGrupo)) {
      const n = Math.floor(Number(q));
      if (!nomes.has(nome) || !Number.isFinite(n) || n < 1 || n > 30) continue;
      (saida[g.id] ||= {})[nome] = n;
    }
  }
  return Object.keys(saida).length > 0 ? saida : null;
}

/**
 * Transforma o que o navegador pediu em itens graváveis.
 *
 * O PREÇO VEM DO BANCO, nunca do corpo: aceitar preço do cliente seria deixar o
 * navegador dizer quanto custa. E só produto DESTA loja entra — é a mesma
 * guarda da venda de balcão, que existe porque um menuProductId de outra loja
 * fazia a baixa de estoque seguir a ficha técnica dela, drenando insumo alheio.
 */
async function montarItensNovos(
  brutos: Acrescimo[],
  lojaId: string,
  deliveryType: string | null | undefined
): Promise<{ erro: NextResponse } | { itens: ItemNovo[] }> {
  const pedidos = brutos
    .map((a) => ({
      menuProductId: String(a?.menuProductId || ""),
      quantity: Math.floor(Number(a?.quantity)),
      notes: a?.notes ? String(a.notes).trim().slice(0, 200) : null,
      comboSelections: a?.comboSelections,
    }))
    .filter((a) => a.menuProductId && Number.isFinite(a.quantity) && a.quantity >= 1 && a.quantity <= 99);

  if (pedidos.length === 0) {
    return { erro: NextResponse.json({ error: "Nenhum item válido para acrescentar" }, { status: 400 }) };
  }

  const produtos = await prisma.menuProduct.findMany({
    where: { id: { in: pedidos.map((p) => p.menuProductId) }, franchiseeId: lojaId },
    select: {
      id: true, name: true, price: true,
      priceDelivery: true, priceSalao: true, priceTotem: true,
      // Sem esta coluna o item trocado sairia pelo preço de tabela enquanto
      // a vitrine anunciava a promoção.
      promoPrice: true,
      // As perguntas, com a regra e o preço por canal de cada opção. Sem elas
      // a pizza de base R$ 0,00 entrava por R$ 0,00 e sem sabor: a Divinos
      // tentou corrigir por aqui o pedido #9218 em 25/09/2026 e não conseguiu.
      comboGroups: {
        select: {
          id: true, title: true, minQty: true, maxQty: true, priceRule: true,
          items: {
            select: {
              additionalPrice: true, additionalPriceDelivery: true, additionalPriceSalao: true,
              additionalPriceTotem: true, maxPerItem: true, precoPorEscolha: true, promoAdditionalPrice: true,
              menuProduct: { select: { name: true, price: true } },
            },
          },
        },
      },
    },
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
      const grupos = prod.comboGroups || [];
      if (grupos.length === 0) {
        return {
          menuProductId: prod.id,
          productName: prod.name,
          quantity: p.quantity,
          price: precoDoCanal(prod as any, canalDePreco),
          notes: p.notes,
        };
      }
      // Produto com perguntas: a mesma conta da mesa, do site e do totem
      // (lib/preco-combo.ts) — a regra de cada pergunta (SOMA, MAIOR, MÉDIA)
      // e o piso, que segura a pizza de base zero mandada sem sabor.
      const noCanal = aplicarPrecoDoCanalComCombo(prod as any, canalDePreco);
      const escolhas = escolhasDoProduto(p.comboSelections, grupos);
      const preco = Math.max(precoUnitarioDoItem(noCanal as any, escolhas), pisoDoPreco(noCanal as any));
      return {
        menuProductId: prod.id,
        productName: prod.name,
        quantity: p.quantity,
        price: Math.round(preco * 100) / 100,
        notes: p.notes,
        ...(escolhas ? { comboSelections: escolhas } : {}),
      };
    }),
  };
}

// ── Marketplace: o acréscimo vira um pedido próprio colado no original ──────

async function acrescentarColado(entrada: {
  order: any;
  lojaId: string;
  operador: any;
  acrescentar: Acrescimo[];
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

  const estoque = await conferirEstoque(lojaId, novosItens);
  if (!estoque.ok) return NextResponse.json({ error: estoque.mensagem }, { status: 409 });

  const valorDoAcrescimo =
    Math.round(novosItens.reduce((s, i) => s + i.price * i.quantity, 0) * 100) / 100;
  const descricao = novosItens.map((i) => `+${i.quantity}x ${comEscolhas(i)}`).join(", ");

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

/**
 * Cancelar pela edição: o botão Cancelar da aba Editar itens, ou tirar todos
 * os itens. As duas são a PESSOA cancelando — não há nada automático aqui —,
 * então o motivo é obrigatório como em qualquer cancelamento da loja. Antes o
 * fechamento do caixa mostrava "Cancelado pelo painel ao editar o pedido", e
 * o dono não sabia por quê (Pizzaria 17, 09/10/2026).
 */
async function cancelarPedido(order: any, operador: any, motivo: string) {
  if (!motivo) return semMotivo();
  const registro: RegistroDeEdicao = {
    quando: new Date().toISOString(),
    quem: nomeDoOperador(operador),
    acao: "CANCELOU",
    descricao: "Pedido cancelado pela edição (ficou sem itens ou foi cancelado na mão)",
    totalAntes: order.totalAmount || 0,
    totalDepois: 0,
    motivo,
    itensRetirados: retiradosDaEdicao(order.items, (order.items || []).map((i: any) => i.id), []),
  };

  await prisma.customerOrder.update({
    where: { id: order.id },
    data: {
      // A grafia é CANCELADO — a que o resto do sistema grava e filtra.
      status: "CANCELADO",
      cancelledBy: "LOJA",
      cancelReason: motivo,
      editHistory: empilharEdicao(order.editHistory, registro) as any,
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
