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

    const user = await prisma.user.findUnique({ where: { email: session.user?.email || "" } });
    if (!user) {
      return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
    }

    // Identifica o dono da conta (franchisee) e o masterId para multi-lojas
    const franchiseeId = user.ownerId || user.id;
    const masterId = user.accountGroupId || franchiseeId;

    // Busca todas as lojas vinculadas ao masterId. Funcionário vê só a loja
    // dele: trocar de loja troca a CONTA da sessão (lib/loja-ativa.ts), e
    // funcionário trocando de conta viraria dono da outra loja.
    const ehFuncionario = Boolean(user.ownerId);
    const stores = await prisma.user.findMany({
      where: ehFuncionario
        ? { id: franchiseeId }
        : { OR: [{ id: masterId }, { accountGroupId: masterId }] },
      orderBy: [{ isPrimaryStore: "desc" }, { createdAt: "asc" }],
      select: {
        id: true,
        storeName: true,
        storeOpen: true,
        city: true,
        isPrimaryStore: true,
        ifoodConnected: true,
        slug: true,
      }
    });

    // A loja ativa é a da SESSÃO (a troca troca a conta); o cookie só diz se
    // a visão é "Todas as Lojas". Ler o cookie como verdade mostrava o ✓ numa
    // loja enquanto a tela inteira era de outra (China Pow, 02/10/2026).
    const cookieStore = await cookies();
    const todas = !ehFuncionario && stores.length > 1 && cookieStore.get("firehub_active_store")?.value === "all";

    return NextResponse.json({
      stores,
      activeStoreId: todas ? "all" : franchiseeId,
      sessaoLojaId: franchiseeId,
    });
  } catch (error) {
    console.error("Error listing stores:", error);
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 });
  }
}
