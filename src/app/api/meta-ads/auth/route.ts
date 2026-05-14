/**
 * GET /api/meta-ads/auth
 * Inicia o fluxo OAuth — redireciona o franqueado para o Facebook
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { getMetaOAuthUrl } from "@/lib/meta-ads";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const franchiseeId = (session.user as any).id;
  const url = getMetaOAuthUrl(franchiseeId);
  return NextResponse.redirect(url);
}
