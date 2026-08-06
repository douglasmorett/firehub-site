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

  const body = await req.json();
  const rawCode = (body.authorizationCode || body.merchantId || "").trim();
  if (!rawCode) return NextResponse.json({ error: "Código de autorização obrigatório" }, { status: 400 });

  // Se o usuário digitou diretamente um Merchant UUID (formato 8-4-4-4-12)
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawCode);
  if (isUuid && session.user?.email) {
    await prisma.user.update({
      where: { email: session.user.email },
      data: {
        ifoodConnected: true,
        ifoodMerchantId: rawCode,
      },
    });
    return NextResponse.json({
      success: true,
      merchantId: rawCode,
      message: "Merchant ID salvo com sucesso!",
    });
  }

  const clientId     = process.env.IFOOD_CLIENT_ID_DISTRIBUTED || "cabc4064-8d01-4bb0-bb5b-ed93963f9a7a";
  const clientSecret = process.env.IFOOD_CLIENT_SECRET_DISTRIBUTED || "2k28s9uil03gobzo6p3gkojim4ffsw9ttu3031veoxm1irbiz53vbzrd50n8wqnywrbvfsurzalevhv4ank4jrrm9wr4xhfcahv";

  const user = session.user?.email ? await prisma.user.findUnique({ where: { email: session.user.email } }) : null;
  const verifier = user?.ifoodAuthVerifier;

  // Tentativa 1: Com verifier (Fluxo Distribuído UserCode)
  let res = await fetch(`${IFOOD_BASE}/authentication/v1.0/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grantType: "authorization_code",
      clientId,
      clientSecret,
      authorizationCode: rawCode,
      ...(verifier ? { authorizationCodeVerifier: verifier } : {}),
    }),
  });

  let data = await res.json();

  // Tentativa 2: Sem verifier (caso seja fluxo centralizado/direto)
  if (!res.ok && verifier) {
    res = await fetch(`${IFOOD_BASE}/authentication/v1.0/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grantType: "authorization_code",
        clientId,
        clientSecret,
        authorizationCode: rawCode,
      }),
    });
    if (res.ok) {
      data = await res.json();
    }
  }

  if (!res.ok) {
    const errorMsg = data?.error?.message || data?.error || `iFood ${res.status}`;
    console.error("[iFood Auth] Token Exchange Error:", data);
    return NextResponse.json({
      error: `Erro de autorização iFood: ${errorMsg}`,
      details: data,
      hint: "Certifique-se de ter clicado em '1. Conectar e Autorizar no Portal iFood' e colado o código gerado na janela 'Aplicativo Autorizado' dentro de 60 segundos.",
    }, { status: res.status });
  }

  // Obter merchantId do iFood usando o accessToken obtido
  let merchantId = data.merchantId || data.merchant?.id;
  if (!merchantId && data.accessToken) {
    try {
      const mRes = await fetch(`${IFOOD_BASE}/merchant/v1.0/merchants`, {
        headers: { Authorization: `Bearer ${data.accessToken}` },
      });
      if (mRes.ok) {
        const mData = await mRes.json();
        if (Array.isArray(mData) && mData.length > 0) {
          merchantId = mData[0].id;
        }
      }
    } catch (e: any) {
      console.warn("[iFood Auth] Erro ao buscar lista de merchants:", e?.message);
    }
  }

  // Salvar token e merchantId no banco (tanto no User quanto na tabela IfoodIntegration)
  if (session.user?.email && merchantId) {
    const userId = user?.id;

    if (userId) {
      // Se já existia um merchantId anterior diferente na conta, preservar na tabela de integrações
      if (user?.ifoodMerchantId && user.ifoodMerchantId !== merchantId) {
        try {
          await prisma.ifoodIntegration.upsert({
            where: { userId_merchantId: { userId, merchantId: user.ifoodMerchantId } },
            create: {
              userId,
              label: "Loja Principal",
              merchantId: user.ifoodMerchantId,
              connected: true,
              active: true,
            },
            update: { connected: true, active: true },
          });
        } catch (e: any) {
          console.warn("[iFood Auth] Aviso ao salvar integração principal anterior:", e?.message);
        }
      }

      // Adicionar/atualizar a nova loja na tabela de integrações
      try {
        await prisma.ifoodIntegration.upsert({
          where: { userId_merchantId: { userId, merchantId } },
          create: {
            userId,
            label: `Loja iFood (${merchantId.slice(0, 6)})`,
            merchantId,
            connected: true,
            active: true,
          },
          update: { connected: true, active: true },
        });
      } catch (e: any) {
        console.warn("[iFood Auth] Aviso ao salvar nova integração:", e?.message);
      }
    }

    await prisma.user.update({
      where: { email: session.user.email },
      data: {
        ifoodConnected: true,
        ifoodMerchantId: merchantId,
        ifoodAccessToken: data.accessToken || user?.ifoodAccessToken,
        ifoodRefreshToken: data.refreshToken || null,
        ifoodTokenExpiresAt: data.expiresIn ? new Date(Date.now() + data.expiresIn * 1000) : null,
      },
    });
  }

  return NextResponse.json({
    success: true,
    merchantId,
    message: "Autorização concluída! Loja conectada com sucesso.",
  });
}
