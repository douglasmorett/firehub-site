import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

export function pushJobToPrintQueue(targetId: string, order: any, storeName?: string, paperWidth?: string) {
  // A fila agora é lida diretamente do banco de dados no endpoint GET.
  // Esta função foi mantida para não quebrar chamadores existentes.
  console.log(`[PrintQueue] 🖨️ Auto-print acionado (NO-OP). O endpoint GET fará a consulta no BD.`);
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const body = await req.json();
    const { franchiseeId, order, storeName, paperWidth } = body;

    let targetId = franchiseeId;
    if (!targetId && session?.user?.email) {
      const u = await prisma.user.findUnique({
        where: { email: session.user.email },
        select: { id: true, ownerId: true }
      });
      targetId = u?.ownerId || u?.id;
    }

    if (!targetId) {
      return NextResponse.json({ error: "Franchisee ID obrigatorio" }, { status: 400 });
    }

    pushJobToPrintQueue(targetId, order, storeName, paperWidth);

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const franchiseeId = searchParams.get("franchiseeId");
    const sinceParam = searchParams.get("since");
    const all = searchParams.get("all") === "true";

    // Padrão: 2 horas atrás
    let sinceDate = new Date(Date.now() - 2 * 60 * 60 * 1000);
    if (sinceParam) {
      const parsedSince = new Date(sinceParam);
      if (!isNaN(parsedSince.getTime())) {
        sinceDate = parsedSince;
      }
    }

    const where: any = {
      createdAt: { gt: sinceDate },
      status: { notIn: ["CRIANDO_IA", "AGUARDANDO_PAGAMENTO"] },
    };

    if (!all && franchiseeId) {
      where.franchiseeId = franchiseeId;
    }

    const recentOrders = await prisma.customerOrder.findMany({
      where,
      orderBy: { createdAt: "asc" },
      include: {
        franchisee: {
          select: { storeName: true, name: true }
        },
        items: {
          include: {
            menuProduct: true,
          }
        }
      }
    });

    const jobs = recentOrders.map(order => ({
      id: "job_" + order.id,
      order,
      storeName: (order as any).franchisee?.storeName || (order as any).franchisee?.name || "FIREHUB",
      paperWidth: "80mm",
      createdAt: order.createdAt.toISOString(),
    }));

    return NextResponse.json({ jobs });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
