import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function DELETE(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const integrationId = searchParams.get("id");
    if (!integrationId) {
      return NextResponse.json({ error: "ID da integração é obrigatório" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, ownerId: true },
    });
    if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

    const franchiseeId = user.ownerId || user.id;

    // Verificar se a integração pertence ao usuário
    const integration = await prisma.ifoodIntegration.findFirst({
      where: { id: integrationId, userId: franchiseeId },
    });
    if (!integration) {
      return NextResponse.json({ error: "Integração não encontrada" }, { status: 404 });
    }

    await prisma.ifoodIntegration.delete({ where: { id: integrationId } });

    // Se não tem mais integrações ativas, desativar ifoodConnected
    const restantes = await prisma.ifoodIntegration.findMany({
      where: { userId: franchiseeId, active: true },
      orderBy: { createdAt: "asc" },
      select: { merchantId: true },
    });

    // O vínculo principal ainda mora em `User.ifoodMerchantId`, e o polling lê
    // esse campo junto com a tabela. Sem limpá-lo aqui, a loja removida
    // continuava sendo puxada do iFood como se nada tivesse acontecido.
    const loja = await prisma.user.findUnique({
      where: { id: franchiseeId },
      select: { ifoodMerchantId: true },
    });
    if (loja?.ifoodMerchantId === integration.merchantId) {
      await prisma.user.update({
        where: { id: franchiseeId },
        data: restantes[0]
          ? { ifoodMerchantId: restantes[0].merchantId }
          : { ifoodMerchantId: null, ifoodConnected: false },
      });
    } else if (restantes.length === 0) {
      await prisma.user.update({
        where: { id: franchiseeId },
        data: { ifoodConnected: false },
      });
    }

    return NextResponse.json({ success: true, message: "Integração removida com sucesso." });
  } catch (error) {
    console.error("Erro ao remover integração iFood:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
