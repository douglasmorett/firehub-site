import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const dbUser = await prisma.user.findUnique({
      where: { email: session.user.email! },
      select: { id: true, ownerId: true }
    });
    if (!dbUser) return NextResponse.json({ error: "User not found" }, { status: 404 });
    const targetFranchiseeId = dbUser.ownerId || dbUser.id;

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
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const dbUser = await prisma.user.findUnique({
      where: { email: session.user.email! },
      select: { id: true, ownerId: true }
    });
    if (!dbUser) return NextResponse.json({ error: "User not found" }, { status: 404 });
    const targetFranchiseeId = dbUser.ownerId || dbUser.id;

    const data = await req.json();
    const { tableId, customerName, waiterName } = data;

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

    const tableSession = await prisma.tableSession.create({
      data: {
        tableId,
        franchiseeId: targetFranchiseeId,
        customerName: customerName || null,
        waiterName: waiterName || null,
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
