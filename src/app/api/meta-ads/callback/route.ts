/**
 * GET /api/meta-ads/callback
 * Meta OAuth callback — salva token do franqueado e redireciona para o painel
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exchangeCodeForToken, getMetaAccounts } from "@/lib/meta-ads";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code  = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  if (error) {
    return NextResponse.redirect(
      `${process.env.NEXTAUTH_URL}/store/meta-ads?error=facebook_denied`
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(
      `${process.env.NEXTAUTH_URL}/store/meta-ads?error=missing_params`
    );
  }

  try {
    const { franchiseeId } = JSON.parse(Buffer.from(state, "base64").toString());
    const accessToken = await exchangeCodeForToken(code);
    const { accounts, pages } = await getMetaAccounts(accessToken);

    // Salva o token e a primeira conta/página disponível
    await prisma.user.update({
      where: { id: franchiseeId },
      data: {
        metaFbAccessToken: accessToken,
        metaAdAccountId: accounts[0]?.id ?? null,
        metaFbPageId: pages[0]?.id ?? null,
        metaAdsEnabled: true,
      },
    });

    return NextResponse.redirect(
      `${process.env.NEXTAUTH_URL}/store/meta-ads?connected=true`
    );
  } catch (err) {
    console.error("[MetaAds OAuth]", err);
    return NextResponse.redirect(
      `${process.env.NEXTAUTH_URL}/store/meta-ads?error=token_exchange_failed`
    );
  }
}
