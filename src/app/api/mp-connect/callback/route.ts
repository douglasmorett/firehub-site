/**
 * GET /api/mp-connect/callback
 * Callback do OAuth do Mercado Pago Marketplace
 * Recebe o code, troca por access_token e salva no User
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { exchangeMpOAuthCode } from "@/lib/mercadopago";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions).catch(() => null);
  if (!session?.user?.email) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const code = req.nextUrl.searchParams.get("code");
  if (!code) {
    return NextResponse.redirect(new URL("/store/integracoes?mp_error=no_code", req.url));
  }

  // ── O `state` DECIDE SE ESTE RETORNO É LEGÍTIMO ──────────────────────────
  //
  // Sem esta conferência, o callback gravava o token de QUALQUER `code` na
  // conta de QUEM ESTIVESSE LOGADO. O ataque é de um clique: o fraudador
  // inicia o OAuth com a conta Mercado Pago DELE, guarda o `code` e faz o
  // lojista abrir esse endereço (link no WhatsApp, imagem num site). A conta
  // de recebimento da loja vira a do fraudador e todo pagamento dos clientes
  // passa a cair para ele — sem o lojista perceber.
  //
  // Agora o retorno só vale com o state assinado por NÓS, dentro da validade,
  // e emitido para a MESMA loja que está na sessão.
  const { lerState } = await import("@/lib/meta-oauth-state");
  const conferido = lerState(req.nextUrl.searchParams.get("state"));
  if (!conferido.ok) {
    console.warn(`[MP Connect] 🚫 state recusado (${conferido.motivo}).`);
    return NextResponse.redirect(new URL("/store/integracoes?mp_error=state_invalido", req.url));
  }

  const usuarioDaSessao = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true },
  });
  const lojaDaSessao = usuarioDaSessao?.ownerId || usuarioDaSessao?.id;
  if (!lojaDaSessao || conferido.dados.franchiseeId !== lojaDaSessao) {
    console.error(
      `[MP Connect] 🚨 Conexão recusada: state emitido para a loja ${conferido.dados.franchiseeId}, ` +
      `mas a sessão é da loja ${lojaDaSessao}.`
    );
    return NextResponse.redirect(new URL("/store/integracoes?mp_error=loja_divergente", req.url));
  }

  try {
    const { accessToken, refreshToken, mpUserId } = await exchangeMpOAuthCode(code);

    await prisma.user.update({
      where: { email: session.user.email },
      data: {
        mpSellerId: mpUserId,
        mpAccessToken: accessToken,
        mpRefreshToken: refreshToken,
      },
    });

    return NextResponse.redirect(new URL("/store/integracoes?mp_connected=true", req.url));
  } catch (err: any) {
    console.error("[MP Connect] OAuth error:", err.message);
    return NextResponse.redirect(new URL(`/store/integracoes?mp_error=${encodeURIComponent(err.message)}`, req.url));
  }
}
