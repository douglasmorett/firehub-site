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
