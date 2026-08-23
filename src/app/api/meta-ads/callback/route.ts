/**
 * GET /api/meta-ads/callback
 * Retorno do OAuth do Meta — guarda o token de anúncios da loja.
 *
 * ── O QUE ESTAVA ERRADO AQUI ────────────────────────────────────────────────
 * A versão anterior era pública (sem sessão) e lia o `franchiseeId` de um
 * `state` em base64 montado no navegador. Trocando o id no state, o token de
 * anúncios de um lojista — com permissão `ads_management` — era gravado na
 * conta de outra pessoa, que passava a gastar o dinheiro da conta de anúncios
 * da vítima.
 *
 * Agora exige as três coisas ao mesmo tempo:
 *   1. sessão válida;
 *   2. state assinado pelo servidor e dentro da validade;
 *   3. a loja do state igual à loja da sessão.
 *
 * Também deixou de dizer "conectado" quando não conectou: antes, se a troca de
 * código falhasse, `exchangeCodeForToken` devolvia undefined sem lançar, o
 * Prisma ignorava o campo e o registro ficava com `metaAdsEnabled: true` sem
 * token nenhum — e a tela exibia "✅ Facebook conectado!".
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { exchangeCodeForToken, getMetaAccounts } from "@/lib/meta-ads";
import { lerState } from "@/lib/meta-oauth-state";

export const dynamic = "force-dynamic";

function baseDoSite(): string {
  const bruto = process.env.NEXTAUTH_URL || "";
  const ok = bruto && !bruto.includes("[SENSITIVE]") && bruto.startsWith("http");
  return (ok ? bruto : "https://firehubfood.com.br").replace(/\/$/, "");
}

export async function GET(req: NextRequest) {
  const base = baseDoSite();
  const voltarCom = (erro: string) =>
    NextResponse.redirect(`${base}/store/meta-ads?error=${encodeURIComponent(erro)}`);

  const { searchParams } = req.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  if (searchParams.get("error")) return voltarCom("facebook_denied");
  if (!code || !state) return voltarCom("missing_params");

  // 1. Sessão
  const session = await getServerSession(authOptions).catch(() => null);
  const lojaDaSessao = (session?.user as any)?.id as string | undefined;
  if (!lojaDaSessao) return voltarCom("sessao_expirada");

  // 2. Assinatura e validade do state
  const conferido = lerState(state);
  if (!conferido.ok) {
    console.warn(`[MetaAds OAuth] state recusado (${conferido.motivo}) na loja ${lojaDaSessao}`);
    return voltarCom(conferido.motivo === "expirado" ? "link_expirado" : "state_invalido");
  }

  // 3. O state tem que ser DESTA loja
  if (conferido.dados.franchiseeId !== lojaDaSessao) {
    console.error(
      `[MetaAds OAuth] TENTATIVA DE DESVIO: state pede a loja ${conferido.dados.franchiseeId} ` +
      `mas a sessão é da loja ${lojaDaSessao}. Conexão recusada.`
    );
    return voltarCom("loja_divergente");
  }

  try {
    const accessToken = await exchangeCodeForToken(code);
    if (!accessToken) {
      console.error("[MetaAds OAuth] troca de código não devolveu token.");
      return voltarCom("token_exchange_failed");
    }

    const { accounts, pages } = await getMetaAccounts(accessToken);
    const adAccountId = accounts?.[0]?.id ?? null;
    const pageId = pages?.[0]?.id ?? null;

    // Sem conta de anúncios não há como veicular. Guarda o token (a conta pode
    // ser escolhida depois) mas NÃO liga o módulo, para a tela não prometer o
    // que não existe.
    await prisma.user.update({
      where: { id: lojaDaSessao },
      data: {
        metaFbAccessToken: accessToken,
        metaAdAccountId: adAccountId,
        metaFbPageId: pageId,
        metaAdsEnabled: Boolean(adAccountId),
      },
    });

    if (!adAccountId) return voltarCom("sem_conta_de_anuncios");

    const investimento = conferido.dados.investment;
    const extra = investimento ? `&budget=${investimento}` : "";
    return NextResponse.redirect(`${base}/store/meta-ads?connected=true${extra}`);
  } catch (err) {
    console.error("[MetaAds OAuth]", err);
    return voltarCom("token_exchange_failed");
  }
}
