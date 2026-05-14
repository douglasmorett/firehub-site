import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

// GET - retorna paymentFees do franqueado atual
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { email: session.user?.email || "" },
    select: { paymentFees: true, deliveryConfig: true },
  });

  return NextResponse.json({
    paymentFees: user?.paymentFees || {},
    deliveryConfig: user?.deliveryConfig || {},
  });
}
