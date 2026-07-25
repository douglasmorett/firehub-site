import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const orders = await prisma.customerOrder.findMany({
      where: {
        OR: [
          { openDeliveryReference: "32526414" },
          { openDeliveryOrderId: { contains: "32526414" } },
          { customerName: { contains: "Vitor" } }
        ]
      },
      include: { items: { include: { menuProduct: true } } }
    });

    return NextResponse.json({ ok: true, orders });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
