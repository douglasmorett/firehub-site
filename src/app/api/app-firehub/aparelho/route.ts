/**
 * POST   /api/app-firehub/aparelho  { pushToken, plataforma, versaoDoApp }
 * DELETE /api/app-firehub/aparelho  { pushToken }
 *
 * O app FireHub registra aqui o celular da loja para receber o aviso de
 * pedido novo com o app fechado (lib/app-firehub/aparelhos.ts). A loja sai
 * SEMPRE da sessão assinada — nunca do corpo.
 */
import { NextRequest, NextResponse } from "next/server";
import { exigirUsuarioDoApp } from "@/lib/app-firehub/sessao";
import { checkRateLimit } from "@/lib/rateLimit";
import { esquecerAparelhoDaLoja, registrarAparelhoDaLoja, tokenDeNotificacaoValido } from "@/lib/app-firehub/aparelhos";
import { lojaGanhouAparelho } from "@/lib/app-firehub/aviso-de-pedido";

const SESSAO_EXPIRADA = { error: "Sessão expirada. Entre de novo.", precisaLogin: true };

export async function POST(req: NextRequest) {
  try {
    const u = await exigirUsuarioDoApp(req);
    if (!u) return NextResponse.json(SESSAO_EXPIRADA, { status: 401 });

    const rl = checkRateLimit(`app-firehub-aparelho:${u.userId}`, { windowMs: 60_000, maxRequests: 10 });
    if (!rl.allowed) return NextResponse.json({ error: "Aguarde um instante." }, { status: 429 });

    const { pushToken, plataforma, versaoDoApp } = await req.json().catch(() => ({} as any));
    if (!tokenDeNotificacaoValido(pushToken)) {
      return NextResponse.json({ error: "Token de notificação inválido." }, { status: 400 });
    }

    const gravou = await registrarAparelhoDaLoja({ userId: u.userId, lojaId: u.lojaId, pushToken, plataforma, versaoDoApp });
    if (!gravou) return NextResponse.json({ error: "Não consegui registrar o aparelho agora." }, { status: 503 });
    lojaGanhouAparelho(u.lojaId);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("[App FireHub Aparelho POST]", err?.message);
    return NextResponse.json({ error: "Erro ao registrar o aparelho" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    // O token de notificação só existe dentro do aparelho: quem o tem É o
    // aparelho, mesmo com a sessão já morta (senha trocada).
    const { pushToken } = await req.json().catch(() => ({} as any));
    if (tokenDeNotificacaoValido(pushToken)) await esquecerAparelhoDaLoja(pushToken);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("[App FireHub Aparelho DELETE]", err?.message);
    return NextResponse.json({ error: "Erro ao esquecer o aparelho" }, { status: 500 });
  }
}
