import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get("email");
  const orderId = req.nextUrl.searchParams.get("orderId");

  if (!email || !orderId) {
    return NextResponse.json({ usage: "GET ?email=xxx&orderId=yyy" });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const updated = await (prisma.customerOrder as any).updateMany({
    where: { openDeliveryOrderId: orderId },
    data: { franchiseeId: user.id },
  });

  return NextResponse.json({ ok: true, moved: updated.count, toUser: email });
}
