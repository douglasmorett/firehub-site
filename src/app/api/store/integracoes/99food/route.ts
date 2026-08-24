import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ler99Food } from "@/lib/webhook-99food-log";

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

      // `connected` acima significa apenas "alguém preencheu o formulário": nada
      // neste sistema fala com o 99Food para confirmar. Enquanto a integração
      // de saída não existir, o que diz a verdade sobre a integração é isto —
      // o que o 99Food efetivamente mandou para cá.
      //
      // Vazio depois de um pedido de teste = o 99Food não está chamando o
      // webhook, e o problema está na configuração do Callback address no
      // portal deles, não aqui dentro.
      ultimosEventos99Food: ler99Food(),
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
