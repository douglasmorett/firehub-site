import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: {
      id: true,
      ownerId: true,
      storeName: true,
      storePhone: true,
      storeAddress: true,
      city: true,
      storeHours: true,
      deliveryConfig: true,
      paymentFees: true,
      chatbotConfig: true,
    },
  });

  if (!user) {
    return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  }

  const targetFranchiseeId = user.ownerId || user.id;

  // Busca catálogo da loja para estatísticas de sincronização
  const [productCount, categoryCount] = await Promise.all([
    prisma.menuProduct.count({ where: { franchiseeId: targetFranchiseeId, active: true } }),
    prisma.menuCategory.count({ where: { franchiseeId: targetFranchiseeId } }),
  ]);

  const defaultConfig = {
    active: true,
    connected: false,
    phone: "",
    pairingCode: "",
    personality: "SIMPATICO", // "SIMPATICO" | "AGIL" | "FORMAL" | "DIVERTIDO"
    customPrompt: "",
    autoOrderLink: true,
    maxWaitTimeMinutes: 45,
  };

  const storedConfig = (user.chatbotConfig as any) || {};

  return NextResponse.json({
    config: { ...defaultConfig, ...storedConfig },
    stats: {
      productCount,
      categoryCount,
      storeName: user.storeName || "Minha Loja",
      storeAddress: user.storeAddress || "Não informado",
      city: user.city || "Não informada",
    },
  });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, chatbotConfig: true },
  });

  if (!user) {
    return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  }

  try {
    const body = await req.json();
    const currentConfig = (user.chatbotConfig as any) || {};
    const updatedConfig = { ...currentConfig, ...body };

    await prisma.user.update({
      where: { id: user.id },
      data: { chatbotConfig: updatedConfig },
    });

    return NextResponse.json({ success: true, config: updatedConfig });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Erro ao salvar configurações" }, { status: 500 });
  }
}
