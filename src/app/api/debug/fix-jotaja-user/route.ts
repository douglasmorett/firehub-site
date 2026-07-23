import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const fromEmail = "franqueado@hakim.com.br";
  const toEmail = "contatohakim@gmail.com";

  // Remove jotajaMerchantId from wrong user
  await (prisma.user as any).update({
    where: { email: fromEmail },
    data: { jotajaMerchantId: null, jotajaConnected: false },
  });

  // Get user IDs
  const fromUser = await prisma.user.findUnique({ where: { email: fromEmail } });
  const toUser = await prisma.user.findUnique({ where: { email: toEmail } });
  if (!fromUser || !toUser) return NextResponse.json({ error: "Users not found" });

  // Move all Jotaja orders from wrong user to correct user
  const moved = await (prisma.customerOrder as any).updateMany({
    where: { franchiseeId: fromUser.id, source: "JOTAJA" },
    data: { franchiseeId: toUser.id },
  });

  return NextResponse.json({
    ok: true,
    removedMerchantFrom: fromEmail,
    movedOrders: moved.count,
    toUser: toEmail,
  });
}
