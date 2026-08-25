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
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { appEscolhido, clientIdDoApp, ErroCredencialApp } from "@/lib/ifood-app";

const AUTH_BASE = "https://merchant-api.ifood.com.br/authentication/v1.0";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  // ?app=homologacao gera o código pelo APLICATIVO DE TESTE. A homologação
  // precisa ser gravada com ele, e o código de ativação de um aplicativo não
  // serve para outro — gerar pelo app errado dá um código que a loja de teste
  // aceita e que não autoriza nada de útil.
  const corpo = await req.json().catch(() => ({}));
  const app = appEscolhido(
    new URL(req.url).searchParams.get("app") ?? corpo?.app ?? null,
  );

  let clientId: string;
  try {
    clientId = clientIdDoApp(app);
  } catch (e: any) {
    if (e instanceof ErroCredencialApp) {
      return NextResponse.json({ error: e.message, hint: e.hint }, { status: 503 });
    }
    throw e;
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

    if (data.authorizationCodeVerifier && session.user?.email) {
      try {
        await prisma.user.update({
          where: { email: session.user.email },
          data: { ifoodAuthVerifier: data.authorizationCodeVerifier },
        });
      } catch (e: any) {
        console.warn("[iFood userCode] aviso ao salvar verifier:", e?.message);
      }
    }

    const verificationUrl = data.verificationUrlComplete || data.verificationUrl || `https://portal.ifood.com.br/apps/code?c=${data.userCode}`;

    return NextResponse.json({
      success:  true,
      app,
      userCode: data.userCode,
      verificationUrl,
      verifier: data.authorizationCodeVerifier,
      expiresIn: data.expiresIn,
    });
  } catch (err: any) {
    console.error("[iFood userCode]", err.message);
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
