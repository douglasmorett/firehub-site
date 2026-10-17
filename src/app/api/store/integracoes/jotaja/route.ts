import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ligarJotajaNaLoja } from "@/lib/jotaja-ligacao";

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

// POST: Salva e ativa as credenciais do JotaJá para o usuário logado — a regra mora em lib/jotaja-ligacao.ts
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

    const { status, corpo } = await ligarJotajaNaLoja(user.ownerId || user.id, { clientId, clientSecret, merchantId, connected });
    return NextResponse.json(corpo, { status });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
