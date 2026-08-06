import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET: Retorna as credenciais salvas do 99Food para o usuário logado
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
        food99MerchantId: true,
        food99AppId: true,
        food99SecretKey: true,
        food99Connected: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      merchantId: user.food99MerchantId || "",
      appId: user.food99AppId || "",
      secretKey: user.food99SecretKey || "",
      connected: !!user.food99Connected,
      webhookUrl: "https://firehubfood.com.br/api/99food/webhook",
      userEmail: user.email,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST: Salva e ativa as credenciais do 99Food para o usuário logado
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const body = await req.json();
    const { merchantId, appId, secretKey, connected } = body;

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, ownerId: true },
    });

    if (!user) {
      return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
    }

    const targetUserId = user.ownerId || user.id;

    const updatedUser = await prisma.user.update({
      where: { id: targetUserId },
      data: {
        food99MerchantId: merchantId ? merchantId.trim() : null,
        food99AppId: appId ? appId.trim() : null,
        food99SecretKey: secretKey ? secretKey.trim() : null,
        food99Connected: connected !== undefined ? connected : true,
      },
      select: {
        id: true,
        email: true,
        food99MerchantId: true,
        food99AppId: true,
        food99Connected: true,
      },
    });

    return NextResponse.json({
      ok: true,
      message: "Integração 99Food salva e ativada com sucesso!",
      user: updatedUser,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
