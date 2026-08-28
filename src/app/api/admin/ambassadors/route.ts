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
          select: { referredStores: true, subAmbassadors: true }
        },
        // Quem trouxe este embaixador (nível 2) e quem ele trouxe.
        parentAmbassador: {
          select: { id: true, name: true, code: true, level2Percent: true }
        },
        subAmbassadors: {
          select: {
            id: true,
            name: true,
            code: true,
            active: true,
            commissionPercent: true,
            _count: { select: { referredStores: true } }
          }
        },
        referredStores: {
          select: {
            id: true,
            storeName: true,
            storePhone: true,
            email: true,
            createdAt: true,
            // Se a loja indicada já virou embaixadora, o painel mostra o código
            // dela no lugar do botão de promover.
            ambassadorAccount: { select: { id: true, code: true, active: true } }
          }
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
    let { name, email, phone, code, commissionPercent, asaasWalletId, pixKey, parentAmbassadorId, level2Percent } = data;

    if (!name || !email) {
      return NextResponse.json({ error: "Nome e e-mail são obrigatórios" }, { status: 400 });
    }

    // Auto-generate code if not provided
    if (!code) {
      const base = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
      const rand = Math.floor(1000 + Math.random() * 9000);
      code = `${base}${rand}`;
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
        level2Percent: level2Percent !== undefined && level2Percent !== null && level2Percent !== ""
          ? parseFloat(level2Percent)
          : 3.0,
        asaasWalletId,
        pixKey,
        active: true,
        parentAmbassadorId: parentAmbassadorId || null
      }
    });

    return NextResponse.json(ambassador);
  } catch (error: any) {
    console.error("[Ambassadors API] POST error:", error);
    return NextResponse.json({ error: "Erro ao criar embaixador" }, { status: 500 });
  }
}
