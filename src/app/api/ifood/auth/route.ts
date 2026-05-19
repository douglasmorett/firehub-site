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

  // ── Passo 2: Testa conexão com merchantId atual ────────────────────────────
  if (step === "test") {
    const merchantId = process.env.IFOOD_MERCHANT_UUID;
    if (!merchantId) return NextResponse.json({ connected: false, error: "IFOOD_MERCHANT_UUID não configurado" });

    try {
      const token = await getIfoodToken();
      const res   = await fetch(`${IFOOD_BASE}/merchant/v1.0/merchants/${merchantId}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      const data = res.ok ? await res.json() : await res.text();
      return NextResponse.json({
        connected: res.ok,
        status:    res.status,
        merchantId,
        storeName: res.ok ? (data?.name || data?.shortName || "Loja iFood") : null,
        raw:       data,
      });
    } catch (err: any) {
      return NextResponse.json({ connected: false, error: err.message });
    }
  }

  return NextResponse.json({ error: "step inválido. Use ?step=url ou ?step=test" }, { status: 400 });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { authorizationCode } = await req.json();
  if (!authorizationCode) return NextResponse.json({ error: "authorizationCode obrigatório" }, { status: 400 });

  const clientId     = process.env.IFOOD_CLIENT_ID;
  const clientSecret = process.env.IFOOD_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: "Credenciais iFood não configuradas" }, { status: 500 });
  }

  // Troca o authorization code por um access token com scope de merchant
  const res = await fetch(`${IFOOD_BASE}/authentication/v1.0/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grantType:         "authorization_code",
      clientId,
      clientSecret,
      authorizationCode,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    return NextResponse.json({ error: `iFood ${res.status}`, details: data }, { status: res.status });
  }

  return NextResponse.json({
    success:      true,
    accessToken:  data.accessToken,
    merchantId:   data.merchantId || data.merchant?.id,
    expiresIn:    data.expiresIn,
    message:      "Token gerado! Copie o merchantId e configure IFOOD_MERCHANT_UUID no Vercel.",
    instruction:  "Agora vá em Vercel → Settings → Environment Variables e atualize IFOOD_MERCHANT_UUID com o merchantId retornado.",
  });
}
