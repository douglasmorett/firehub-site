/**
 * /api/ifood/auth/route.ts
 * Fluxo de autorização de merchant iFood (Authorization Code)
 * GET  ?step=url     → gera URL de autorização para o merchant aprovar
 * POST {code, merchantId} → troca code por token + salva merchantId
 * GET  ?step=test    → testa se o merchantId atual está funcionando
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { getIfoodToken } from "@/lib/ifood-api";
import { prisma } from "@/lib/prisma";

const IFOOD_BASE = "https://merchant-api.ifood.com.br";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const step = req.nextUrl.searchParams.get("step");

  // ── Passo 1: Gera URL de autorização ──────────────────────────────────────
  if (step === "url") {
    const clientId   = process.env.IFOOD_CLIENT_ID;
    const merchantId = process.env.IFOOD_MERCHANT_UUID || "";
    if (!clientId) return NextResponse.json({ error: "IFOOD_CLIENT_ID não configurado" }, { status: 500 });

    // URL de autorização do iFood para o merchant aprovar a conexão
    const authUrl = `https://developer.ifood.com.br/oauth/userAuthorize?client_id=${clientId}&response_type=code&redirect_uri=https://firehubfood.com.br/api/ifood/auth/callback`;

    return NextResponse.json({
      authUrl,
      merchantId,
      clientId,
      instruction: "Abra esta URL no navegador e faça login com a conta iFood da loja de teste para autorizar o acesso.",
    });
  }

  // ── Passo 2: Testa conexão com merchantId atual (com suporte ao banco de dados) ──
  if (step === "test") {
    const email = session.user?.email || "";
    const user = await prisma.user.findUnique({
      where: { email },
      select: { ifoodConnected: true, ifoodMerchantId: true }
    });

    // Se o usuário desconectou explicitamente E não está forçando reconexão, reporta desconectado
    const force = req.nextUrl.searchParams.get("force") === "true";
    const isExplicitlyDisconnected = user && user.ifoodConnected === false;
    if (isExplicitlyDisconnected && !force) {
      return NextResponse.json({ connected: false, message: "Loja desconectada pelo usuário" });
    }

    const merchantId = user?.ifoodMerchantId;
    if (!merchantId) {
      return NextResponse.json({ connected: false, error: "Nenhuma loja iFood conectada." });
    }

    try {
      const token = await getIfoodToken();
      const res   = await fetch(`${IFOOD_BASE}/merchant/v1.0/merchants/${merchantId}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      
      const resOk = res.ok;
      const data = resOk ? await res.json() : await res.text();

      // Se conectou com sucesso e o status no banco ainda era falso/não sincronizado, atualiza para true
      if (resOk && user && !user.ifoodConnected) {
        await prisma.user.update({
          where: { email },
          data: { ifoodConnected: true, ifoodMerchantId: merchantId }
        });
      }

      return NextResponse.json({
        connected: resOk,
        status:    res.status,
        merchantId,
        storeName: resOk ? (data?.name || data?.shortName || "Loja iFood") : null,
        raw:       data,
      });
    } catch (err: any) {
      return NextResponse.json({ connected: false, error: err.message });
    }
  }

  // ── Passo 3: Desconecta a loja do iFood ────────────────────────────────────
  if (step === "disconnect") {
    const email = session.user?.email || "";
    await prisma.user.update({
      where: { email },
      data: { ifoodConnected: false, ifoodMerchantId: null }
    });
    return NextResponse.json({ success: true, connected: false });
  }

  return NextResponse.json({ error: "step inválido. Use ?step=url, ?step=test ou ?step=disconnect" }, { status: 400 });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { authorizationCode } = await req.json();
  if (!authorizationCode) return NextResponse.json({ error: "authorizationCode obrigatório" }, { status: 400 });

  const clientId     = process.env.IFOOD_CLIENT_ID_DISTRIBUTED || "cabc4064-8d01-4bb0-bb5b-ed93963f9a7a";
  const clientSecret = process.env.IFOOD_CLIENT_SECRET_DISTRIBUTED || "2k28s9uil03gobzo6p3gkojim4ffsw9ttu3031veoxm1irbiz53vbzrd50n8wqnywrbvfsurzalevhv4ank4jrrm9wr4xhfcahv";

  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: "Credenciais iFood não configuradas" }, { status: 500 });
  }

  // Buscar verifier salvo no banco para a conta do lojista (se gerado via userCode)
  const user = session.user?.email ? await prisma.user.findUnique({ where: { email: session.user.email } }) : null;
  const verifier = user?.ifoodAuthVerifier;

  const params: Record<string, string> = {
    grantType: "authorization_code",
    clientId,
    clientSecret,
    authorizationCode,
  };

  if (verifier) {
    params.authorizationCodeVerifier = verifier;
  }

  // Troca o authorization code por um access token com scope de merchant
  const res = await fetch(`${IFOOD_BASE}/authentication/v1.0/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });

  const data = await res.json();
  if (!res.ok) {
    return NextResponse.json({ error: `iFood ${res.status}`, details: data }, { status: res.status });
  }

  const merchantId = data.merchantId || data.merchant?.id;

  // Salva o token e dados de autorização no banco — nunca expor ao client
  if (session.user?.email) {
    await prisma.user.update({
      where: { email: session.user.email },
      data: {
        ifoodConnected: true,
        ifoodMerchantId: merchantId || user?.ifoodMerchantId,
        ifoodAccessToken: data.accessToken,
        ifoodRefreshToken: data.refreshToken || null,
        ifoodTokenExpiresAt: data.expiresIn ? new Date(Date.now() + data.expiresIn * 1000) : null,
      },
    });
  }

  return NextResponse.json({
    success:      true,
    merchantId,
    message:      "Autorização concluída! MerchantId salvo automaticamente.",
    instruction:  "A conexão com o iFood foi configurada. Você já pode gerenciar pedidos.",
  });
}
