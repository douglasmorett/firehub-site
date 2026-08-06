import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const userId = session.user.id;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
    }

    // Identifica o dono da conta (franchisee) e o masterId para multi-lojas
    const franchiseeId = user.ownerId || user.id;
    const masterId = user.accountGroupId || franchiseeId;

    // Busca todas as lojas vinculadas ao masterId
    const stores = await prisma.user.findMany({
      where: {
        OR: [{ id: masterId }, { accountGroupId: masterId }]
      },
      select: {
        id: true,
        storeName: true,
        storeOpen: true,
        city: true,
        isPrimaryStore: true,
        ifoodConnected: true
      }
    });

    const cookieStore = await cookies();
    const activeStoreId = cookieStore.get("firehub_active_store")?.value || franchiseeId;

    return NextResponse.json({
      stores,
      activeStoreId
    });
  } catch (error) {
    console.error("Error listing stores:", error);
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 });
  }
}
