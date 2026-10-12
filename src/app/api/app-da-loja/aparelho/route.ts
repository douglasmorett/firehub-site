/**
 * POST   /api/app-da-loja/aparelho  { pushToken, pedidoId, plataforma, versaoDoApp, app }
 * DELETE /api/app-da-loja/aparelho  { pushToken }
 *
 * O app próprio da loja (apps/loja) liga o celular do cliente a cada pedido
 * feito por ele, para avisar "aceito", "saiu para entrega", "entregue"
 * (lib/app-da-loja/aparelhos.ts). Não há sessão de cliente: quem conhece o id
 * do pedido é quem o fez — o mesmo segredo que abre /loja/<slug>/pedido/<id>.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import {
  esquecerAparelhoDoCliente,
  registrarAparelhoNoPedido,
  tokenDeNotificacaoValido,
} from "@/lib/app-da-loja/aparelhos";

/** Pedido velho não recebe mais aviso; ligar aparelho nele não serve para nada. */
const IDADE_MAXIMA_MS = 2 * 24 * 60 * 60 * 1000;

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(`app-loja-aparelho:${ip}`, { windowMs: 60_000, maxRequests: 20 });
    if (!rl.allowed) return NextResponse.json({ error: "Aguarde um instante." }, { status: 429 });

    const { pushToken, pedidoId, plataforma, versaoDoApp, app } = await req.json().catch(() => ({} as any));
    if (!tokenDeNotificacaoValido(pushToken)) {
      return NextResponse.json({ error: "Token de notificação inválido." }, { status: 400 });
    }
    if (typeof pedidoId !== "string" || !/^[A-Za-z0-9_-]{8,40}$/.test(pedidoId)) {
      return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
    }

    const pedido = await prisma.customerOrder.findUnique({
      where: { id: pedidoId },
      select: { id: true, franchiseeId: true, createdAt: true },
    });
    if (!pedido || Date.now() - new Date(pedido.createdAt).getTime() > IDADE_MAXIMA_MS) {
      return NextResponse.json({ error: "Pedido não encontrado." }, { status: 404 });
    }

    const gravou = await registrarAparelhoNoPedido({
      pedidoId: pedido.id,
      lojaId: pedido.franchiseeId,
      pushToken,
      plataforma,
      versaoDoApp,
      app,
    });
    if (!gravou) return NextResponse.json({ error: "Não consegui registrar o aparelho agora." }, { status: 503 });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("[App da Loja Aparelho POST]", err?.message);
    return NextResponse.json({ error: "Erro ao registrar o aparelho" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    // O token só existe dentro do aparelho: quem o manda É o aparelho.
    const { pushToken } = await req.json().catch(() => ({} as any));
    if (tokenDeNotificacaoValido(pushToken)) await esquecerAparelhoDoCliente(pushToken);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("[App da Loja Aparelho DELETE]", err?.message);
    return NextResponse.json({ error: "Erro ao esquecer o aparelho" }, { status: 500 });
  }
}
