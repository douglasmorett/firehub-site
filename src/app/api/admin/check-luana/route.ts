import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const order = await prisma.customerOrder.findFirst({
    where: {
      OR: [
        { openDeliveryReference: "2316" },
        { openDeliveryOrderId: "32516601" },
        { id: "cmrzql8lm0001ju04ix5arnvw" }
      ]
    },
    include: { franchisee: { select: { id: true, email: true, role: true } } }
  });

  return NextResponse.json({ order });
}
