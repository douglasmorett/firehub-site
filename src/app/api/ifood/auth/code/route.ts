/**
 * POST /api/ifood/auth/code
 * Gera o userCode (ex: "LHQX-ZZZZ") que o lojista digita no Portal do Parceiro
 * em portal.ifood.com.br/apps/code para vincular a loja ao app FireHub.
 *
 * Fluxo "Distributed Application" da iFood Merchant API:
 * 1. Nossa API chama POST /authentication/v1.0/oauth/userCode
 * 2. iFood retorna { userCode, verificationUrl, authorizationCodeVerifier }
 * 3. Mostramos o userCode ao lojista
 * 4. Lojista entra em portal.ifood.com.br/apps/code e digita o userCode
 * 5. Portal do Parceiro exibe o authorizationCode
 * 6. Lojista cola o authorizationCode no nosso sistema
 * 7. Nossa API troca o authorizationCode + verifier pelo accessToken final
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

const AUTH_BASE = "https://merchant-api.ifood.com.br/authentication/v1.0";

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const clientId     = process.env.IFOOD_CLIENT_ID;
  const clientSecret = process.env.IFOOD_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: "Credenciais iFood não configuradas" }, { status: 500 });
  }

  try {
    const res = await fetch(`${AUTH_BASE}/oauth/userCode`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ clientId, clientSecret }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return NextResponse.json(
        { error: `iFood ${res.status}`, details: data },
        { status: res.status }
      );
    }

    // userCode   → exibe ao lojista para digitar em portal.ifood.com.br/apps/code
    // verifier   → guardamos no cliente para trocar pelo token final
    return NextResponse.json({
      success:             true,
      userCode:            data.userCode,
      verificationUrl:     data.verificationUrl,
      verifier:            data.authorizationCodeVerifier,
      expiresIn:           data.expiresIn,
    });
  } catch (err: any) {
    console.error("[iFood userCode]", err.message);
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
