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

    // Se for contatohakim@gmail.com ou se estiver vazio, retorna os valores padrão do Hakim
    const isHakim = user.email.toLowerCase().includes("contatohakim") || user.email.toLowerCase().includes("hakim");
    const clientId = user.jotajaClientId || (isHakim ? "92c66502-57ce-4563-a9e3-0df07dda5a38" : "");
    const clientSecret = user.jotajaClientSecret || (isHakim ? "bf6798ba-5abe-43b8-a5d7-adca54643492" : "");
    const merchantId = user.jotajaMerchantId || (isHakim ? "22238" : "");
    const connected = user.jotajaConnected || (isHakim ? true : false);

    return NextResponse.json({
      ok: true,
      clientId,
      clientSecret,
      merchantId,
      connected,
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

    const updatedUser = await prisma.user.update({
      where: { id: targetUserId },
      data: {
        jotajaClientId: clientId ? clientId.trim() : null,
        jotajaClientSecret: clientSecret ? clientSecret.trim() : null,
        jotajaMerchantId: merchantId ? merchantId.trim() : null,
        jotajaConnected: connected !== undefined ? connected : true,
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
      message: "Integração JotaJá salva e ativada com sucesso!",
      user: updatedUser
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
