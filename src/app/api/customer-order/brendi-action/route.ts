/**
 * POST /api/customer-order/brendi-action
 * Ações Open Delivery que o lojista executa manualmente no dashboard
 * (clone do jotaja-action, com a diferença estrutural da recusa):
 *
 *  - deny:                recusar pedido novo (antes de confirmar)
 *  - accept_cancellation: aceitar cancelamento solicitado pelo cliente
 *  - deny_cancellation:   negar cancelamento solicitado pelo cliente
 *
 * ── Por que `deny` vira requestCancellation ─────────────────────────────────
 * A Brendi NÃO expõe POST /v1/orders/{id}/deny como o JotaJá — o cardápio de
 * endpoints dela é confirm/preparing/readyForPickup/dispatch/delivered/
 * requestCancellation/acceptCancellation/denyCancellation. Recusar um pedido
 * novo, do lado deles, é a loja SOLICITAR o cancelamento com motivo
 * (cancellationCode 501 = "restaurante não pode aceitar", o mesmo código que
 * o deny do JotaJá usa). O wrapper solicitarCancelamentoBrendi já embute o
 * código e o motivo default — código desconhecido nunca sai cru da tela.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Acao = "deny" | "accept_cancellation" | "deny_cancellation";

const ACOES_VALIDAS: Acao[] = ["deny", "accept_cancellation", "deny_cancellation"];

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { orderId, acao, reason } = await req.json() as {
    orderId: string;
    acao: Acao;
    reason?: string;
  };

  if (!orderId || !acao || !ACOES_VALIDAS.includes(acao)) {
    return NextResponse.json({ error: "orderId e acao são obrigatórios" }, { status: 400 });
  }

  // Verifica que o pedido pertence ao franqueado logado — a posse é o que
  // impede uma conta de disparar cancelamento no pedido de outra.
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true },
  });
  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const targetFranchiseeId = user.ownerId || user.id;

  // O dashboard manda o openDeliveryOrderId que tem — e o registro de fallback
  // usa o sufixo `_recovered`. A API da Brendi só conhece o UUID limpo, então
  // ele é normalizado aqui; a busca no banco aceita as duas formas.
  const uuidBrendi = orderId.replace(/_recovered$/, "");

  // O filtro por CANAL é obrigatório: openDeliveryOrderId é compartilhado com
  // JotaJá/99Food, e esta rota só pode agir sobre pedido que é da Brendi —
  // decidir pela presença do campo mandaria requestCancellation para o pedido
  // de outro parceiro (lição da separação por canal, regra 99Food).
  const order: any = await prisma.customerOrder.findFirst({
    where: {
      franchiseeId: targetFranchiseeId,
      openDeliveryChannel: "BRENDI",
      OR: [
        { openDeliveryOrderId: orderId },
        { openDeliveryOrderId: uuidBrendi },
        { openDeliveryOrderId: { startsWith: `${uuidBrendi}_` } },
      ],
    } as any,
    select: { id: true, openDeliveryOrderId: true, cancelDispute: true } as any,
  });
  if (!order) {
    return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
  }

  try {
    const {
      solicitarCancelamentoBrendi,
      aceitarCancelamentoBrendi,
      negarCancelamentoBrendi,
    } = await import("@/lib/brendi-api");

    // Os wrappers nunca lançam: devolvem { ok, erro? }. Falha ao avisar a
    // Brendi vira 502 com o motivo cru — o lojista precisa saber que o canal
    // NÃO recebeu a ação (repetir depois é seguro; os endpoints são idempotentes
    // do ponto de vista do estado final).
    let resultado: { ok: boolean; erro?: string };
    if (acao === "deny") {
      resultado = await solicitarCancelamentoBrendi(uuidBrendi, targetFranchiseeId, reason);
    } else if (acao === "accept_cancellation") {
      resultado = await aceitarCancelamentoBrendi(uuidBrendi, targetFranchiseeId, reason);
    } else {
      resultado = await negarCancelamentoBrendi(uuidBrendi, targetFranchiseeId, reason);
    }

    if (!resultado.ok) {
      console.error(`[Brendi Action] ${acao} falhou: ${resultado.erro}`);
      return NextResponse.json({
        error: `Falha ao executar ação na Brendi: ${resultado.erro || "sem detalhe"}`,
      }, { status: 502 });
    }

    // ── Espelha o estado local no banco ─────────────────────────────────────
    // cancelledBy='LOJA' é gravado JÁ: quando o evento CANCELLED da Brendi
    // chegar pelo feed, o processBrendiEvent preserva 'LOJA' em vez de
    // sobrescrever com 'BRENDI' — sem isso o relatório culparia o canal errado.
    const dbUpdate: any = {};

    if (acao === "deny") {
      // deny = requestCancellation do lado da Brendi; a rigor o desfecho final
      // vem no evento CANCELLED, mas a loja já decidiu — o pedido sai da fila
      // agora, não quando o feed confirmar.
      dbUpdate.status = "CANCELADO";
      dbUpdate.cancelledBy = "LOJA";
      dbUpdate.cancelReason = reason || "Pedido recusado pelo restaurante.";
      dbUpdate.cancelDispute = { pending: false };
    } else if (acao === "accept_cancellation") {
      dbUpdate.status = "CANCELADO";
      dbUpdate.cancelledBy = "LOJA";
      dbUpdate.cancelReason = reason || "Cancelamento aceito pelo restaurante.";
      dbUpdate.cancelDispute = { pending: false };
    } else if (acao === "deny_cancellation") {
      // Encerra a disputa — o pedido continua ativo e segue o fluxo normal.
      dbUpdate.cancelDispute = { pending: false, deniedByStore: true, deniedAt: new Date().toISOString() };
    }

    if (Object.keys(dbUpdate).length > 0) {
      await (prisma.customerOrder as any).update({
        where: { id: order.id },
        data: dbUpdate,
      });
    }

    console.log(`[Brendi Action] ✅ ${acao} — orderId=${uuidBrendi}`);
    return NextResponse.json({ ok: true, acao, orderId: uuidBrendi });

  } catch (err: any) {
    console.error(`[Brendi Action] Erro:`, err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
