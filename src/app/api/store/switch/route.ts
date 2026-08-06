import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const body = await req.json();
    const { storeId } = body;

    if (!storeId) {
      return NextResponse.json({ error: "ID da loja é obrigatório" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { email: session.user?.email || "" } });
    if (!user) {
      return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
    }

    const franchiseeId = user.ownerId || user.id;
    const masterId = user.accountGroupId || franchiseeId;

    // Se não for a visão 'all', verifica se a loja pertence ao grupo
    if (storeId !== "all") {
      const targetStore = await prisma.user.findUnique({ where: { id: storeId } });
      if (!targetStore) {
        return NextResponse.json({ error: "Loja não encontrada" }, { status: 404 });
      }

      if (targetStore.id !== masterId && targetStore.accountGroupId !== masterId) {
        return NextResponse.json({ error: "Acesso negado à loja selecionada" }, { status: 403 });
      }
    }

    // Define o cookie com a loja ativa (expira em 30 dias)
    (await cookies()).set("firehub_active_store", storeId, { maxAge: 30 * 24 * 60 * 60, path: "/" });

    return NextResponse.json({ success: true, activeStoreId: storeId });
  } catch (error) {
    console.error("Error switching store:", error);
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 });
  }
}
