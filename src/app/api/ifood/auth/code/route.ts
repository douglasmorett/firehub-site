/**
 * POST /api/ifood/auth/code
 * Gera o userCode que o lojista digita no Portal do Parceiro
 * em portal.ifood.com.br/apps/code para vincular a loja ao app FireHub.
 *
 * Fluxo "Distributed Application" da iFood Merchant API:
 * 1. Nossa API chama POST /authentication/v1.0/oauth/userCode  (só clientId, SEM clientSecret)
 * 2. iFood retorna { userCode, verificationUrl, authorizationCodeVerifier }
 * 3. Mostramos o userCode ao lojista
 * 4. Lojista entra em portal.ifood.com.br/apps/code e digita o userCode
 * 5. Nossa API troca o authorizationCode + verifier pelo accessToken final
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const AUTH_BASE = "https://merchant-api.ifood.com.br/authentication/v1.0";

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const clientId = process.env.IFOOD_CLIENT_ID;

  if (!clientId) {
    return NextResponse.json({ error: "IFOOD_CLIENT_ID não configurado" }, { status: 500 });
  }

  try {
    // ⚠️ iFood userCode endpoint aceita APENAS clientId — não enviar clientSecret aqui
    const res = await fetch(`${AUTH_BASE}/oauth/userCode`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ clientId }),
    });

    const rawText = await res.text();
    let data: any = {};
    try { data = JSON.parse(rawText); } catch { data = { raw: rawText }; }

    if (!res.ok) {
      console.error(`[iFood userCode] HTTP ${res.status}:`, rawText.slice(0, 500));
      return NextResponse.json(
        {
          error: `iFood retornou ${res.status}`,
          details: data,
          hint: res.status === 400
            ? "O app pode estar registrado como 'Centralizado' no iFood — apps centralizados não suportam o fluxo userCode. Verifique o tipo do app em developer.ifood.com.br."
            : undefined,
        },
        { status: res.status }
      );
    }

    if (data.authorizationCodeVerifier) {
      await prisma.user.update({
        where: { id: session.user.id },
        data: { ifoodAuthVerifier: data.authorizationCodeVerifier },
      });
    }

    return NextResponse.json({
      success:  true,
      userCode: data.userCode,
      verifier: data.authorizationCodeVerifier,
      expiresIn: data.expiresIn,
    });
  } catch (err: any) {
    console.error("[iFood userCode]", err.message);
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
