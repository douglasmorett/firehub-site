import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Rate limiting por IP
  const { checkRateLimit, getClientIp } = await import("@/lib/rateLimit");
  const ip = getClientIp(_req);
  const { allowed } = checkRateLimit(`status-poll:${ip}`, { windowMs: 60000, maxRequests: 30 });
  if (!allowed) {
    return NextResponse.json({ error: "Muitas requisições." }, { status: 429 });
  }

  const order = await prisma.customerOrder.findUnique({
    where: { id },
    select: { status: true, updatedAt: true },
  });
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ status: order.status, updatedAt: order.updatedAt });

}
