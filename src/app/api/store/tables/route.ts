import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolverOperadorDaMesa } from "@/lib/garcom-auth";

export async function GET(req: NextRequest) {
  try {
    // Sessão do painel OU cookie do garçom pelo link (src/lib/garcom-auth.ts).
    const operador = await resolverOperadorDaMesa();
    if (!operador) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const targetFranchiseeId = operador.franchiseeId;

    const tables = await prisma.table.findMany({
      where: { franchiseeId: targetFranchiseeId },
      include: {
        sessions: {
          where: { status: "OPEN" },
          include: {
            orders: {
              include: {
                items: true
              }
            }
          }
        }
      },
      orderBy: { number: 'asc' }
    });

    const formattedTables = tables.map((table: any) => {
      const activeSession = table.sessions[0] || null;
      let openSession = null;
      if (activeSession) {
        const totalAmount = activeSession.orders.reduce((sum: number, order: any) => {
          return sum + (order.totalAmount || 0);
        }, 0);
        openSession = {
          id: activeSession.id,
          customerName: activeSession.customerName,
          waiterName: activeSession.waiterName,
          openedAt: activeSession.openedAt,
          totalAmount,
          orderCount: activeSession.orders.length,
        };
      }

      return {
        id: table.id,
        number: table.number,
        label: table.label,
        capacity: table.capacity,
        isActive: table.isActive,
        openSession,
      };
    });

    return NextResponse.json({ tables: formattedTables });
  } catch (error: any) {
    console.error("[Tables GET]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    // Sessão do painel OU cookie do garçom pelo link (src/lib/garcom-auth.ts).
    const operador = await resolverOperadorDaMesa();
    if (!operador) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    // Cadastrar, renumerar e apagar mesa é gestão: só pelo painel. O garçom
    // pelo link lança pedido e fecha conta, não redesenha o salão.
    if (operador.tipo === "garcom") {
      return NextResponse.json({ error: "Cadastro de mesa é feito pelo painel, não pelo acesso do garçom" }, { status: 403 });
    }
    const targetFranchiseeId = operador.franchiseeId;

    const data = await req.json();
    let { number, label, capacity } = data;

    if (!number) {
      const maxTable = await prisma.table.findFirst({
        where: { franchiseeId: targetFranchiseeId },
        orderBy: { number: 'desc' }
      });
      number = (maxTable?.number || 0) + 1;
    }

    const existingTable = await prisma.table.findFirst({
      where: { franchiseeId: targetFranchiseeId, number }
    });

    if (existingTable) {
      return NextResponse.json({ error: "Table number already exists" }, { status: 400 });
    }

    const table = await prisma.table.create({
      data: {
        franchiseeId: targetFranchiseeId,
        number,
        label,
        capacity: capacity ? parseInt(capacity) : 4,
        isActive: true
      }
    });

    return NextResponse.json(table);
  } catch (error: any) {
    console.error("[Tables POST]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    // Sessão do painel OU cookie do garçom pelo link (src/lib/garcom-auth.ts).
    const operador = await resolverOperadorDaMesa();
    if (!operador) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    // Cadastrar, renumerar e apagar mesa é gestão: só pelo painel. O garçom
    // pelo link lança pedido e fecha conta, não redesenha o salão.
    if (operador.tipo === "garcom") {
      return NextResponse.json({ error: "Cadastro de mesa é feito pelo painel, não pelo acesso do garçom" }, { status: 403 });
    }
    const targetFranchiseeId = operador.franchiseeId;

    const data = await req.json();
    const { id, number, label, capacity, isActive } = data;

    if (!id) return NextResponse.json({ error: "Table ID is required" }, { status: 400 });

    const table = await prisma.table.findUnique({ where: { id } });
    if (!table || table.franchiseeId !== targetFranchiseeId) {
      return NextResponse.json({ error: "Table not found" }, { status: 404 });
    }

    if (number && number !== table.number) {
      const existingTable = await prisma.table.findFirst({
        where: { franchiseeId: targetFranchiseeId, number }
      });
      if (existingTable) {
        return NextResponse.json({ error: "Table number already exists" }, { status: 400 });
      }
    }

    const updatedTable = await prisma.table.update({
      where: { id },
      data: {
        number: number !== undefined ? number : table.number,
        label: label !== undefined ? label : table.label,
        capacity: capacity !== undefined ? parseInt(capacity) : table.capacity,
        isActive: isActive !== undefined ? isActive : table.isActive,
      }
    });

    return NextResponse.json(updatedTable);
  } catch (error: any) {
    console.error("[Tables PUT]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    // Sessão do painel OU cookie do garçom pelo link (src/lib/garcom-auth.ts).
    const operador = await resolverOperadorDaMesa();
    if (!operador) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    // Cadastrar, renumerar e apagar mesa é gestão: só pelo painel. O garçom
    // pelo link lança pedido e fecha conta, não redesenha o salão.
    if (operador.tipo === "garcom") {
      return NextResponse.json({ error: "Cadastro de mesa é feito pelo painel, não pelo acesso do garçom" }, { status: 403 });
    }
    const targetFranchiseeId = operador.franchiseeId;

    const url = new URL(req.url);
    const id = url.searchParams.get("id");

    if (!id) return NextResponse.json({ error: "Table ID is required" }, { status: 400 });

    const table = await prisma.table.findUnique({ 
      where: { id },
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
      return NextResponse.json({ error: "Cannot delete table with open session" }, { status: 400 });
    }

    await prisma.table.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[Tables DELETE]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
