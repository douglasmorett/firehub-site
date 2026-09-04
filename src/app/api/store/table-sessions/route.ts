import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolverOperadorDaMesa } from "@/lib/garcom-auth";

export async function GET(req: NextRequest) {
  try {
    // Sessão do painel OU cookie do garçom pelo link (src/lib/garcom-auth.ts).
    const operador = await resolverOperadorDaMesa();
    if (!operador) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const targetFranchiseeId = operador.franchiseeId;

    const url = new URL(req.url);
    const sessionId = url.searchParams.get("sessionId");

    if (sessionId) {
      const tableSession = await prisma.tableSession.findUnique({
        where: { id: sessionId },
        include: {
          table: { select: { number: true, label: true } },
          orders: {
            include: {
              items: {
                include: { menuProduct: { select: { name: true } } }
              }
            },
            orderBy: { createdAt: "asc" },
          },
        },
      });
      if (!tableSession) return NextResponse.json({ error: "Session not found" }, { status: 404 });
      return NextResponse.json(tableSession);
    }

    const sessions = await prisma.tableSession.findMany({
      where: {
        franchiseeId: targetFranchiseeId,
        status: "OPEN"
      },
      include: {
        table: { select: { number: true, label: true } },
        orders: {
          include: {
            items: {
              include: { menuProduct: { select: { name: true } } }
            }
          }
        }
      },
      orderBy: { openedAt: 'asc' }
    });

    return NextResponse.json({ sessions });
  } catch (error: any) {
    console.error("[Table Sessions GET]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    // Sessão do painel OU cookie do garçom pelo link (src/lib/garcom-auth.ts).
    const operador = await resolverOperadorDaMesa();
    if (!operador) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const targetFranchiseeId = operador.franchiseeId;

    const data = await req.json();
    const { tableId, customerName, waiterName, waiterId } = data;

    if (!tableId) return NextResponse.json({ error: "Table ID is required" }, { status: 400 });

    const table = await prisma.table.findUnique({
      where: { id: tableId },
      include: {
        sessions: {
          where: { status: "OPEN" }
        }
      }
    });

    if (!table || table.franchiseeId !== targetFranchiseeId) {
      return NextResponse.json({ error: "Table not found" }, { status: 404 });
    }

    if (table.sessions && table.sessions.length > 0) {
      return NextResponse.json({ error: "Table already has an open session" }, { status: 400 });
    }

    // Quem abre a mesa pelo link do garçom abre SEMPRE em nome próprio: o id
    // que vier no corpo é ignorado, senão bastaria mandar outro para a comissão
    // da mesa cair na conta de outro garçom. Pelo painel vale o que o gerente
    // escolheu — desde que seja garçom DESTA loja; id de fora vira "sem garçom".
    let garcomDaMesa: { id: string; name: string } | null = null;
    if (operador.tipo === "garcom") {
      garcomDaMesa = { id: operador.garcom.id, name: operador.garcom.name };
    } else if (waiterId) {
      garcomDaMesa = await prisma.waiter.findFirst({
        where: { id: String(waiterId), franchiseeId: targetFranchiseeId },
        select: { id: true, name: true },
      });
    }

    const tableSession = await prisma.tableSession.create({
      data: {
        tableId,
        franchiseeId: targetFranchiseeId,
        customerName: customerName || null,
        waiterName: garcomDaMesa?.name || waiterName || null,
        waiterId: garcomDaMesa?.id || null,
        status: "OPEN",
        openedAt: new Date()
      }
    });

    return NextResponse.json(tableSession);
  } catch (error: any) {
    console.error("[Table Sessions POST]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
