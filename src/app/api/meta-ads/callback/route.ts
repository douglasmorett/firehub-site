/**
 * GET /api/meta-ads/callback
 * Meta OAuth callback — salva token do franqueado e redireciona para wizard de criativo
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exchangeCodeForToken, getMetaAccounts } from "@/lib/meta-ads";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code  = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  const rawBase = process.env.NEXTAUTH_URL || "";
  const baseUrl = (rawBase && !rawBase.includes("[SENSITIVE]") && rawBase.startsWith("http"))
    ? rawBase.replace(/\/$/, "")
    : "https://firehubfood.com.br";

  if (error) {
    return NextResponse.redirect(
      `${baseUrl}/store/meta-ads?error=facebook_denied`
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(
      `${baseUrl}/store/meta-ads?error=missing_params`
    );
  }

  try {
    const parsed = JSON.parse(Buffer.from(state, "base64").toString());
    const { franchiseeId, investment } = parsed;

    const accessToken = await exchangeCodeForToken(code);
    const { accounts, pages } = await getMetaAccounts(accessToken);

    const adAccountId = accounts[0]?.id ?? null;
    const pageId = pages[0]?.id ?? null;

    // Salva token e conta
    await prisma.user.update({
      where: { id: franchiseeId },
      data: {
        metaFbAccessToken: accessToken,
        metaAdAccountId: adAccountId,
        metaFbPageId: pageId,
        metaAdsEnabled: true,
      },
    });

    // Redireciona para o wizard de criativo (NÃO cria campanha automaticamente)
    const budgetParam = investment ? `&budget=${investment}` : "";
    return NextResponse.redirect(
      `${baseUrl}/store/meta-ads?connected=true${budgetParam}`
    );
  } catch (err) {
    console.error("[MetaAds OAuth]", err);
    return NextResponse.redirect(
      `${baseUrl}/store/meta-ads?error=token_exchange_failed`
    );
  }
}
