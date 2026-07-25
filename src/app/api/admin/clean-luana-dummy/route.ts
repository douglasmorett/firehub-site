import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const deleted = await prisma.customerOrder.deleteMany({
      where: {
        id: "cmrzql8lm0001ju04ix5arnvw"
      }
    });
    return NextResponse.json({ ok: true, deletedCount: deleted.count });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
