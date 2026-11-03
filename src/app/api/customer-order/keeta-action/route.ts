/**
 * POST /api/customer-order/keeta-action — o lojista responde, pelo FireHub, o
 * pedido de reembolso que o cliente abriu na Keeta (USER_REFUND_REQUEST, que
 * lib/keeta/eventos.ts põe em `cancelDispute` e o quadro abre na janela de
 * disputa, como no iFood).
 *
 *   { orderId, acao: "accept_refund" }                    → acceptRefund
 *   { orderId, acao: "deny_refund", reason, code? }       → rejectRefund
 *
 * O `code` da recusa é o da Keeta (DISH_ALREADY_DONE, OUT_FOR_DELIVERY, OTHER);
 * sem ele vai OTHER, com o texto do lojista. O pedido não muda de status: o
 * resultado vem nos eventos REFUNDED / REFUND_FAILED.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { lojasDaVisao, cookieDaVisao } from "@/lib/loja-ativa";
import { prisma } from "@/lib/prisma";
import { acaoNoPedidoKeeta } from "@/lib/keeta/api";
import { idNaKeeta } from "@/lib/keeta/status";

const CODIGOS = ["DISH_ALREADY_DONE", "OUT_FOR_DELIVERY", "OTHER"];

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const corpo = (await req.json().catch(() => ({}))) as { orderId?: string; acao?: string; reason?: string; code?: string };
  const acao = corpo.acao;
  if (!corpo.orderId || (acao !== "accept_refund" && acao !== "deny_refund")) {
    return NextResponse.json({ error: "orderId e acao (accept_refund | deny_refund) são obrigatórios" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true, ownerId: true, role: true } });
  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  const { lojaIds } = await lojasDaVisao(user, await cookieDaVisao()).catch(() => ({ lojaIds: [user.ownerId || user.id] }));

  // Só pedido da Keeta: o openDeliveryOrderId é de vários canais.
  const pedido: any = await (prisma.customerOrder as any).findFirst({
    where: { id: corpo.orderId, openDeliveryChannel: "KEETA" },
    select: { id: true, franchiseeId: true, openDeliveryOrderId: true, cancelDispute: true, notes: true },
  });
  if (!pedido?.openDeliveryOrderId) return NextResponse.json({ error: "Pedido da Keeta não encontrado" }, { status: 404 });
  if (user.role !== "ADMIN" && !lojaIds.includes(pedido.franchiseeId)) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const motivo = String(corpo.reason || "").trim().slice(0, 300) || "Pedido entregue conforme solicitado";
  const code = CODIGOS.includes(String(corpo.code)) ? String(corpo.code) : "OTHER";
  const r =
    acao === "accept_refund"
      ? await acaoNoPedidoKeeta(pedido.franchiseeId, "acceptRefund", idNaKeeta(pedido.openDeliveryOrderId))
      : await acaoNoPedidoKeeta(pedido.franchiseeId, "rejectRefund", idNaKeeta(pedido.openDeliveryOrderId), { reason: motivo, code });
  if (!r.ok) {
    console.error(`[Keeta] ❌ ${acao} em ${pedido.openDeliveryOrderId}: ${r.erro}`);
    return NextResponse.json({ error: `A Keeta recusou a resposta: ${r.erro}. Responda pelo Portal da Keeta.` }, { status: 502 });
  }

  const linha = acao === "accept_refund" ? "✅ Reembolso aceito pela loja (FireHub)" : `✋ Reembolso recusado pela loja (FireHub): ${motivo}`;
  await (prisma.customerOrder as any).update({
    where: { id: pedido.id },
    data: {
      cancelDispute: { ...(pedido.cancelDispute || {}), pending: false, resolved: acao === "accept_refund" ? "accepted_refund" : "denied" },
      notes: String(pedido.notes || "").includes(linha) ? pedido.notes : [pedido.notes, linha].filter(Boolean).join("\n"),
    },
  });
  console.log(`[Keeta] ${acao} em ${pedido.openDeliveryOrderId} por ${session.user.email}`);
  return NextResponse.json({ ok: true });
}
