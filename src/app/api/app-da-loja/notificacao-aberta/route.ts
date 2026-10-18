/**
 * POST /api/app-da-loja/notificacao-aberta  { envioId, instalacaoId }
 *
 * O app próprio da loja avisa que o cliente TOCOU na notificação de promoção
 * (apps/loja/src/app/_layout.tsx). É a "taxa de abertura" de cada envio na
 * tela Meu aplicativo (lib/app-da-loja/notificacoes.ts `registrarToque`).
 * Pública como a abertura: limite por IP e por instalação, um toque por
 * instalação e envio, e só envio dos últimos 7 dias.
 */
import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { instalacaoValida } from "@/lib/app-da-loja/instalacoes";
import { registrarToque } from "@/lib/app-da-loja/notificacoes";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    if (!checkRateLimit(`app-loja-toque-ip:${getClientIp(req)}`, { windowMs: 60_000, maxRequests: 60 }).allowed) {
      return NextResponse.json({ error: "Aguarde um instante." }, { status: 429 });
    }
    const { envioId, instalacaoId } = await req.json().catch(() => ({} as any));
    if (typeof envioId !== "string" || !/^[0-9a-f-]{36}$/i.test(envioId) || !instalacaoValida(instalacaoId)) {
      return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
    }
    if (!checkRateLimit(`app-loja-toque:${instalacaoId}`, { windowMs: 60_000, maxRequests: 10 }).allowed) {
      return NextResponse.json({ error: "Aguarde um instante." }, { status: 429 });
    }
    await registrarToque(envioId, instalacaoId);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[App da Loja Toque POST]", err?.message);
    return NextResponse.json({ error: "Erro ao registrar" }, { status: 500 });
  }
}
