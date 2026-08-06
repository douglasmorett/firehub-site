import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const body = await req.json();
    const { label, merchantId, widgetId } = body;

    if (!label || !merchantId) {
      return NextResponse.json({ error: "Nome e Merchant ID são obrigatórios" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, ownerId: true },
    });
    if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

    const franchiseeId = user.ownerId || user.id;

    // Verificar se merchantId já está em uso
    const existing = await prisma.ifoodIntegration.findFirst({
      where: { merchantId },
    });
    if (existing) {
      return NextResponse.json({ error: "Este Merchant ID já está em uso por outra integração" }, { status: 409 });
    }

    // Contar integrações existentes pra saber se cobra extra
    const count = await prisma.ifoodIntegration.count({
      where: { userId: franchiseeId },
    });

    const integration = await prisma.ifoodIntegration.create({
      data: {
        userId: franchiseeId,
        label,
        merchantId,
        widgetId: widgetId || null,
        connected: true,
        active: true,
      },
    });

    // Atualizar User.ifoodConnected = true se não estiver
    await prisma.user.update({
      where: { id: franchiseeId },
      data: { ifoodConnected: true },
    });

    const isExtra = count >= 1; // Primeira é grátis, da segunda em diante cobra
    return NextResponse.json({
      success: true,
      integration,
      billingNotice: isExtra
        ? `⚠️ Esta é sua ${count + 1}ª integração iFood. Cobrança adicional: +R$50,00/mês.`
        : "✅ Primeira integração iFood incluída no plano, sem custo extra.",
    });
  } catch (error: any) {
    console.error("Erro ao criar integração iFood:", error);
    if (error.code === "P2002") {
      return NextResponse.json({ error: "Este Merchant ID já está cadastrado para esta loja" }, { status: 409 });
    }
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
