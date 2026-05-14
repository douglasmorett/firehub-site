import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET /api/platform-fees
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any).role !== "ADMIN")
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const fees = await prisma.platformFee.findMany({ orderBy: { platform: "asc" } });
  return NextResponse.json(fees);
}

// POST /api/platform-fees
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any).role !== "ADMIN")
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { platform, label, feePercent } = await req.json();
  const fee = await prisma.platformFee.upsert({
    where: { id: platform },
    update: { feePercent: parseFloat(feePercent), label, active: true },
    create: { platform, label, feePercent: parseFloat(feePercent) },
  });
  return NextResponse.json(fee);
}

// PUT /api/platform-fees — update existing
export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any).role !== "ADMIN")
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id, feePercent, active } = await req.json();
  const fee = await prisma.platformFee.update({
    where: { id },
    data: { feePercent: parseFloat(feePercent), active },
  });
  return NextResponse.json(fee);
}
