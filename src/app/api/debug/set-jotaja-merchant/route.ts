import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/debug/set-jotaja-merchant
 * Temporary route to set jotajaMerchantId on a user.
 * Query: ?email=xxx&merchantId=yyy
 */
export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get("email");
  const merchantId = req.nextUrl.searchParams.get("merchantId");

  if (!email || !merchantId) {
    // List all users with their jotajaMerchantId
    const users = await prisma.user.findMany({
      select: { id: true, email: true, name: true, jotajaMerchantId: true, jotajaConnected: true } as any,
    });
    return NextResponse.json({ users, usage: "GET ?email=xxx&merchantId=yyy" });
  }

  const user = await (prisma.user as any).update({
    where: { email },
    data: { jotajaMerchantId: merchantId, jotajaConnected: true },
  });

  return NextResponse.json({ ok: true, email: user.email, jotajaMerchantId: merchantId });
}
