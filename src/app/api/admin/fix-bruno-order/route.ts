import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const updated = await prisma.customerOrder.updateMany({
      where: {
        OR: [
          { ifoodReference: "0904" },
          { customerName: { contains: "Bruno" } }
        ]
      },
      data: {
        status: "ENTREGUE",
        kdsStage: "FINISHED"
      }
    });

    return NextResponse.json({ ok: true, updatedCount: updated.count });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
