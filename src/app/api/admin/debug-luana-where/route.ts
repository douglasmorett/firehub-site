import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const hakimUser = await prisma.user.findFirst({
    where: { email: "contatohakim@gmail.com" },
    select: { id: true, email: true, role: true, ownerId: true }
  });

  if (!hakimUser) return NextResponse.json({ error: "Hakim user not found" });

  const targetFranchiseeId = hakimUser.ownerId || hakimUser.id;

  const luanaOrder = await prisma.customerOrder.findFirst({
    where: {
      OR: [
        { openDeliveryOrderId: "32516601" },
        { openDeliveryReference: "2316" },
        { customerPhone: "22992536804" },
        { customerName: { contains: "Luana", mode: "insensitive" } }
      ]
    }
  });

  const countForTarget = await prisma.customerOrder.count({
    where: { franchiseeId: targetFranchiseeId }
  });

  const countForUserId = await prisma.customerOrder.count({
    where: { franchiseeId: hakimUser.id }
  });

  return NextResponse.json({
    hakimUser,
    targetFranchiseeId,
    countForTarget,
    countForUserId,
    luanaOrder
  });
}
