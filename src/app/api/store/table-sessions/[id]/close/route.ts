import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const dbUser = await prisma.user.findUnique({
      where: { email: session.user.email! },
      select: { id: true, ownerId: true }
    });
    if (!dbUser) return NextResponse.json({ error: "User not found" }, { status: 404 });
    const targetFranchiseeId = dbUser.ownerId || dbUser.id;

    const { id } = await params;
    if (!id) return NextResponse.json({ error: "Session ID is required" }, { status: 400 });

    const data = await req.json();
    const { paymentMethods, serviceFeePercent } = data;

    const tableSession = await prisma.tableSession.findUnique({
      where: { id },
      include: {
        table: true,
        orders: true
      }
    });

    if (!tableSession || tableSession.table.franchiseeId !== targetFranchiseeId) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    if (tableSession.status !== "OPEN") {
      return NextResponse.json({ error: "Session is not open" }, { status: 400 });
    }

    // Calculate total amount
    const subtotal = tableSession.orders.reduce((sum, order) => sum + (order.totalAmount || 0), 0);
    const serviceFee = serviceFeePercent ? (subtotal * serviceFeePercent) / 100 : 0;
    const totalAmount = subtotal + serviceFee;

    // Validate payment methods total
    let totalPaid = 0;
    if (paymentMethods && Array.isArray(paymentMethods)) {
      totalPaid = paymentMethods.reduce((sum, pm) => sum + (pm.amount || 0), 0);
    }

    // Wrap in transaction
    await prisma.$transaction(async (tx) => {
      // 1. Update orders status to ENTREGUE
      if (tableSession.orders.length > 0) {
        await tx.customerOrder.updateMany({
          where: { tableSessionId: id },
          data: { status: "ENTREGUE" }
        });
      }

      // Calculate waiter commission if linked
      let waiterCommission = 0;
      if (tableSession.waiterId && serviceFee > 0) {
        // Option A: Waiter gets the exact service fee collected
        waiterCommission = serviceFee;
        
        // If you prefer Option B (fixed % of subtotal), uncomment and adjust:
        // const waiter = await tx.waiter.findUnique({ where: { id: tableSession.waiterId } });
        // if (waiter && waiter.commissionRate) {
        //   waiterCommission = (subtotal * waiter.commissionRate) / 100;
        // }
      }

      // 2. Update session to CLOSED
      await tx.tableSession.update({
        where: { id },
        data: {
          status: "CLOSED",
          closedAt: new Date(),
          totalPaid,
          serviceFee,
          waiterCommission: waiterCommission > 0 ? waiterCommission : undefined,
          paymentMethods: paymentMethods ? paymentMethods : undefined
        }
      });
    });

    return NextResponse.json({ success: true, message: "Session closed successfully" });
  } catch (error: any) {
    console.error("[Table Sessions Close POST]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
