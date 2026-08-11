/**
 * GET /api/mp-connect — Verifica status da conexão MP
 * DELETE /api/mp-connect — Desconecta conta MP
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMpOnboardingUrl } from "@/lib/mercadopago";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions).catch(() => null);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, mpSellerId: true },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json({
    connected: !!user.mpSellerId,
    mpSellerId: user.mpSellerId || null,
    onboardingUrl: user.mpSellerId ? null : getMpOnboardingUrl(user.id),
  });
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions).catch(() => null);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await prisma.user.update({
    where: { email: session.user.email },
    data: {
      mpSellerId: null,
      mpAccessToken: null,
      mpRefreshToken: null,
    },
  });

  return NextResponse.json({ ok: true });
}
