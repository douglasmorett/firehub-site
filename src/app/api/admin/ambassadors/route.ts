import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET: Lista todos os embaixadores com métricas de lojas indicadas
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any).role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  try {
    const ambassadors = await prisma.ambassador.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        _count: {
          select: { referredStores: true }
        }
      }
    });
    return NextResponse.json(ambassadors);
  } catch (error: any) {
    console.error("[Ambassadors API] GET error:", error);
    return NextResponse.json({ error: "Erro ao buscar embaixadores" }, { status: 500 });
  }
}

// POST: Cria um novo embaixador
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any).role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  try {
    const data = await req.json();
    const { name, email, phone, code, commissionPercent, asaasWalletId, pixKey } = data;

    if (!name || !email || !code) {
      return NextResponse.json({ error: "Nome, e-mail e código são obrigatórios" }, { status: 400 });
    }

    // Verifica se já existe email ou code
    const existing = await prisma.ambassador.findFirst({
      where: {
        OR: [
          { email },
          { code }
        ]
      }
    });

    if (existing) {
      return NextResponse.json({ error: "Já existe um embaixador com este e-mail ou código." }, { status: 400 });
    }

    const ambassador = await prisma.ambassador.create({
      data: {
        name,
        email,
        phone,
        code: code.toLowerCase().trim(),
        commissionPercent: commissionPercent ? parseFloat(commissionPercent) : 20.0,
        asaasWalletId,
        pixKey,
        active: true
      }
    });

    return NextResponse.json(ambassador);
  } catch (error: any) {
    console.error("[Ambassadors API] POST error:", error);
    return NextResponse.json({ error: "Erro ao criar embaixador" }, { status: 500 });
  }
}
