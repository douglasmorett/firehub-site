/**
 * GET /api/meta-ads/auth
 * Inicia o fluxo OAuth do Meta — o servidor monta a URL e redireciona.
 *
 * A tela NÃO monta mais essa URL. Antes ela fazia
 *     btoa(JSON.stringify({ franchiseeId: user.id, investment }))
 * no navegador, e o callback confiava nesse valor para escolher em qual loja
 * gravar o token — bastava trocar o id em base64 para desviar a conexão de
 * outro lojista. Agora a loja vem da SESSÃO e o state é assinado no servidor.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { getMetaOAuthUrl } from "@/lib/meta-ads";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const franchiseeId = (session.user as any).id as string | undefined;
  if (!franchiseeId) {
    return NextResponse.json({ error: "Sessão sem loja associada" }, { status: 401 });
  }

  // O orçamento é só uma preferência de tela para retomar o wizard depois da
  // volta do Facebook; é limitado para não virar entrada arbitrária no state.
  const bruto = Number(req.nextUrl.searchParams.get("investment"));
  const investment =
    Number.isFinite(bruto) && bruto > 0 ? Math.min(Math.round(bruto), 100_000) : undefined;

  return NextResponse.redirect(getMetaOAuthUrl(franchiseeId, investment));
}
