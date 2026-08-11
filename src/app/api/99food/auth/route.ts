import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/99food/auth?step=test | disconnect
 * POST /api/99food/auth { merchantId, userCode }
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const step = req.nextUrl.searchParams.get("step");

  if (step === "test") {
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { food99Connected: true, food99MerchantId: true },
    });

    if (!user || !user.food99MerchantId || !user.food99Connected) {
      return NextResponse.json({ connected: false, message: "Loja 99Food não conectada." });
    }

    return NextResponse.json({
      connected: true,
      merchantId: user.food99MerchantId,
      message: "Loja 99Food conectada e sincronizada com sucesso!",
    });
  }

  if (step === "disconnect") {
    await prisma.user.update({
      where: { email: session.user.email },
      data: { food99Connected: false, food99MerchantId: null },
    });

    return NextResponse.json({ success: true, connected: false, message: "Loja 99Food desconectada." });
  }

  return NextResponse.json({ error: "step inválido" }, { status: 400 });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const { merchantId, userCode } = body;

  if (!merchantId) {
    return NextResponse.json({ error: "Merchant ID (ID da Loja no 99Food) é obrigatório" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true },
  });

  if (!user) {
    return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  }

  const targetUserId = user.ownerId || user.id;

  const updated = await prisma.user.update({
    where: { id: targetUserId },
    data: {
      food99MerchantId: merchantId.trim(),
      food99Connected: true,
    },
    select: { id: true, email: true, food99MerchantId: true, food99Connected: true },
  });

  return NextResponse.json({
    success: true,
    connected: true,
    merchantId: updated.food99MerchantId,
    message: "Conexão 99Food realizada com sucesso!",
  });
}
