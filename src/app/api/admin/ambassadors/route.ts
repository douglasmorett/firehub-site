import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { gerarCodigoUnicoDoEmbaixador } from "@/lib/codigo-do-embaixador";

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
    let { name, email, phone, code, commissionPercent, asaasWalletId, pixKey } = data;

    if (!name || !email) {
      return NextResponse.json({ error: "Nome e e-mail são obrigatórios" }, { status: 400 });
    }

    // C\u00f3digo embaralhado, sem o nome de ningu\u00e9m (Douglas, 12/11/2026: o nome
    // de quem indicou no link derruba a convers\u00e3o). Ignora o que vier no corpo.
    code = await gerarCodigoUnicoDoEmbaixador();

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
        active: true,
        // Nível 2 encerrado em 15/10/2026: ninguém mais é "indicado por" outro embaixador.
        level2Percent: 0,
      }
    });

    return NextResponse.json(ambassador);
  } catch (error: any) {
    console.error("[Ambassadors API] POST error:", error);
    return NextResponse.json({ error: "Erro ao criar embaixador" }, { status: 500 });
  }
}
