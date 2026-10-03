/**
 * POST   /api/app-motoboy/aparelho  { pushToken, plataforma, versaoDoApp }
 * DELETE /api/app-motoboy/aparelho  { pushToken }
 *
 * O app nativo do entregador (apps/motoboy) registra aqui o celular para
 * receber o aviso de pedido novo com o app fechado (lib/app-motoboy/aparelhos.ts).
 * Quem é o entregador sai SEMPRE da sessão assinada — nunca do corpo.
 */
import { NextRequest, NextResponse } from "next/server";
import { exigirMotoboy } from "@/lib/motoboy-sessao";
import { checkRateLimit } from "@/lib/rateLimit";
import { esquecerAparelho, registrarAparelho, tokenDeNotificacaoValido } from "@/lib/app-motoboy/aparelhos";

const SESSAO_EXPIRADA = { error: "Sessão expirada. Entre de novo.", precisaLogin: true, precisaRelogar: true };

export async function POST(req: NextRequest) {
  try {
    const mb = await exigirMotoboy(req);
    if (!mb) return NextResponse.json(SESSAO_EXPIRADA, { status: 401 });

    const rl = checkRateLimit(`motoboy-aparelho:${mb.id}`, { windowMs: 60_000, maxRequests: 10 });
    if (!rl.allowed) return NextResponse.json({ error: "Aguarde um instante." }, { status: 429 });

    const { pushToken, plataforma, versaoDoApp } = await req.json().catch(() => ({} as any));
    if (!tokenDeNotificacaoValido(pushToken)) {
      return NextResponse.json({ error: "Token de notificação inválido." }, { status: 400 });
    }

    const gravou = await registrarAparelho({ motoboyId: mb.id, lojaId: mb.franchiseeId, pushToken, plataforma, versaoDoApp });
    if (!gravou) return NextResponse.json({ error: "Não consegui registrar o aparelho agora." }, { status: 503 });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("[App Motoboy Aparelho POST]", err?.message);
    return NextResponse.json({ error: "Erro ao registrar o aparelho" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    // A sessão pode já estar morta (senha trocada, cadastro desativado) e o
    // celular continuaria recebendo os avisos de quem saiu. O token só existe
    // dentro do aparelho, então quem o tem É o aparelho: apaga por ele.
    const mb = await exigirMotoboy(req);
    const { pushToken } = await req.json().catch(() => ({} as any));
    if (tokenDeNotificacaoValido(pushToken)) await esquecerAparelho(pushToken, mb?.id);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("[App Motoboy Aparelho DELETE]", err?.message);
    return NextResponse.json({ error: "Erro ao esquecer o aparelho" }, { status: 500 });
  }
}
