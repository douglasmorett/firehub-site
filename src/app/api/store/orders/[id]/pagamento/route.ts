import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { empilharEdicao, podeEditarPedidos, type RegistroDeEdicao } from "@/lib/edicao-de-pedido";
import { FORMAS_DE_PAGAMENTO_NA_ENTREGA, podeTrocarPagamento } from "@/lib/pagamento-na-entrega";
import { validarDivisao, type ParteDoPagamento } from "@/lib/pagamento-dividido";

/**
 * PATCH /api/store/orders/[id]/pagamento   { paymentMethod, changeAmount? }
 *
 * O cliente diz "dinheiro" ao pedir e paga no débito na porta — ou o
 * contrário. Até aqui o painel não tinha como consertar: a edição de itens não
 * mexe em pagamento, e pedido finalizado nem abria. O acerto ia para o
 * caderno, e o fechamento de caixa fechava na forma errada (pedido do dono,
 * 17/09/2026).
 *
 * Vale para qualquer canal — iFood, 99Food, site, robô — e em qualquer status
 * que não seja cancelado, inclusive depois de entregue, que é quando a loja
 * descobre. A única exceção é pagamento online já confirmado
 * (`podeTrocarPagamento`, lib/pagamento-na-entrega.ts): o dinheiro já entrou
 * por outro caminho.
 *
 * Quem pode é quem pode editar pedidos — a mesma permissão por funcionário de
 * lib/edicao-de-pedido.ts: trocar a forma mexe no caixa tanto quanto tirar
 * item. O rastro fica em editHistory, com quem e quando.
 *
 * O que NÃO muda: o total. E a NFC-e que já saiu na baixa continua com a forma
 * antiga — troca depois de entregue é acerto do caixa, não da nota.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions).catch(() => null);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  const operador = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, name: true, email: true, role: true, permissions: true, ownerId: true },
  });
  if (!operador) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  if (!podeEditarPedidos(operador)) {
    return NextResponse.json(
      { error: "Você não tem permissão para editar pedidos. O dono da loja libera em Configurações → Equipe." },
      { status: 403 },
    );
  }

  const lojaId = operador.ownerId || operador.id;
  const { id } = await params;
  const order = await prisma.customerOrder.findFirst({
    where: { id, franchiseeId: lojaId },
    select: {
      id: true, status: true, deliveryType: true, tableSessionId: true, totalAmount: true,
      paymentMethod: true, changeAmount: true, paymentMethods: true, gatewayPaymentId: true, editHistory: true,
    },
  });
  if (!order) return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });

  const corpo = await req.json().catch(() => ({} as any));

  // ── PAGAMENTO DIVIDIDO ────────────────────────────────────────────────
  //
  // "O cliente bota dinheiro e aí chega lá paga metade no débito e metade no
  // crédito" (pedido do dono, 20/09/2026). Antes só cabia UMA forma aqui, e
  // pior: a rota APAGAVA as partes de um pedido que já vinha dividido do
  // balcão. O operador escolhia uma forma só, e o fechamento cobrava da gaveta
  // um valor que tinha passado na maquininha.
  //
  // As partes têm que fechar com o total — quem confere isso é
  // `validarDivisao`, a MESMA função que o balcão usa, para as duas telas
  // nunca aceitarem coisas diferentes.
  const querDividir = Array.isArray(corpo?.paymentMethods) && corpo.paymentMethods.length > 0;
  let divisao: ParteDoPagamento[] | null = null;
  let forma = String(corpo?.paymentMethod || "").trim();

  if (querDividir) {
    const r = validarDivisao(corpo.paymentMethods, order.totalAmount || 0);
    if (!r.ok) return NextResponse.json({ error: r.erro }, { status: 400 });
    divisao = r.partes;
    forma = r.resumo;
  } else if (!(FORMAS_DE_PAGAMENTO_NA_ENTREGA as readonly string[]).includes(forma)) {
    return NextResponse.json(
      { error: "Forma de pagamento inválida.", formas: FORMAS_DE_PAGAMENTO_NA_ENTREGA },
      { status: 400 },
    );
  }

  const avaliacao = podeTrocarPagamento(order);
  if (!avaliacao.pode) {
    return NextResponse.json({ error: avaliacao.motivo }, { status: 403 });
  }

  // Troco é conta de dinheiro. `changeAmount` é a NOTA que o cliente entrega
  // (mesma convenção do app do motoboy), não o troco.
  // Numa divisão, o troco é da PARTE em dinheiro — não do pedido inteiro.
  const parteEmDinheiro = divisao?.find((p) => p.method === "Dinheiro")?.amount ?? null;
  const aceitaTroco = divisao ? parteEmDinheiro != null : forma === "Dinheiro";
  const trocoPara = aceitaTroco && Number(corpo?.changeAmount) > 0 ? Number(corpo.changeAmount) : null;

  if (!divisao && order.paymentMethod === forma && (order.changeAmount ?? null) === trocoPara) {
    return NextResponse.json({ success: true, semMudanca: true, paymentMethod: forma, changeAmount: trocoPara });
  }

  const registro: RegistroDeEdicao = {
    quando: new Date().toISOString(),
    quem: operador.name || operador.email,
    acao: "PAGAMENTO",
    descricao:
      `Pagamento: ${order.paymentMethod || "não informado"} → ${forma}` +
      (trocoPara ? ` (troco para R$ ${trocoPara.toFixed(2).replace(".", ",")})` : ""),
    totalAntes: order.totalAmount,
    totalDepois: order.totalAmount,
  };

  await prisma.customerOrder.update({
    where: { id: order.id },
    data: {
      paymentMethod: forma,
      changeAmount: trocoPara,
      // Dividiu: as partes ficam gravadas e o fechamento de caixa manda cada
      // uma para a SUA linha da conferência. Escolheu uma forma só: as partes
      // antigas saem, porque é o que a loja acabou de dizer que aconteceu.
      ...(divisao
        ? { paymentMethods: divisao as any }
        : order.paymentMethods != null
          ? { paymentMethods: Prisma.DbNull }
          : {}),
      editHistory: empilharEdicao(order.editHistory, registro) as any,
    },
  });

  console.log(`[Pagamento] pedido ${order.id}: ${order.paymentMethod} → ${forma} por ${registro.quem}`);
  return NextResponse.json({ success: true, paymentMethod: forma, changeAmount: trocoPara, paymentMethods: divisao });
}
