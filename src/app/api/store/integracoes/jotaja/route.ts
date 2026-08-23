import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET: Retorna as credenciais salvas do JotaJá para o usuário logado
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: {
        id: true,
        email: true,
        jotajaClientId: true,
        jotajaClientSecret: true,
        jotajaMerchantId: true,
        jotajaConnected: true
      }
    });

    if (!user) {
      return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
    }

    // ⚠️ NÃO devolver credencial embutida no código.
    // Antes, para qualquer e-mail contendo "hakim", esta rota devolvia
    // client_id/secret/merchant fixos e `connected: true` mesmo com o banco
    // vazio. O painel mostrava "🟢 Conectado & Ativo" independentemente do
    // estado real, então uma integração desligada no banco (que o cron ignora)
    // parecia saudável na tela — e o segredo ia junto para o browser.
    // Agora o painel reflete o banco, e o secret nunca é devolvido.
    return NextResponse.json({
      ok: true,
      clientId: user.jotajaClientId || "",
      clientSecret: "", // nunca volta para o cliente; vazio no POST = "manter o atual"
      hasSecret: !!user.jotajaClientSecret,
      merchantId: user.jotajaMerchantId || "",
      connected: !!user.jotajaConnected,
      configurada: !!(user.jotajaClientId && user.jotajaClientSecret),
      userEmail: user.email
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST: Salva e ativa as credenciais do JotaJá para o usuário logado
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const body = await req.json();
    const { clientId, clientSecret, merchantId, connected } = body;

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, ownerId: true }
    });

    if (!user) {
      return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
    }

    const targetUserId = user.ownerId || user.id;

    // ⚠️ Campo vazio NUNCA apaga credencial.
    // O formulário chegava em branco (o GET não devolve mais o secret) e o POST
    // gravava `null` nos três campos com jotajaConnected: true. O cron exige
    // clientId E secret não-nulos, então a loja saía da lista de polling para
    // sempre — com o painel continuando verde. Vazio agora significa "mantém".
    const atual = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { jotajaClientId: true, jotajaClientSecret: true, jotajaMerchantId: true },
    });

    const novoClientId = clientId?.trim() || atual?.jotajaClientId || null;
    const novoSecret = clientSecret?.trim() || atual?.jotajaClientSecret || null;
    const novoMerchant = merchantId?.trim() || atual?.jotajaMerchantId || null;

    if (!novoClientId || !novoSecret) {
      return NextResponse.json(
        { error: "Informe o Client ID e o Client Secret do JotaJá — sem os dois a loja não entra no polling de pedidos." },
        { status: 400 }
      );
    }

    // Só marca como conectada se a credencial realmente autenticar. "Conectado"
    // no painel passa a significar "o JotaJá aceitou esta credencial agora".
    let autenticou = false;
    let erroAuth = "";
    try {
      const res = await fetch(`${process.env.JOTAJA_BASE_URL || "https://api.jotaja.com/openDelivery"}/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: novoClientId,
          client_secret: novoSecret,
        }),
      });
      autenticou = res.ok;
      if (!res.ok) erroAuth = `JotaJá recusou a credencial (HTTP ${res.status})`;
    } catch (e: any) {
      erroAuth = `Não foi possível falar com o JotaJá: ${e?.message}`;
    }

    const updatedUser = await prisma.user.update({
      where: { id: targetUserId },
      data: {
        jotajaClientId: novoClientId,
        jotajaClientSecret: novoSecret,
        jotajaMerchantId: novoMerchant,
        jotajaConnected: connected === false ? false : autenticou,
      },
      select: {
        id: true,
        email: true,
        jotajaClientId: true,
        jotajaMerchantId: true,
        jotajaConnected: true
      }
    });

    return NextResponse.json({
      ok: true,
      message: autenticou
        ? "Integração JotaJá salva e ativada — credencial testada e aceita pelo JotaJá."
        : `Credenciais salvas, mas a integração ficou DESLIGADA: ${erroAuth}. Confira Client ID e Secret no painel do JotaJá.`,
      autenticou,
      user: updatedUser
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
