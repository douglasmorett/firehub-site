import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import { CHAVE_DA_SELECAO } from "@/lib/lojas-no-mesmo-pc";

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

    // A seleção também vai para o servidor, porque quem imprime com o painel
    // fechado é o Assistente, que não vê o cookie. Na conta que marcou "estas
    // lojas dividem este computador", a fila da nuvem imprime a loja
    // selecionada, ou todas em "Todas as lojas" (lib/lojas-no-mesmo-pc.ts).
    // Falhar aqui não pode impedir a troca de loja.
    try {
      const principal = await prisma.user.findUnique({ where: { id: masterId }, select: { printerConfig: true } });
      const atual = principal?.printerConfig && typeof principal.printerConfig === "object" && !Array.isArray(principal.printerConfig) ? principal.printerConfig : {};
      await prisma.user.update({
        where: { id: masterId },
        data: { printerConfig: { ...(atual as Record<string, unknown>), [CHAVE_DA_SELECAO]: storeId } },
      });
    } catch (err) {
      console.error("[switch] seleção da loja não gravada para a impressão:", (err as any)?.message || err);
    }

    return NextResponse.json({ success: true, activeStoreId: storeId });
  } catch (error) {
    console.error("Error switching store:", error);
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 });
  }
}
