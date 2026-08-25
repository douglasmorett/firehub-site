import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getAuthToken, detalheDoPedido } from "@/lib/food99-api";
import { traduzirPedido99Food, type ItemTraduzido } from "@/lib/food99-pedido";
import { generateDailyOrderNumber } from "@/lib/order-number";

export const dynamic = "force-dynamic";

/**
 * POST /api/99food/importar-pedido  { orderId }
 *
 * Puxa um pedido do 99Food pelo id e cria no FireHub, mesmo que o webhook não
 * o tenha entregue.
 *
 * Existe por causa do buraco entre o pedido e o vínculo: os pedidos que a loja
 * recebeu ANTES de estar vinculada ao app nunca foram entregues em webhook
 * nenhum, e não há como pedi-los de novo — o 99Food não reenvia o que não
 * chegou a disparar. Sem esta rota, esses pedidos só entram no sistema
 * digitados à mão.
 *
 * Também serve para quando um webhook se perde: o 99Food reenvia por um tempo,
 * mas se o nosso lado ficou fora do ar mais que isso, o pedido some. Aqui ele
 * volta.
 *
 * É idempotente por `openDeliveryOrderId`: importar duas vezes não duplica.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true, storeName: true },
  });
  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const lojaId = user.ownerId || user.id;

  const body = await req.json().catch(() => ({}));
  const orderId = String(body.orderId ?? "").trim();
  if (!orderId || !/^\d+$/.test(orderId)) {
    return NextResponse.json(
      { error: "Informe o orderId (só números) — é o ID do pedido no 99Food." },
      { status: 400 }
    );
  }

  const auth = await getAuthToken(lojaId);
  if (!auth.autorizada) {
    return NextResponse.json(
      { error: auth.erro || "Loja não está autorizada no 99Food. Conecte a integração primeiro." },
      { status: 409 }
    );
  }

  const r = await detalheDoPedido(auth.token.auth_token, orderId);
  if (r.errno !== 0 || !r.data) {
    return NextResponse.json(
      {
        error: `O 99Food não devolveu o pedido: ${r.errno} ${r.errmsg}`,
        dica:
          "O ID tem que ser o do pedido (19 dígitos), não o número curto que aparece na " +
          "comanda — esse é o order_index, e o endpoint de detalhe não aceita.",
      },
      { status: 502 }
    );
  }

  const p = traduzirPedido99Food(r.data);

  const existente = await prisma.customerOrder.findFirst({
    where: { openDeliveryOrderId: p.orderId || orderId },
    select: { id: true, dailyOrderNumber: true },
  });
  if (existente) {
    return NextResponse.json({
      ok: true,
      jaExistia: true,
      pedido: existente,
      mensagem: `Este pedido já estava no sistema (#${existente.dailyOrderNumber}).`,
    });
  }

  const items = p.itens.map((i: ItemTraduzido) => ({
    price: i.precoUnitario,
    quantity: i.quantidade,
    comboSelections:
      i.complementos.length > 0 || i.observacao
        ? JSON.stringify([
            ...i.complementos,
            ...(i.observacao ? [{ name: `Obs: ${i.observacao}`, quantity: 1, price: 0 }] : []),
          ])
        : null,
    menuProduct: {
      connectOrCreate: {
        where: { id: `99food_${lojaId}_${i.nome}`.slice(0, 190) },
        create: {
          id: `99food_${lojaId}_${i.nome}`.slice(0, 190),
          name: i.nome,
          price: i.precoUnitario,
          description: "",
          category: "99Food",
          franchiseeId: lojaId,
        },
      },
    },
  }));

  const criado = await (prisma.customerOrder as any).create({
    data: {
      franchiseeId: lojaId,
      dailyOrderNumber: await generateDailyOrderNumber(lojaId),
      customerName: p.cliente.nome,
      customerPhone: p.cliente.telefone,
      customerAddress: p.cliente.endereco,
      status: "NOVO",
      paymentMethod: p.pagamento.texto,
      totalAmount: p.total,
      deliveryFee: p.taxaEntrega,
      notes: p.observacoes,
      source: "99FOOD",
      openDeliveryOrderId: p.orderId || orderId,
      openDeliveryReference: p.numeroNoParceiro,
      openDeliveryChannel: "99FOOD",
      deliveryBy: p.entreguePor,
      items: { create: items },
    },
    select: { id: true, dailyOrderNumber: true, totalAmount: true, customerName: true },
  });

  console.log(`[99Food] Pedido ${orderId} importado manualmente para a loja ${lojaId}`);

  return NextResponse.json({
    ok: true,
    jaExistia: false,
    pedido: criado,
    traduzido: {
      numeroNoParceiro: p.numeroNoParceiro,
      total: p.total,
      taxaEntrega: p.taxaEntrega,
      entreguePor: p.entreguePor,
      pagamento: p.pagamento,
      itens: p.itens.map((i) => ({ nome: i.nome, qtd: i.quantidade, precoUn: i.precoUnitario })),
    },
    mensagem: `Pedido #${criado.dailyOrderNumber} criado a partir do 99Food.`,
  });
}
