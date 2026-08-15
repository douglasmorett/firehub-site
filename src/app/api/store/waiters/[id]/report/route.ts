import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

async function getFranchiseeId() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return null;
  const dbUser = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true }
  });
  if (!dbUser) return null;
  return dbUser.ownerId || dbUser.id;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const franchiseeId = await getFranchiseeId();
    if (!franchiseeId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const startDateParam = searchParams.get("startDate");
    const endDateParam = searchParams.get("endDate");
    
    const { id } = await params;
    if (!id) return NextResponse.json({ error: "Waiter ID is required" }, { status: 400 });

    const waiter = await prisma.waiter.findUnique({
      where: { id, franchiseeId }
    });

    if (!waiter) return NextResponse.json({ error: "Waiter not found" }, { status: 404 });

    // Base query for TableSessions
    const whereClause: any = {
      franchiseeId,
      waiterId: id,
      status: "CLOSED",
    };

    if (startDateParam && endDateParam) {
      whereClause.closedAt = {
        gte: new Date(startDateParam),
        lte: new Date(endDateParam)
      };
    }

    const sessions = await prisma.tableSession.findMany({
      where: whereClause,
      include: {
        table: true
      },
      orderBy: { closedAt: 'desc' }
    });

    return NextResponse.json({
      waiter,
      sessions: sessions.map(s => ({
        id: s.id,
        tableNumber: s.table.number,
        tableLabel: s.table.label,
        openedAt: s.openedAt,
        closedAt: s.closedAt,
        totalPaid: s.totalPaid || 0,
        serviceFee: s.serviceFee || 0,
        waiterTip: s.waiterTip || 0,
        waiterCommission: s.waiterCommission || 0
      }))
    });
  } catch (error: any) {
    console.error("GET Waiter Report Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
