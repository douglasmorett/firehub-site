import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const franchisee = await prisma.user.findFirst({
    where: { email: "contatohakim@gmail.com" },
    select: { id: true, email: true, ownerId: true }
  });

  const targetId = franchisee?.ownerId || franchisee?.id;

  const orders = await prisma.customerOrder.findMany({
    where: { franchiseeId: targetId },
    select: { id: true, customerName: true, createdAt: true, status: true, openDeliveryReference: true },
    orderBy: { createdAt: "desc" },
    take: 10
  });

  return NextResponse.json({ targetId, orders });
}
