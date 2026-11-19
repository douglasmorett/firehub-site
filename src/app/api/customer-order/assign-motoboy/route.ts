/**
 * PATCH /api/customer-order/assign-motoboy
 * Atribui ou remove um motoboy de um pedido e envia notificação no WhatsApp do entregador com o número do FireHub (#171).
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { lojasDaVisao, cookieDaVisao } from "@/lib/loja-ativa";
// A troca em si (histórico, app e WhatsApp do entregador) mora em
// lib/atribuir-motoboy-ao-pedido.ts: o Bill passa pelo mesmo caminho.
import { atribuirMotoboyAoPedido, CAMPOS_DO_PEDIDO_ALVO } from "@/lib/atribuir-motoboy-ao-pedido";

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { orderId, motoboyId, firehubOrderNumber } = await req.json();
  if (!orderId) return NextResponse.json({ error: "orderId obrigatório" }, { status: 400 });

  // ── O PEDIDO PRECISA SER DESTA LOJA ───────────────────────────────────────
  //
  // Só se conferia "existe sessão". Qualquer conta logada mandava o id de um
  // pedido de OUTRA loja e atribuía um motoboy a ele — inclusive um motoboy
  // que não é da loja dona do pedido, disparando WhatsApp em nome dela.
  const usuario = await prisma.user.findUnique({
    where: { email: session.user?.email || "" },
    select: { id: true, ownerId: true, role: true, name: true, email: true },
  });
  if (!usuario) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  const lojaDaSessao = usuario.ownerId || usuario.id;

  const pedidoAlvo = await prisma.customerOrder.findUnique({
    where: { id: orderId },
    select: CAMPOS_DO_PEDIDO_ALVO,
  });
  if (!pedidoAlvo) return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
  // Em "Todas as Lojas" (cookie "all", lib/loja-ativa.ts) vale o grupo: a
  // Annalu não conseguia pôr o motoboy no pedido da PasteLê sem trocar para a
  // página da PasteLê (30/10/2026). O motoboy continua tendo de ser da loja DO
  // PEDIDO (abaixo): o app dele lista só os pedidos da loja dele.
  const { lojaIds } = await lojasDaVisao(usuario, await cookieDaVisao()).catch(() => ({
    lojaIds: [lojaDaSessao],
  }));
  if (usuario.role !== "ADMIN" && !lojaIds.includes(String(pedidoAlvo.franchiseeId))) {
    console.warn(`[assign-motoboy] 🚫 ${usuario.id} tentou mexer no pedido ${orderId} da loja ${pedidoAlvo.franchiseeId}.`);
    return NextResponse.json({ error: "Este pedido não é desta loja" }, { status: 403 });
  }

  return atribuirMotoboyAoPedido({ orderId, motoboyId, firehubOrderNumber, pedidoAlvo, usuario });
}
