/**
 * Edição de um pedido JÁ LANÇADO numa mesa aberta.
 *
 * O garçom lança errado, o cliente muda de ideia, a cozinha avisa que acabou —
 * e até aqui a única saída era fechar a conta com item que ninguém consumiu
 * (ou cancelar a sessão inteira). O painel de mesas mostrava os pedidos como
 * leitura pura.
 *
 * PATCH  { itens: [{ itemId, quantity }], removerItemIds: [...] }
 *        → muda quantidades e/ou remove itens; o total do pedido é RECALCULADO
 *          do que sobrou (nunca editado à mão). Se não sobrar item nenhum, o
 *          pedido inteiro é cancelado — pedido de total zero e zero itens é a
 *          classe de fantasma que o schema já documenta.
 * DELETE → cancela o pedido inteiro e DEVOLVE o estoque baixado (a devolução
 *          usa as baixas registradas, não a ficha técnica de hoje).
 *
 * Guardas, nesta ordem: sessão do painel → mesa da MINHA loja → sessão ainda
 * OPEN → pedido DESTA sessão → pedido ainda vivo. Mesa fechada não se edita:
 * a conta já virou pagamento; corrigir depois é estorno, outro fluxo.
 *
 * Estoque em edição PARCIAL não é mexido de propósito: a devolução registrada
 * é por PEDIDO, e devolver "proporcional" pela ficha técnica de hoje devolveria
 * a receita atual, que pode ter mudado desde a baixa. Reduzir quantidade não
 * devolve insumo — cancelar o pedido devolve tudo. Está documentado na tela.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolverOperadorDaMesa } from "@/lib/garcom-auth";
import { STATUS_CANCELADOS, STATUS_FINALIZADOS } from "@/lib/status-pedido";

async function contexto(req: NextRequest, params: Promise<{ id: string; orderId: string }>) {
  // Sessão do painel OU cookie do garçom pelo link (src/lib/garcom-auth.ts):
  // corrigir o que acabou de lançar na mesa é trabalho do garçom.
  const operador = await resolverOperadorDaMesa();
  if (!operador) return { erro: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) };
  const lojaId = operador.franchiseeId;

  const { id, orderId } = await params;
  const tableSession = await prisma.tableSession.findUnique({
    where: { id },
    select: { id: true, status: true, franchiseeId: true, table: { select: { number: true } } },
  });
  if (!tableSession || tableSession.franchiseeId !== lojaId) {
    return { erro: NextResponse.json({ error: "Mesa não encontrada" }, { status: 404 }) };
  }
  if (tableSession.status !== "OPEN") {
    return { erro: NextResponse.json({ error: "Esta mesa já foi fechada — a conta virou pagamento. Ajustes agora são estorno, fale com o caixa." }, { status: 409 }) };
  }

  const order = await prisma.customerOrder.findFirst({
    where: { id: orderId, tableSessionId: id, franchiseeId: lojaId },
    include: { items: { select: { id: true, quantity: true, price: true } } },
  });
  if (!order) return { erro: NextResponse.json({ error: "Pedido não encontrado nesta mesa" }, { status: 404 }) };
  if ((STATUS_CANCELADOS as readonly string[]).includes(order.status)) {
    return { erro: NextResponse.json({ error: "Este pedido já foi cancelado" }, { status: 409 }) };
  }
  if ((STATUS_FINALIZADOS as readonly string[]).includes(order.status)) {
    return { erro: NextResponse.json({ error: "Este pedido já foi finalizado" }, { status: 409 }) };
  }

  return { lojaId, order };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; orderId: string }> }
) {
  try {
    const ctx = await contexto(req, params);
    if ("erro" in ctx) return ctx.erro;
    const { order } = ctx;

    const body = await req.json().catch(() => ({} as any));
    const itens: { itemId: string; quantity: number }[] = Array.isArray(body?.itens) ? body.itens : [];
    const removerItemIds: string[] = Array.isArray(body?.removerItemIds) ? body.removerItemIds.map(String) : [];

    if (itens.length === 0 && removerItemIds.length === 0) {
      return NextResponse.json({ error: "Nada para alterar" }, { status: 400 });
    }

    // Só itens DESTE pedido — id de item de outro pedido no corpo não pode
    // alcançar nada.
    const idsDoPedido = new Set(order.items.map((i) => i.id));
    const remover = removerItemIds.filter((rid) => idsDoPedido.has(rid));
    const mudar = itens
      .filter((m) => m && idsDoPedido.has(String(m.itemId)) && !remover.includes(String(m.itemId)))
      .map((m) => ({ itemId: String(m.itemId), quantity: Math.floor(Number(m.quantity)) }))
      .filter((m) => Number.isFinite(m.quantity) && m.quantity >= 1 && m.quantity <= 99);

    // O estado final que o pedido terá — calculado ANTES de escrever, porque
    // "sobrou zero item" muda a operação inteira (vira cancelamento).
    const finais = order.items
      .filter((i) => !remover.includes(i.id))
      .map((i) => ({ ...i, quantity: mudar.find((m) => m.itemId === i.id)?.quantity ?? i.quantity }));

    if (finais.length === 0) {
      // Removeu tudo = cancelou o pedido. Mesma via do DELETE, com devolução
      // de estoque — um pedido sem itens não pode continuar valendo dinheiro.
      return cancelarPedido(order.id);
    }

    const novoTotal = finais.reduce((s, i) => s + Number(i.price) * i.quantity, 0);

    await prisma.$transaction(async (tx) => {
      for (const rid of remover) {
        await tx.customerOrderItem.delete({ where: { id: rid } });
      }
      for (const m of mudar) {
        await tx.customerOrderItem.update({ where: { id: m.itemId }, data: { quantity: m.quantity } });
      }
      await tx.customerOrder.update({
        where: { id: order.id },
        data: { totalAmount: novoTotal },
      });
    });

    console.log(
      `[Mesa Editar] pedido ${order.id}: ${remover.length} item(ns) removido(s), ` +
      `${mudar.length} quantidade(s) alterada(s), total ${order.totalAmount} → ${novoTotal}`
    );
    return NextResponse.json({ success: true, totalAmount: novoTotal });
  } catch (error: any) {
    console.error("[Table Session Order PATCH]", error);
    return NextResponse.json({ error: "Erro ao editar o pedido" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; orderId: string }> }
) {
  try {
    const ctx = await contexto(req, params);
    if ("erro" in ctx) return ctx.erro;
    return cancelarPedido(ctx.order.id);
  } catch (error: any) {
    console.error("[Table Session Order DELETE]", error);
    return NextResponse.json({ error: "Erro ao cancelar o pedido" }, { status: 500 });
  }
}

async function cancelarPedido(orderId: string) {
  // A grafia é CANCELADO — a que o resto do sistema grava e filtra.
  await prisma.customerOrder.update({
    where: { id: orderId },
    data: { status: "CANCELADO", cancelledBy: "LOJA", cancelReason: "Cancelado na mesa pelo painel" },
  });

  // Devolve o insumo baixado no lançamento. Usa as BAIXAS registradas do
  // pedido — nunca a ficha técnica de hoje, que pode ter mudado desde então.
  try {
    const { restoreStockForOrder } = await import("@/lib/stock");
    restoreStockForOrder(orderId).catch((e: any) =>
      console.error(`[Mesa Editar] devolução de estoque falhou para ${orderId}:`, e?.message)
    );
  } catch {}

  console.log(`[Mesa Editar] pedido ${orderId} cancelado pelo painel de mesas`);
  return NextResponse.json({ success: true, cancelado: true });
}
